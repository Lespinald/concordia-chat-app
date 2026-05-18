'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, getWebSocketUrl } from '@/app/lib/api';
import MessageList from '@/app/components/MessageList';
import MessageInput from '@/app/components/MessageInput';
import VoiceChannelView from '@/app/components/VoiceChannelView';

interface Channel {
  channel_id: string;
  name: string;
  type: 'TEXT' | 'VOICE';
}

interface CurrentUser {
  user_id: string;
  username: string;
}

interface Message {
  message_id: string;
  channel_id: string;
  author_id: string;
  content: string;
  created_at: string;
  username?: string;
}

export default function ChannelView({
  serverId,
  channelId,
}: {
  serverId: string;
  channelId: string;
}) {
  const router = useRouter();
  const [channel, setChannel] = useState<Channel | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [extraMessages, setExtraMessages] = useState<Message[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttempts = useRef(0);
  const alive = useRef(true);

  // Fetch channel info and current user
  useEffect(() => {
    setChannel(null);
    setNotFound(false);
    Promise.all([
      apiFetch(`/servers/${serverId}/channels`),
      apiFetch('/auth/me'),
    ]).then(async ([chRes, userRes]) => {
      if (chRes.ok) {
        const list = await chRes.json() as Channel[];
        const found = list.find((c) => c.channel_id === channelId) ?? null;
        setChannel(found);
        if (!found) setNotFound(true);
      } else {
        setNotFound(true);
      }
      if (userRes.ok) setCurrentUser(await userRes.json() as CurrentUser);
    }).catch(() => { setNotFound(true); });
  }, [serverId, channelId]);

  // Reset extra messages when navigating to a different channel
  useEffect(() => {
    setExtraMessages([]);
  }, [channelId]);

  // WebSocket with exponential-backoff reconnect
  const connectWs = useCallback(async () => {
    if (!alive.current) return;
    if (typeof window === 'undefined') return;
    const token = localStorage.getItem('access_token');
    if (!token) {
      reconnectTimer.current = setTimeout(connectWs, 2000);
      return;
    }
    try {
      // Disarm any existing connection before opening a new one so its onclose
      // doesn't schedule a phantom reconnect that creates a zombie duplicate.
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
      const ws = new WebSocket(getWebSocketUrl('/ws'));
      wsRef.current = ws;

      ws.onopen = () => { reconnectAttempts.current = 0; };

      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data as string) as { type: string; payload: Message };
          if (data.type === 'new_message' && data.payload.channel_id === channelId) {
            setExtraMessages((prev) => {
              if (prev.some((m) => m.message_id === data.payload.message_id)) return prev;
              return [...prev, data.payload];
            });
          }
        } catch { /* ignore malformed frames */ }
      };

      ws.onclose = () => {
        if (!alive.current) return;
        // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s (max)
        const delay = Math.min(1000 * 2 ** reconnectAttempts.current, 30_000);
        reconnectAttempts.current += 1;
        reconnectTimer.current = setTimeout(connectWs, delay);
      };

      ws.onerror = () => ws.close();
    } catch { /* network error — onclose will schedule retry */ }
  }, [channelId]);

  useEffect(() => {
    alive.current = true;
    connectWs();
    return () => {
      alive.current = false;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (wsRef.current) {
        wsRef.current.onclose = null; // prevent onclose from scheduling a reconnect
        wsRef.current.close();
      }
    };
  }, [connectWs]);

  async function handleSend(content: string) {
    if (!currentUser) return;

    const tempId = `opt-${Date.now()}`;
    const optimistic: Message = {
      message_id: tempId,
      channel_id: channelId,
      author_id: currentUser.user_id,
      username: currentUser.username,
      content,
      created_at: new Date().toISOString(),
    };
    setExtraMessages((prev) => [...prev, optimistic]);

    try {
      const res = await apiFetch(`/channels/${channelId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      if (res.ok || res.status === 201) {
        const real = await res.json() as Message;
        setExtraMessages((prev) => {
          // WS broadcast may have already inserted the real message while the
          // HTTP round-trip was in flight. If so, just drop the temp entry to
          // avoid a duplicate key; otherwise do a normal temp→real swap.
          if (prev.some((m) => m.message_id === real.message_id)) {
            return prev.filter((m) => m.message_id !== tempId);
          }
          return prev.map((m) =>
            m.message_id === tempId ? { ...real, username: currentUser.username } : m,
          );
        });
      } else {
        setExtraMessages((prev) => prev.filter((m) => m.message_id !== tempId));
      }
    } catch {
      setExtraMessages((prev) => prev.filter((m) => m.message_id !== tempId));
    }
  }

  const channelName = channel?.name ?? channelId.slice(0, 8);

  if (notFound) {
    return (
      <div className="flex flex-col h-full items-center justify-center gap-4 text-center pb-8">
        <div className="text-5xl text-zinc-700">#</div>
        <p className="text-lg font-bold text-zinc-300">Channel not found</p>
        <p className="text-sm text-zinc-500">This channel no longer exists or you don&apos;t have access.</p>
        <button
          onClick={() => router.push(`/servers/${serverId}`)}
          className="mt-2 px-4 py-2 text-sm bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg font-medium transition-colors cursor-pointer"
        >
          Back to server
        </button>
      </div>
    );
  }

  if (channel?.type === 'VOICE') {
    return <VoiceChannelView key={channelId} channelId={channelId} channelName={channel.name} />;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="h-12 px-4 flex items-center gap-2 border-b border-[#1a1a1d] shrink-0">
        <span className="text-zinc-500 text-lg">#</span>
        <span className="font-semibold text-zinc-100 text-sm">{channelName}</span>
      </div>

      <MessageList
        channelId={channelId}
        currentUserId={currentUser?.user_id ?? null}
        extraMessages={extraMessages}
      />

      <MessageInput
        channelId={channelId}
        channelName={channelName}
        onSend={handleSend}
      />
    </div>
  );
}
