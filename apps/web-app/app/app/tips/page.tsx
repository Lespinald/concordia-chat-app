'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '@/app/lib/api';
import SendTipModal from '@/app/components/SendTipModal';

interface Tip {
  tip_id: string;
  sender_id: string;
  recipient_id: string;
  amount_cents: number;
  currency: string;
  message: string;
  created_at: string;
}

const PAGE_SIZE = 20;

function formatAmount(cents: number, currency: string) {
  return `${currency} ${(cents / 100).toFixed(2)}`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function TipsPage() {
  const [tab, setTab] = useState<'sent' | 'received'>('sent');
  const [tips, setTips] = useState<Tip[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | undefined>();

  const fetchTips = useCallback(async (direction: 'sent' | 'received', off: number, append: boolean) => {
    if (!append) setLoading(true);
    else setLoadingMore(true);
    try {
      const res = await apiFetch(`/tips?direction=${direction}&limit=${PAGE_SIZE}&offset=${off}`);
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json() as Tip[];
      setTips((prev) => append ? [...prev, ...data] : data);
      setHasMore(data.length === PAGE_SIZE);
      setOffset(off + data.length);
    } catch {
      // leave existing list on error
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    apiFetch('/auth/me').then(async (res) => {
      if (res.ok) {
        const data = await res.json() as { user_id: string };
        setCurrentUserId(data.user_id);
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    setTips([]);
    setOffset(0);
    setHasMore(false);
    fetchTips(tab, 0, false);
  }, [tab, fetchTips]);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  function handleSuccess(msg: string) {
    showToast(msg);
    if (tab === 'sent') fetchTips('sent', 0, false);
  }

  return (
    <div className="flex flex-col h-full">
      <div className="h-12 px-6 flex items-center justify-between border-b border-[#1a1a1d] shrink-0">
        <span className="font-semibold text-zinc-100 text-sm">Tips</span>
        <button
          onClick={() => setModalOpen(true)}
          className="px-3 py-1.5 bg-indigo-500 hover:bg-indigo-600 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
        >
          + Send Tip
        </button>
      </div>

      {toast && (
        <div className="mx-6 mt-4 px-4 py-2 bg-green-900/40 border border-green-700/50 text-green-400 text-sm rounded-lg shrink-0">
          {toast}
        </div>
      )}

      <div className="flex gap-1 px-6 pt-4 shrink-0">
        {(['sent', 'received'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors cursor-pointer capitalize ${
              tab === t ? 'bg-[#27272a] text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
          </div>
        ) : tips.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="text-4xl mb-3">💸</div>
            <p className="text-zinc-400 font-medium">No {tab} tips yet</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {tips.map((tip) => (
              <div key={tip.tip_id} className="bg-[#111113] border border-[#1a1a1d] rounded-xl px-4 py-3 flex items-start gap-3">
                <div className="w-9 h-9 rounded-full bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-lg shrink-0">
                  💸
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="font-semibold text-zinc-100 text-sm">
                      {formatAmount(tip.amount_cents, tip.currency)}
                    </span>
                    <span className="text-xs text-zinc-500">
                      {tab === 'sent'
                        ? `to ${tip.recipient_id.slice(0, 8)}…`
                        : `from ${tip.sender_id.slice(0, 8)}…`}
                    </span>
                    <span className="text-xs text-zinc-700 ml-auto">{formatDate(tip.created_at)}</span>
                  </div>
                  {tip.message && (
                    <p className="text-sm text-zinc-400 mt-0.5">{tip.message}</p>
                  )}
                </div>
              </div>
            ))}

            {hasMore && (
              <button
                onClick={() => fetchTips(tab, offset, true)}
                disabled={loadingMore}
                className="mt-2 w-full py-2 text-sm text-zinc-500 hover:text-zinc-300 disabled:opacity-50 transition-colors cursor-pointer"
              >
                {loadingMore ? 'Loading…' : 'Load more'}
              </button>
            )}
          </div>
        )}
      </div>

      {modalOpen && (
        <SendTipModal
          currentUserId={currentUserId}
          onClose={() => setModalOpen(false)}
          onSuccess={handleSuccess}
        />
      )}
    </div>
  );
}
