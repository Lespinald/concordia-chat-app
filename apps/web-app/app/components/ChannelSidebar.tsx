'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { apiFetch } from '@/app/lib/api';
import { logoutAction } from '@/app/actions/auth';

interface Channel {
  channel_id: string;
  name: string;
  type: 'TEXT' | 'VOICE';
  server_id: string;
}

interface Server {
  server_id: string;
  name: string;
  owner_id: string;
}

interface CurrentUser {
  user_id: string;
  username: string;
}

interface Member {
  user_id: string;
  username: string;
  roles?: string[];
}

export default function ChannelSidebar() {
  const router = useRouter();
  const pathname = usePathname();

  const [channels, setChannels] = useState<Channel[]>([]);
  const [server, setServer] = useState<Server | null>(null);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [hasManageRole, setHasManageRole] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<'TEXT' | 'VOICE'>('TEXT');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  const serverId = pathname.match(/^\/app\/servers\/([^/]+)/)?.[1] ?? null;
  const activeChannelId = pathname.match(/^\/app\/servers\/[^/]+\/channels\/([^/]+)/)?.[1] ?? null;

  const fetchData = useCallback(async (sid: string) => {
    setLoading(true);
    setError(null);
    try {
      const [channelsRes, serverRes, userRes, membersRes] = await Promise.all([
        apiFetch(`/servers/${sid}/channels`),
        apiFetch(`/servers/${sid}`),
        apiFetch('/auth/me'),
        apiFetch(`/servers/${sid}/members`),
      ]);

      if (!channelsRes.ok) throw new Error(`${channelsRes.status}`);
      if (!serverRes.ok) throw new Error(`${serverRes.status}`);

      const [channelsData, serverData] = await Promise.all([
        channelsRes.json() as Promise<Channel[]>,
        serverRes.json() as Promise<Server>,
      ]);

      setChannels(channelsData);
      setServer(serverData);

      if (userRes.ok) {
        const userData = await userRes.json() as CurrentUser;
        setCurrentUser(userData);
        if (membersRes.ok) {
          const membersData = await membersRes.json() as Member[];
          const memberEntry = membersData.find(m => m.user_id === userData.user_id);
          setHasManageRole((memberEntry?.roles?.length ?? 0) > 0);
        }
      }
    } catch {
      setError('Failed to load channels');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (serverId) {
      fetchData(serverId);
    } else {
      setChannels([]);
      setServer(null);
      setHasManageRole(false);
      setLoading(false);
      setError(null);
    }
  }, [serverId, fetchData]);

  useEffect(() => {
    if (modalOpen) setTimeout(() => inputRef.current?.focus(), 50);
  }, [modalOpen]);

  function openModal(type: 'TEXT' | 'VOICE') {
    setNewType(type);
    setNewName('');
    setCreateError(null);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setNewName('');
    setCreateError(null);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim() || !serverId) return;
    setCreating(true);
    setCreateError(null);
    try {
      const res = await apiFetch(`/servers/${serverId}/channels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), type: newType }),
      });
      if (res.status === 403) {
        setCreateError("You don't have permission to create channels");
        return;
      }
      if (!res.ok) throw new Error(`${res.status}`);
      const created = await res.json() as Channel;
      setChannels((prev) => [...prev, created]);
      closeModal();
    } catch {
      setCreateError('Failed to create channel');
    } finally {
      setCreating(false);
    }
  }

  const isOwner = !!(currentUser && server && currentUser.user_id === server.owner_id);
  const canManageChannels = isOwner || hasManageRole;
  const textChannels = channels.filter((c) => c.type === 'TEXT');
  const voiceChannels = channels.filter((c) => c.type === 'VOICE');

  const userInitial = currentUser?.username.trim().charAt(0).toUpperCase() ?? 'U';

  return (
    <>
      <div className="w-60 bg-[#111113] border-r border-[#1a1a1d] flex flex-col shrink-0">
        <div className="px-4 h-12 flex items-center border-b border-[#1a1a1d] shrink-0">
          <span className="font-bold text-[15px] text-zinc-100 truncate">
            {server ? server.name : serverId ? '…' : ''}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {loading && (
            <div className="flex flex-col gap-1 mt-2 px-1">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-7 bg-[#27272a] rounded-md animate-pulse" />
              ))}
            </div>
          )}

          {!loading && error && (
            <div className="px-2 py-3 text-xs text-red-400">
              {error}
              <button
                onClick={() => serverId && fetchData(serverId)}
                className="block mt-1 text-zinc-500 hover:text-zinc-300 underline cursor-pointer"
              >
                Retry
              </button>
            </div>
          )}

          {!loading && !error && serverId && (
            <>
              {/* Text Channels */}
              <div className="flex items-center justify-between px-2 py-2 mt-1 group/section">
                <span className="text-[11px] font-semibold uppercase tracking-widest text-zinc-600">
                  Text Channels
                </span>
                {canManageChannels && (
                  <button
                    onClick={() => openModal('TEXT')}
                    title="Create Text Channel"
                    className="text-zinc-600 hover:text-zinc-300 transition-colors cursor-pointer text-lg leading-none opacity-0 group-hover/section:opacity-100"
                  >
                    +
                  </button>
                )}
              </div>
              {textChannels.map((ch) => (
                <div
                  key={ch.channel_id}
                  onClick={() => router.push(`/app/servers/${serverId}/channels/${ch.channel_id}`)}
                  className={`flex items-center gap-1.5 px-2 py-[5px] rounded-md cursor-pointer text-sm transition-colors ${
                    ch.channel_id === activeChannelId
                      ? 'bg-[#27272a] text-zinc-100'
                      : 'text-zinc-400 hover:bg-[#1f1f22] hover:text-zinc-100'
                  }`}
                >
                  <span className="text-zinc-600 text-base shrink-0">#</span>
                  <span className="truncate">{ch.name}</span>
                </div>
              ))}
              {textChannels.length === 0 && (
                <div className="px-2 py-1 text-xs text-zinc-700 italic">No text channels</div>
              )}

              {/* Voice Channels */}
              <div className="flex items-center justify-between px-2 py-2 mt-3 group/section">
                <span className="text-[11px] font-semibold uppercase tracking-widest text-zinc-600">
                  Voice Channels
                </span>
                {canManageChannels && (
                  <button
                    onClick={() => openModal('VOICE')}
                    title="Create Voice Channel"
                    className="text-zinc-600 hover:text-zinc-300 transition-colors cursor-pointer text-lg leading-none opacity-0 group-hover/section:opacity-100"
                  >
                    +
                  </button>
                )}
              </div>
              {voiceChannels.map((ch) => (
                <div
                  key={ch.channel_id}
                  className="flex items-center gap-1.5 px-2 py-[5px] rounded-md cursor-pointer text-sm text-zinc-400 hover:bg-[#1f1f22] hover:text-zinc-100 transition-colors"
                >
                  <span className="text-zinc-600 text-sm shrink-0">🔊</span>
                  <span className="truncate">{ch.name}</span>
                </div>
              ))}
              {voiceChannels.length === 0 && (
                <div className="px-2 py-1 text-xs text-zinc-700 italic">No voice channels</div>
              )}
            </>
          )}
        </div>

        {/* User bar */}
        <div className="border-t border-[#1a1a1d] p-2">
          <div className="flex items-center gap-2 px-1 py-1 rounded-md hover:bg-[#27272a] transition-colors">
            <div className="w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center text-white font-bold text-sm shrink-0 relative">
              {userInitial}
              <div className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-green-500 border-2 border-[#111113]" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold text-zinc-100 truncate">
                {currentUser?.username ?? 'username'}
              </div>
            </div>
            <form action={logoutAction}>
              <button
                type="submit"
                title="Sign out"
                className="text-zinc-500 hover:text-red-400 transition-colors cursor-pointer p-1 rounded"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
              </button>
            </form>
          </div>
        </div>
      </div>

      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}
        >
          <div className="bg-[#18181b] border border-[#27272a] rounded-xl w-80 p-6 shadow-2xl">
            <h2 className="text-lg font-bold text-zinc-100 mb-1">Create a Channel</h2>
            <p className="text-sm text-zinc-500 mb-4">Add a new channel to this server.</p>
            <form onSubmit={handleCreate} className="flex flex-col gap-3">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setNewType('TEXT')}
                  className={`flex-1 px-3 py-2 text-sm rounded-lg transition-colors cursor-pointer border ${
                    newType === 'TEXT'
                      ? 'bg-indigo-500 border-indigo-500 text-white'
                      : 'bg-transparent border-[#27272a] text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  # Text
                </button>
                <button
                  type="button"
                  onClick={() => setNewType('VOICE')}
                  className={`flex-1 px-3 py-2 text-sm rounded-lg transition-colors cursor-pointer border ${
                    newType === 'VOICE'
                      ? 'bg-indigo-500 border-indigo-500 text-white'
                      : 'bg-transparent border-[#27272a] text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  🔊 Voice
                </button>
              </div>
              <input
                ref={inputRef}
                type="text"
                placeholder={newType === 'TEXT' ? 'channel-name' : 'Voice channel'}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                maxLength={100}
                className="w-full bg-[#09090b] border border-[#27272a] rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-indigo-500 transition-colors"
              />
              {createError && <p className="text-xs text-red-400">{createError}</p>}
              <div className="flex gap-2 justify-end mt-1">
                <button
                  type="button"
                  onClick={closeModal}
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
