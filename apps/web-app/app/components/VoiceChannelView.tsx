'use client';

import { useState, useEffect, useRef } from 'react';
import { apiFetch } from '@/app/lib/api';

interface Participant {
  user_id: string;
  joined_at: string;
}

const WS_BASE = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080').replace(/^http/, 'ws');
const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

export default function VoiceChannelView({
  channelId,
  channelName,
}: {
  channelId: string;
  channelName: string;
}) {
  const [joined, setJoined] = useState(false);
  const [joining, setJoining] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [error, setError] = useState<string | null>(null);

  const joinedRef = useRef(false);
  const wsRef = useRef<WebSocket | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef(new Map<string, RTCPeerConnection>());
  const audioContainerRef = useRef<HTMLDivElement>(null);

  function addAudio(userId: string, stream: MediaStream) {
    const container = audioContainerRef.current;
    if (!container) return;
    let el = container.querySelector<HTMLAudioElement>(`audio[data-uid="${userId}"]`);
    if (!el) {
      el = document.createElement('audio');
      el.dataset.uid = userId;
      el.autoplay = true;
      container.appendChild(el);
    }
    el.srcObject = stream;
  }

  function removePeer(userId: string) {
    peersRef.current.get(userId)?.close();
    peersRef.current.delete(userId);
    audioContainerRef.current?.querySelector(`audio[data-uid="${userId}"]`)?.remove();
  }

  function makePeer(userId: string): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    peersRef.current.set(userId, pc);

    localStreamRef.current?.getTracks().forEach((t) => pc.addTrack(t, localStreamRef.current!));

    const remote = new MediaStream();
    pc.ontrack = (e) => { remote.addTrack(e.track); addAudio(userId, remote); };
    pc.onicecandidate = (e) => {
      if (e.candidate && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'ice-candidate',
          target_user_id: userId,
          candidate: e.candidate.toJSON(),
        }));
      }
    };
    return pc;
  }

  async function handleMessage(raw: string) {
    const data = JSON.parse(raw) as Record<string, unknown>;
    const type = data.type as string;
    const from = data.from_user_id as string | undefined;

    if (type === 'participant_joined' && from) {
      setParticipants((p) =>
        p.some((x) => x.user_id === from)
          ? p
          : [...p, { user_id: from, joined_at: new Date().toISOString() }],
      );
      const pc = makePeer(from);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      wsRef.current?.send(JSON.stringify({ type: 'offer', target_user_id: from, sdp: offer.sdp }));
      return;
    }

    if (type === 'participant_left' && from) {
      setParticipants((p) => p.filter((x) => x.user_id !== from));
      removePeer(from);
      return;
    }

    if (!from) return;

    if (type === 'offer') {
      const pc = peersRef.current.get(from) ?? makePeer(from);
      await pc.setRemoteDescription({ type: 'offer', sdp: data.sdp as string });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      wsRef.current?.send(JSON.stringify({ type: 'answer', target_user_id: from, sdp: answer.sdp }));
      return;
    }

    if (type === 'answer') {
      await peersRef.current.get(from)?.setRemoteDescription({ type: 'answer', sdp: data.sdp as string });
      return;
    }

    if (type === 'ice-candidate') {
      await peersRef.current.get(from)?.addIceCandidate(data.candidate as RTCIceCandidateInit);
    }
  }

  function doCleanup(callLeaveApi: boolean) {
    if (callLeaveApi) {
      apiFetch(`/voice/${channelId}/leave`, { method: 'POST' }).catch(() => {});
    }
    wsRef.current?.close();
    wsRef.current = null;
    peersRef.current.forEach((pc) => pc.close());
    peersRef.current.clear();
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    if (audioContainerRef.current) audioContainerRef.current.innerHTML = '';
    joinedRef.current = false;
  }

  async function handleJoin() {
    setJoining(true);
    setError(null);
    try {
      const joinRes = await apiFetch(`/voice/${channelId}/join`, { method: 'POST' });
      if (joinRes.status === 403) {
        setError('You do not have permission to join this voice channel');
        return;
      }
      if (!joinRes.ok) throw new Error('join failed');

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        setError('Microphone access denied');
        return;
      }
      localStreamRef.current = stream;

      const partRes = await apiFetch(`/voice/${channelId}/participants`);
      if (partRes.ok) {
        const d = await partRes.json() as { participants: Participant[] };
        setParticipants(d.participants);
      }

      const tokenRes = await fetch('/api/ws-token');
      if (!tokenRes.ok) throw new Error('could not get ws token');
      const { token } = await tokenRes.json() as { token: string };

      const ws = new WebSocket(`${WS_BASE}/voice/${channelId}/signal?token=${token}`);
      wsRef.current = ws;
      ws.onmessage = (ev) => { handleMessage(ev.data as string).catch(() => {}); };
      ws.onerror = () => ws.close();
      ws.onclose = () => {
        if (joinedRef.current) {
          doCleanup(false);
          setJoined(false);
          setParticipants([]);
        }
      };

      joinedRef.current = true;
      setJoined(true);
    } catch {
      setError('Failed to join voice channel');
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    } finally {
      setJoining(false);
    }
  }

  function handleLeave() {
    setLeaving(true);
    doCleanup(true);
    setJoined(false);
    setParticipants([]);
    setLeaving(false);
  }

  useEffect(() => {
    return () => {
      if (joinedRef.current) doCleanup(true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col h-full">
      <div className="h-12 px-4 flex items-center gap-2 border-b border-[#1a1a1d] shrink-0">
        <span className="text-zinc-500 text-sm">🔊</span>
        <span className="font-semibold text-zinc-100 text-sm">{channelName}</span>
      </div>

      {/* Hidden container for remote audio elements */}
      <div ref={audioContainerRef} className="hidden" aria-hidden="true" />

      <div className="flex-1 flex flex-col items-center justify-center gap-6 p-8">
        {!joined ? (
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="w-20 h-20 rounded-full bg-[#27272a] flex items-center justify-center text-4xl">
              🔊
            </div>
            <div>
              <h2 className="text-xl font-bold text-zinc-100">{channelName}</h2>
              <p className="text-sm text-zinc-500 mt-1">Voice Channel</p>
            </div>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button
              onClick={handleJoin}
              disabled={joining}
              className="px-8 py-3 bg-green-600 hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-semibold transition-colors cursor-pointer"
            >
              {joining ? 'Joining…' : 'Join Voice'}
            </button>
          </div>
        ) : (
          <div className="w-full max-w-sm flex flex-col items-center gap-6">
            <div className="w-full bg-[#111113] border border-[#1a1a1d] rounded-xl p-4">
              <h3 className="text-xs font-semibold uppercase tracking-widest text-zinc-600 mb-3">
                Participants — {participants.length}
              </h3>
              {participants.length === 0 ? (
                <p className="text-xs text-zinc-700 italic">No other participants</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {participants.map((p) => (
                    <div key={p.user_id} className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-indigo-500 flex items-center justify-center text-white text-xs font-bold shrink-0">
                        {p.user_id.slice(0, 1).toUpperCase()}
                      </div>
                      <span className="text-sm text-zinc-300 truncate">{p.user_id}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 px-4 py-2 bg-green-900/30 border border-green-800/50 rounded-lg">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-sm text-green-400 font-medium">Connected</span>
            </div>

            <button
              onClick={handleLeave}
              disabled={leaving}
              className="px-8 py-2.5 bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-semibold transition-colors cursor-pointer"
            >
              {leaving ? 'Leaving…' : 'Leave Voice'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
