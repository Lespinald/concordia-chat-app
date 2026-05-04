'use client';

import type { ReactNode } from 'react';
import ServerSidebar from '@/app/components/ServerSidebar';
import ChannelSidebar from '@/app/components/ChannelSidebar';

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
