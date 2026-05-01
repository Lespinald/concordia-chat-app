'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { apiFetch } from '@/app/lib/api';
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

const WS_BASE = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080').replace(/^http/, 'ws');

export default function ChannelView({
  serverId,
  channelId,
}: {
  serverId: string;
  channelId: string;
}) {
  const [channel, setChannel] = useState<Channel | null>(null);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [extraMessages, setExtraMessages] = useState<Message[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttempts = useRef(0);
  const alive = useRef(true);

  // Fetch channel info and current user
  useEffect(() => {
    Promise.all([
      apiFetch(`/servers/${serverId}/channels`),
      apiFetch('/auth/me'),
    ]).then(async ([chRes, userRes]) => {
      if (chRes.ok) {
        const list = await chRes.json() as Channel[];
        setChannel(list.find((c) => c.channel_id === channelId) ?? null);
      }
      if (userRes.ok) setCurrentUser(await userRes.json() as CurrentUser);
    }).catch(() => {});
  }, [serverId, channelId]);

  // Reset extra messages when navigating to a different channel
  useEffect(() => {
    setExtraMessages([]);
  }, [channelId]);

  // WebSocket with exponential-backoff reconnect
  const connectWs = useCallback(async () => {
    if (!alive.current) return;
    try {
      const res = await fetch('/api/ws-token');
      if (!res.ok) return;
      const { token } = await res.json() as { token: string };

      const ws = new WebSocket(`${WS_BASE}/ws?token=${token}`);
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
      wsRef.current?.close();
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
        // Swap temp with the confirmed message from the server
        setExtraMessages((prev) =>
          prev.map((m) =>
            m.message_id === tempId ? { ...real, username: currentUser.username } : m,
          ),
        );
      } else {
        setExtraMessages((prev) => prev.filter((m) => m.message_id !== tempId));
      }
    } catch {
      setExtraMessages((prev) => prev.filter((m) => m.message_id !== tempId));
    }
  }

  const channelName = channel?.name ?? channelId.slice(0, 8);

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
