'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { apiFetch } from '@/app/lib/api';
import SendTipModal from '@/app/components/SendTipModal';

interface Message {
  message_id: string;
  channel_id: string;
  author_id: string;
  content: string;
  created_at: string;
  username?: string;
}

interface MessagesResponse {
  messages: Message[];
  next_cursor: string | null;
  has_more: boolean;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `Today at ${time}`;
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} at ${time}`;
}

function avatarLabel(msg: Message): string {
  return (msg.username ?? msg.author_id).trim().charAt(0).toUpperCase();
}

function displayName(msg: Message): string {
  return msg.username ?? msg.author_id.slice(0, 8);
}

export default function MessageList({
  channelId,
  currentUserId,
  extraMessages = [],
}: {
  channelId: string;
  currentUserId: string | null;
  extraMessages?: Message[];
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [tippingUser, setTippingUser] = useState<{ id: string; name: string } | null>(null);
  const [tipToast, setTipToast] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const initialScrolled = useRef(false);
  const prevExtraLen = useRef(0);

  const fetchMessages = useCallback(
    async (before?: string): Promise<MessagesResponse> => {
      const params = new URLSearchParams({ limit: '50' });
      if (before) params.set('before', before);
      const res = await apiFetch(`/channels/${channelId}/messages?${params}`);
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json() as Promise<MessagesResponse>;
    },
    [channelId],
  );

  // Initial load
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMessages([]);
    setHasMore(false);
    initialScrolled.current = false;

    fetchMessages()
      .then((data) => {
        if (cancelled) return;
        // API returns newest-first; reverse for chronological display
        setMessages([...data.messages].reverse());
        setHasMore(data.has_more);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [channelId, fetchMessages]);

  // Merge fetched + extra (optimistic/WS) messages, deduplicating by message_id
  const allMessages = useMemo(() => {
    const fetchedIds = new Set(messages.map((m) => m.message_id));
    const extras = extraMessages.filter((m) => !fetchedIds.has(m.message_id));
    return [...messages, ...extras];
  }, [messages, extraMessages]);

  // Scroll to bottom after initial load
  useEffect(() => {
    if (!loading && !initialScrolled.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      initialScrolled.current = true;
    }
  }, [loading, messages]);

  // Auto-scroll to bottom when new extra messages arrive (WS / optimistic)
  useEffect(() => {
    if (extraMessages.length <= prevExtraLen.current) {
      prevExtraLen.current = extraMessages.length;
      return;
    }
    prevExtraLen.current = extraMessages.length;
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 150;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [extraMessages]);

  // Infinite scroll — watch sentinel at top of list
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const container = scrollRef.current;
    if (!sentinel || !container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting || !hasMore || loadingMore || loading) return;

        setMessages((prev) => {
          const oldestId = prev[0]?.message_id;
          if (!oldestId) return prev;

          setLoadingMore(true);
          const prevHeight = container.scrollHeight;

          fetchMessages(oldestId)
            .then((data) => {
              setMessages((curr) => [...[...data.messages].reverse(), ...curr]);
              setHasMore(data.has_more);
              // Restore scroll position so content doesn't jump
              requestAnimationFrame(() => {
                container.scrollTop += container.scrollHeight - prevHeight;
              });
            })
            .catch(() => {})
            .finally(() => setLoadingMore(false));

          return prev;
        });
      },
      { root: container, threshold: 0.1 },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, loading, fetchMessages]);

  async function handleDelete(msg: Message) {
    setDeletingIds((s) => new Set(s).add(msg.message_id));
    try {
      const res = await apiFetch(`/channels/${channelId}/messages/${msg.message_id}`, {
        method: 'DELETE',
      });
      if (res.ok || res.status === 204) {
        setMessages((prev) => prev.filter((m) => m.message_id !== msg.message_id));
      }
    } finally {
      setDeletingIds((s) => {
        const next = new Set(s);
        next.delete(msg.message_id);
        return next;
      });
    }
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0">
      {/* Top sentinel triggers infinite scroll */}
      <div ref={sentinelRef} className="h-1 shrink-0" />

      {loadingMore && (
        <div className="flex justify-center py-3">
          <div className="w-5 h-5 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
        </div>
      )}

      {allMessages.length === 0 ? (
        <div className="h-full flex flex-col items-center justify-center text-center pb-8">
          <div className="text-5xl mb-3 text-zinc-700">#</div>
          <p className="text-lg font-bold text-zinc-300">This is the beginning of the channel</p>
          <p className="text-sm text-zinc-500 mt-1">No messages yet — send the first one!</p>
        </div>
      ) : (
        <div className="flex flex-col px-4 py-2">
          {allMessages.map((msg, i) => {
            const prev = allMessages[i - 1];
            const grouped =
              prev &&
              prev.author_id === msg.author_id &&
              new Date(msg.created_at).getTime() - new Date(prev.created_at).getTime() <
                5 * 60 * 1000;
            const isOwn = currentUserId === msg.author_id;
            const isDeleting = deletingIds.has(msg.message_id);

            return (
              <div
                key={msg.message_id}
                className={`group flex items-start gap-3 rounded px-2 py-0.5 hover:bg-[#1f1f22] transition-colors ${grouped ? 'mt-0.5' : 'mt-3'} ${isDeleting ? 'opacity-40' : ''}`}
              >
                <div className="w-10 shrink-0 flex justify-center">
                  {!grouped && (
                    <div className="w-10 h-10 rounded-full bg-indigo-500 flex items-center justify-center text-white font-bold text-sm">
                      {avatarLabel(msg)}
                    </div>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  {!grouped && (
                    <div className="flex items-baseline gap-2 mb-0.5">
                      <span className="font-semibold text-zinc-100 text-sm">{displayName(msg)}</span>
                      <span className="text-[11px] text-zinc-500">{formatTime(msg.created_at)}</span>
                    </div>
                  )}
                  <p className="text-sm text-zinc-300 break-words whitespace-pre-wrap leading-relaxed">
                    {msg.content}
                  </p>
                </div>

                {!isOwn && (
                  <button
                    onClick={() => setTippingUser({ id: msg.author_id, name: displayName(msg) })}
                    title="Send tip"
                    className="opacity-0 group-hover:opacity-100 shrink-0 p-1 rounded text-zinc-600 hover:text-yellow-400 transition-all cursor-pointer text-sm"
                  >
                    💸
                  </button>
                )}
                {isOwn && (
                  <button
                    onClick={() => handleDelete(msg)}
                    disabled={isDeleting}
                    title="Delete message"
                    className="opacity-0 group-hover:opacity-100 shrink-0 p-1 rounded text-zinc-600 hover:text-red-400 disabled:cursor-not-allowed transition-all cursor-pointer"
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                      <path d="M10 11v6M14 11v6" />
                      <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
                    </svg>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {tippingUser && (
        <SendTipModal
          recipientId={tippingUser.id}
          recipientName={tippingUser.name}
          currentUserId={currentUserId ?? undefined}
          onClose={() => setTippingUser(null)}
          onSuccess={(msg) => {
            setTippingUser(null);
            setTipToast(msg);
            setTimeout(() => setTipToast(null), 3000);
          }}
        />
      )}
      {tipToast && (
        <div className="fixed bottom-6 right-6 px-4 py-2 bg-green-900/80 border border-green-700/50 text-green-400 text-sm rounded-lg shadow-lg z-40">
          {tipToast}
        </div>
      )}
    </div>
  );
}
