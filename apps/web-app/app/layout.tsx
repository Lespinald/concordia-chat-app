'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { getWebSocketUrl } from '@/app/lib/api';
import ServerSidebar from '@/app/components/ServerSidebar';
import ChannelSidebar from '@/app/components/ChannelSidebar';
import "./globals.css";

export default function RootLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const wsRef = useRef<WebSocket | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Normalize pathname to handle trailing slashes
  const normalizedPathname = pathname?.replace(/\/$/, '') || '';
  const isAuthPage = normalizedPathname === '/login' || normalizedPathname === '/register';

  useEffect(() => {
    if (typeof window === 'undefined' || isAuthPage || !mounted) return;

    const token = localStorage.getItem('access_token');
    if (!token) return;

    // Electron specific navigation
    // @ts-ignore
    if (window.electronAPI) {
      // @ts-ignore
      window.electronAPI.onNavigateToChannel((url: string) => {
         window.location.href = url;
      });
    }

    const connectWs = () => {
      const wsUrl = getWebSocketUrl('/ws');
      const ws = new WebSocket(wsUrl);
      
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'auth', token }));
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          // @ts-ignore
          if (data.type === 'mention' && window.electronAPI) {
            // @ts-ignore
            window.electronAPI.showNotification({
              title: `Mentioned in #${data.payload?.channel_name || 'channel'}`,
              body: data.payload?.content || 'You have a new mention.',
              channelUrl: `/servers/${data.payload?.server_id || 'default'}/channels/${data.payload?.channel_id || 'general'}`
            });
          }
        } catch (e) {}
      };

      ws.onclose = () => {
        setTimeout(connectWs, 5000);
      };

      wsRef.current = ws;
    };

    connectWs();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [isAuthPage, mounted]);

  return (
    <html lang="en" className="h-full antialiased font-sans">
      <body className="h-full bg-[#09090b]">
        {mounted ? (
          isAuthPage ? (
            <main className="h-full">
              {children}
            </main>
          ) : (
            <div className="flex h-screen overflow-hidden text-zinc-100">
              <ServerSidebar />
              <ChannelSidebar />
              <main className="flex-1 bg-[#18181b] overflow-hidden flex flex-col">
                {children}
              </main>
            </div>
          )
        ) : (
          /* Initial server render / hydration placeholder */
          <div className="h-full bg-[#09090b]" />
        )}
      </body>
    </html>
  );
}
