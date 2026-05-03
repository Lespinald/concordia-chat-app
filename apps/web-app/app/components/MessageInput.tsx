'use client';

import { useState, useRef } from 'react';
import { apiFetch } from '@/app/lib/api';

export default function MessageInput({
  channelId,
  channelName,
  onSend,
}: {
  channelId: string;
  channelName: string;
  onSend: (content: string) => Promise<void>;
}) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  async function handleSend() {
    const content = text.trim();
    if (!content || sending) return;
    setSending(true);
    setText('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    try {
      await onSend(content);
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setText(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${e.target.scrollHeight}px`;
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await apiFetch(`/channels/${channelId}/attachments`, {
        method: 'POST',
        body: form,
      });
      if (res.ok) {
        const data = await res.json() as { url: string };
        setText((prev) => (prev ? `${prev} ${data.url}` : data.url));
        textareaRef.current?.focus();
      }
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  return (
    <div className="px-4 pb-6 shrink-0">
      <div className="bg-[#27272a] rounded-lg flex items-end gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          title="Attach file"
          className="shrink-0 text-zinc-500 hover:text-zinc-300 disabled:opacity-50 transition-colors cursor-pointer p-1 mb-0.5"
        >
          {uploading ? (
            <div className="w-5 h-5 rounded-full border-2 border-zinc-500 border-t-transparent animate-spin" />
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
            </svg>
          )}
        </button>
        <input ref={fileRef} type="file" className="hidden" onChange={handleFile} />

        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder={`Message #${channelName}`}
          rows={1}
          className="flex-1 bg-transparent text-sm text-zinc-100 placeholder-zinc-600 resize-none focus:outline-none overflow-y-auto leading-relaxed py-0.5"
          style={{ maxHeight: '128px' }}
        />

        <button
          type="button"
          onClick={handleSend}
          disabled={!text.trim() || sending}
          title="Send message"
          className="shrink-0 text-zinc-500 hover:text-indigo-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer p-1 mb-0.5"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
