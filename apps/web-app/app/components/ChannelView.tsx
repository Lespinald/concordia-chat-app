'use client';

import { useState, useEffect } from 'react';
import { apiFetch } from '@/app/lib/api';
import MessageList from '@/app/components/MessageList';

interface Channel {
  channel_id: string;
  name: string;
  type: 'TEXT' | 'VOICE';
}

interface CurrentUser {
  user_id: string;
  username: string;
}

export default function ChannelView({
  serverId,
  channelId,
}: {
  serverId: string;
  channelId: string;
}) {
  const [channel, setChannel] = useState<Channel | null>(null);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);

  useEffect(() => {
    Promise.all([
      apiFetch(`/servers/${serverId}/channels`),
      apiFetch('/auth/me'),
    ]).then(async ([chRes, userRes]) => {
      if (chRes.ok) {
        const list = await chRes.json() as Channel[];
        setChannel(list.find((c) => c.channel_id === channelId) ?? null);
      }
      if (userRes.ok) {
        setCurrentUser(await userRes.json() as CurrentUser);
      }
    }).catch(() => {});
  }, [serverId, channelId]);

  const channelName = channel?.name ?? channelId.slice(0, 8);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="h-12 px-4 flex items-center gap-2 border-b border-[#1a1a1d] shrink-0">
        <span className="text-zinc-500 text-lg">#</span>
        <span className="font-semibold text-zinc-100 text-sm">{channelName}</span>
      </div>

      {/* Message list */}
      <MessageList channelId={channelId} currentUserId={currentUser?.user_id ?? null} />

      {/* Message input placeholder (implemented in T-64) */}
      <div className="px-4 pb-6 shrink-0">
        <div className="bg-[#27272a] rounded-lg px-4 py-3 flex items-center gap-3 text-sm text-zinc-500">
          <span className="text-zinc-600">+</span>
          <span>Message #{channelName}</span>
        </div>
      </div>
    </div>
  );
}
