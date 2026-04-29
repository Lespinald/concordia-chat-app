'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { apiFetch } from '../lib/api';
import CreateServerButton from './CreateServerModal';

type Server = {
  id: string;
  name: string;
};

export default function ServerSidebar() {
  const [servers, setServers] = useState<Server[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const router = useRouter();
  const pathname = usePathname();

  const fetchServers = async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await apiFetch('http://localhost:3000/servers');

      if (!res.ok) throw new Error();

      const data = await res.json();
      setServers(data);
    } catch {
      setError('Failed to load servers');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchServers();
  }, []);

  // extract active server id from URL
  const activeId = pathname.split('/')[3];

  if (loading) {
    return <div className="w-16 bg-[#09090b] p-2 text-zinc-500">...</div>;
  }

  if (error) {
    return (
      <div className="w-16 bg-[#09090b] p-2 text-red-400 text-xs">
        Error
        <button onClick={fetchServers} className="block mt-2 text-indigo-400">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="w-16 bg-[#09090b] flex flex-col items-center py-3 gap-3">
      {servers.map((server) => {
        const isActive = server.id === activeId;

        return (
          <div
            key={server.id}
            onClick={() => router.push(`/app/servers/${server.id}`)}
            className={`w-10 h-10 rounded-xl flex items-center justify-center text-white cursor-pointer transition-all
              ${isActive ? 'bg-indigo-500' : 'bg-zinc-700 hover:bg-zinc-600'}
            `}
          >
            {server.name[0]?.toUpperCase()}
          </div>
        );
      })}

      {/* Create button */}
      <CreateServerButton onCreated={(newServer) => setServers((s) => [...s, newServer])} />
    </div>
  );
}