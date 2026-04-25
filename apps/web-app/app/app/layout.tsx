import type { ReactNode } from 'react';

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
        <div className="flex items-center gap-2 px-1 py-1 rounded-md hover:bg-[#27272a] cursor-pointer transition-colors">
          <div className="w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center text-white font-bold text-sm shrink-0 relative">
            U
            <div className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-green-500 border-2 border-[#111113]" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold text-zinc-100 truncate">username</div>
            <div className="text-[11px] text-zinc-500 truncate">#0001</div>
          </div>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-zinc-500 shrink-0">
            <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
            <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" stroke="currentColor" strokeWidth="2" />
          </svg>
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
