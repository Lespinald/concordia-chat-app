'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { loginAction } from '@/app/actions/auth';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const fd = new FormData();
    fd.set('email', email);
    fd.set('password', password);
    startTransition(async () => {
      const result = await loginAction(undefined, fd);
      if (result?.error) setError(result.error);
    });
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#09090b] px-6">
      <div
        className="fixed inset-0 pointer-events-none opacity-50"
        style={{
          backgroundImage:
            'linear-gradient(#18181b 1px, transparent 1px), linear-gradient(90deg, #18181b 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />
      <div className="relative z-10 w-full max-w-sm bg-[#18181b] border border-[#27272a] rounded-xl px-10 py-9 shadow-[0_25px_50px_rgba(0,0,0,0.5)]">
        <div className="flex items-center gap-2.5 mb-7">
          <div className="w-9 h-9 rounded-lg bg-indigo-500 flex items-center justify-center font-bold text-white text-lg shrink-0">
            C
          </div>
          <span className="text-xl font-bold tracking-tight text-white">Concordia</span>
        </div>

        <h1 className="text-[22px] font-bold tracking-tight text-white mb-1">Welcome back</h1>
        <p className="text-sm text-zinc-500 mb-6">Sign in to your account to continue.</p>

        {error && (
          <div className="mb-4 px-3 py-2.5 rounded-md bg-red-500/10 border border-red-500/30 text-sm text-red-400">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-[11px] font-semibold uppercase tracking-widest text-zinc-400 mb-1.5">
              Email
            </label>
            <input
              name="email"
              type="email"
              placeholder="you@example.com"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-[#09090b] border border-zinc-700 rounded-md text-sm text-white px-3 py-2.5 outline-none focus:border-indigo-500 transition-colors placeholder:text-zinc-600"
            />
          </div>
          <div className="mb-6">
            <label className="block text-[11px] font-semibold uppercase tracking-widest text-zinc-400 mb-1.5">
              Password
            </label>
            <input
              name="password"
              type="password"
              placeholder="••••••••"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-[#09090b] border border-zinc-700 rounded-md text-sm text-white px-3 py-2.5 outline-none focus:border-indigo-500 transition-colors placeholder:text-zinc-600"
            />
          </div>

          <button
            type="submit"
            disabled={isPending}
            className="w-full bg-indigo-500 hover:bg-indigo-600 disabled:opacity-60 transition-colors text-white text-sm font-medium py-2.5 rounded-md cursor-pointer"
          >
            {isPending ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="text-sm text-zinc-500 text-center mt-6">
          Don&apos;t have an account?{' '}
          <Link href="/register" className="text-indigo-400 font-medium hover:text-indigo-300">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}
