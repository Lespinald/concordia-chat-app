'use client';

import { useState } from 'react';
import { apiFetch } from '@/app/lib/api';

const CURRENCIES = ['USD', 'EUR', 'GBP'];

export default function SendTipModal({
  recipientId,
  recipientName,
  currentUserId,
  onClose,
  onSuccess,
}: {
  recipientId?: string;
  recipientName?: string;
  currentUserId?: string;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}) {
  const [toId, setToId] = useState(recipientId ?? '');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preFilled = !!recipientId;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cents = Math.round(parseFloat(amount) * 100);
    if (!toId.trim() || isNaN(cents) || cents <= 0) {
      setError('Please enter a valid recipient and amount.');
      return;
    }
    if (currentUserId && toId.trim() === currentUserId) {
      setError('Cannot tip yourself');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch('/tips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient_id: toId.trim(), amount_cents: cents, currency, message }),
      });
      if (res.ok || res.status === 201) {
        onSuccess(`Tip of ${currency} ${(cents / 100).toFixed(2)} sent!`);
        onClose();
        return;
      }
      const data = await res.json().catch(() => ({})) as { error?: string };
      setError(data.error ?? `Error ${res.status}`);
    } catch {
      setError('Failed to send tip');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-[#18181b] border border-[#27272a] rounded-xl w-96 p-6 shadow-2xl">
        <h2 className="text-lg font-bold text-zinc-100 mb-1">Send a Tip</h2>
        <p className="text-sm text-zinc-500 mb-4">Support someone in the community.</p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">Recipient</label>
            {preFilled ? (
              <div className="w-full bg-[#27272a] rounded-lg px-3 py-2 text-sm text-zinc-300">
                {recipientName ?? recipientId}
              </div>
            ) : (
              <input
                type="text"
                placeholder="Recipient user ID"
                value={toId}
                onChange={(e) => setToId(e.target.value)}
                required
                className="w-full bg-[#09090b] border border-[#27272a] rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-indigo-500 transition-colors"
              />
            )}
          </div>

          <div className="flex gap-2">
            <div className="flex-1">
              <label className="block text-xs font-medium text-zinc-400 mb-1">Amount</label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
                className="w-full bg-[#09090b] border border-[#27272a] rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-indigo-500 transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Currency</label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="bg-[#09090b] border border-[#27272a] rounded-lg px-3 py-[9px] text-sm text-zinc-100 focus:outline-none focus:border-indigo-500 transition-colors cursor-pointer"
              >
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">
              Message <span className="text-zinc-600">(optional)</span>
            </label>
            <input
              type="text"
              placeholder="Add a message…"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={200}
              className="w-full bg-[#09090b] border border-[#27272a] rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-indigo-500 transition-colors"
            />
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex gap-2 justify-end mt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-sm bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors cursor-pointer"
            >
              {submitting ? 'Sending…' : 'Send Tip'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
