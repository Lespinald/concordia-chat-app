'use client';

import { useState } from 'react';
import { apiFetch } from '../lib/api';

type Server = {
  id: string;
  name: string;
};

type Props = {
  onCreated: (server: Server) => void;
};

export default function CreateServerButton({ onCreated }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');

  const handleCreate = async () => {
    const res = await apiFetch('http://localhost:3000/servers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });

    const newServer = await res.json();

    onCreated(newServer);
    setOpen(false);
    setName('');
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-10 h-10 rounded-xl bg-green-600 text-white"
      >
        +
      </button>

      {open && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/50">
          <div className="bg-[#18181b] p-6 rounded-lg">
            <input
              placeholder="Server name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mb-4 p-2 bg-black text-white"
            />
            <button onClick={handleCreate} className="bg-indigo-500 px-4 py-2">
              Create
            </button>
          </div>
        </div>
      )}
    </>
  );
}