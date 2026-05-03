'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { apiFetch } from '@/app/lib/api';

interface Server {
  server_id: string;
  name: string;
  owner_id: string;
  created_at: string;
}

const COLORS = [
  '#6366f1', '#22c55e', '#eab308', '#ef4444',
  '#3b82f6', '#ec4899', '#14b8a6', '#f97316',
];

function serverColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return COLORS[Math.abs(hash) % COLORS.length];
}

function serverInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase();
}

export default function ServerSidebar() {
  const router = useRouter();
  const pathname = usePathname();

  const [servers, setServers] = useState<Server[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  const fetchServers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/servers');
      if (!res.ok) throw new Error(`${res.status}`);
      const data: Server[] = await res.json();
      setServers(data);
    } catch {
      setError('Failed to load servers');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchServers(); }, [fetchServers]);

  useEffect(() => {
    if (modalOpen) setTimeout(() => inputRef.current?.focus(), 50);
  }, [modalOpen]);

  function activeServerId(): string | null {
    const m = pathname.match(/^\/app\/servers\/([^/]+)/);
    return m ? m[1] : null;
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const res = await apiFetch('/servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const created: Server = await res.json();
      setServers((prev) => [...prev, created]);
      setModalOpen(false);
      setNewName('');
      router.push(`/app/servers/${created.server_id}`);
    } catch {
      setCreateError('Failed to create server');
    } finally {
      setCreating(false);
    }
  }

  const activeId = activeServerId();

  return (
    <>
      <nav className="w-[72px] bg-[#09090b] border-r border-[#1a1a1d] flex flex-col items-center py-3 gap-0.5 overflow-y-auto shrink-0">
        {/* Home / DMs */}
        <div className="relative py-1 group/icon">
          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 rounded-r-sm bg-white h-9" />
          <div
            className="ml-3 w-12 h-12 rounded-2xl bg-indigo-500 flex items-center justify-center cursor-pointer"
            onClick={() => router.push('/app')}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <polyline points="9 22 9 12 15 12 15 22" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>

        <div className="w-8 h-px bg-[#27272a] my-1.5" />

        {loading && (
          <>
            {[1, 2, 3].map((i) => (
              <div key={i} className="relative py-1">
                <div className="ml-3 w-12 h-12 rounded-[24px] bg-[#27272a] animate-pulse" />
              </div>
            ))}
          </>
        )}

        {error && (
          <div className="flex flex-col items-center gap-1 px-1">
            <div className="text-[9px] text-red-400 text-center leading-tight">Error</div>
            <button
              onClick={fetchServers}
              className="text-[9px] text-zinc-500 hover:text-zinc-300 underline cursor-pointer"
            >
              Retry
            </button>
          </div>
        )}

        {!loading && !error && servers.map((s) => {
          const isActive = s.server_id === activeId;
          return (
            <div key={s.server_id} className="relative py-1 group/server">
              {isActive && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 rounded-r-sm bg-white h-9" />
              )}
              <div
                title={s.name}
                className={`ml-3 w-12 h-12 flex items-center justify-center cursor-pointer text-white font-bold text-lg transition-all duration-200 ${isActive ? 'rounded-2xl' : 'rounded-[24px] hover:rounded-2xl'}`}
                style={{ background: serverColor(s.server_id) }}
                onClick={() => router.push(`/app/servers/${s.server_id}`)}
              >
                {serverInitial(s.name)}
              </div>
            </div>
          );
        })}

        {!loading && (
          <>
            <div className="w-8 h-px bg-[#27272a] my-1.5" />
            <button
              title="Create Server"
              onClick={() => setModalOpen(true)}
              className="ml-0 w-12 h-12 rounded-full hover:rounded-2xl bg-[#27272a] flex items-center justify-center cursor-pointer text-green-500 hover:bg-green-500 hover:text-white text-2xl transition-all duration-200"
            >
              +
            </button>
          </>
        )}

        <div className="mt-auto mb-1">
          <div className="w-8 h-px bg-[#27272a] my-1.5" />
          <button
            title="Tips"
            onClick={() => router.push('/app/tips')}
            className={`w-12 h-12 rounded-2xl flex items-center justify-center cursor-pointer text-xl transition-all duration-200 ${
              pathname === '/app/tips'
                ? 'bg-yellow-500/20 text-yellow-400'
                : 'bg-[#27272a] hover:bg-yellow-500/20 text-zinc-400 hover:text-yellow-400'
            }`}
          >
            💸
          </button>
        </div>
      </nav>

      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={(e) => { if (e.target === e.currentTarget) { setModalOpen(false); setNewName(''); setCreateError(null); } }}
        >
          <div className="bg-[#18181b] border border-[#27272a] rounded-xl w-80 p-6 shadow-2xl">
            <h2 className="text-lg font-bold text-zinc-100 mb-1">Create a Server</h2>
            <p className="text-sm text-zinc-500 mb-4">Give your server a name to get started.</p>
            <form onSubmit={handleCreate} className="flex flex-col gap-3">
              <input
                ref={inputRef}
                type="text"
                placeholder="Server name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                maxLength={100}
                className="w-full bg-[#09090b] border border-[#27272a] rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-indigo-500 transition-colors"
              />
              {createError && <p className="text-xs text-red-400">{createError}</p>}
              <div className="flex gap-2 justify-end mt-1">
                <button
                  type="button"
                  onClick={() => { setModalOpen(false); setNewName(''); setCreateError(null); }}
                  className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating || !newName.trim()}
                  className="px-4 py-2 text-sm bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors cursor-pointer"
                >
                  {creating ? 'Creating…' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
