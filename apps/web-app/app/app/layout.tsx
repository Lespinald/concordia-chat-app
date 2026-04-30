import type { ReactNode } from 'react';
import { logoutAction } from '@/app/actions/auth';

const PLACEHOLDER_SERVERS = [
  { id: 's1', letter: 'G', color: '#6366f1' },
  { id: 's2', letter: 'D', color: '#22c55e' },
  { id: 's3', letter: 'M', color: '#eab308' },
];

const PLACEHOLDER_CHANNELS = ['general', 'random', 'announcements', 'off-topic'];

function ServerSidebar() {
  return (
    <nav className="w-[72px] bg-[#09090b] border-r border-[#1a1a1d] flex flex-col items-center py-3 gap-0.5 overflow-y-auto shrink-0">
      {/* Home / DMs */}
      <div className="relative py-1 group/icon">
        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 rounded-r-sm bg-white h-9" />
        <div className="ml-3 w-12 h-12 rounded-2xl bg-indigo-500 flex items-center justify-center cursor-pointer">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <polyline points="9 22 9 12 15 12 15 22" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>

      <div className="w-8 h-px bg-[#27272a] my-1.5" />

      {PLACEHOLDER_SERVERS.map((s) => (
        <div key={s.id} className="relative py-1">
          <div
            className="ml-3 w-12 h-12 rounded-[24px] hover:rounded-2xl flex items-center justify-center cursor-pointer text-white font-bold text-lg transition-all duration-200"
            style={{ background: s.color }}
          >
            {s.letter}
          </div>
        </div>
      ))}

      <div className="w-8 h-px bg-[#27272a] my-1.5" />

      <div className="ml-0 w-12 h-12 rounded-full hover:rounded-2xl bg-[#27272a] flex items-center justify-center cursor-pointer text-green-500 hover:bg-green-500 hover:text-white text-2xl transition-all duration-200">
        +
      </div>
    </nav>
  );
}

function ChannelSidebar() {
  return (
    <div className="w-60 bg-[#111113] border-r border-[#1a1a1d] flex flex-col shrink-0">
      <div className="px-4 h-12 flex items-center justify-between border-b border-[#1a1a1d] shrink-0">
        <span className="font-bold text-[15px] text-zinc-100 truncate">General</span>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        <div className="text-[11px] font-semibold uppercase tracking-widest text-zinc-600 px-2 py-2 mt-1">
          Text Channels
        </div>
        {PLACEHOLDER_CHANNELS.map((name) => (
          <div
            key={name}
            className="flex items-center gap-1.5 px-2 py-[5px] rounded-md cursor-pointer text-zinc-400 hover:bg-[#1f1f22] hover:text-zinc-100 text-sm transition-colors"
          >
            <span className="text-zinc-600 text-base">#</span>
            {name}
          </div>
        ))}
      </div>

      {/* User bar */}
      <div className="border-t border-[#1a1a1d] p-2">
        <div className="flex items-center gap-2 px-1 py-1 rounded-md hover:bg-[#27272a] transition-colors">
          <div className="w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center text-white font-bold text-sm shrink-0 relative">
            U
            <div className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-green-500 border-2 border-[#111113]" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold text-zinc-100 truncate">username</div>
            <div className="text-[11px] text-zinc-500 truncate">#0001</div>
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
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden text-zinc-100">
      <ServerSidebar />
      <ChannelSidebar />
      <main className="flex-1 bg-[#18181b] overflow-hidden flex flex-col">
        {children}
      </main>
    </div>
  );
}
