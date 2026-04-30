'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { registerAction } from '@/app/actions/auth';

type FormFields = { username: string; email: string; password: string; confirm: string };
type FormErrors = Partial<FormFields>;

const STATUS_OPTIONS = [
  { value: 'online',  label: 'Online',         color: '#22c55e' },
  { value: 'away',    label: 'Away',           color: '#eab308' },
  { value: 'dnd',     label: 'Do Not Disturb', color: '#ef4444' },
  { value: 'offline', label: 'Invisible',      color: '#71717a' },
];

export default function RegisterPage() {
  const [step, setStep] = useState<1 | 2>(1);
  const [form, setForm] = useState<FormFields>({ username: '', email: '', password: '', confirm: '' });
  const [errors, setErrors] = useState<FormErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [status, setStatus] = useState('online');
  const [isPending, startTransition] = useTransition();

  const set = (key: keyof FormFields) => (val: string) =>
    setForm((f) => ({ ...f, [key]: val }));

  const validateStep1 = (): boolean => {
    const e: FormErrors = {};
    if (!form.username) e.username = 'Username is required.';
    if (!form.email.includes('@')) e.email = 'Valid email required.';
    if (form.password.length < 8) e.password = 'Password must be at least 8 characters.';
    if (form.password !== form.confirm) e.confirm = 'Passwords do not match.';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleCreateAccount = () => {
    setServerError(null);
    const fd = new FormData();
    fd.set('username', form.username);
    fd.set('email', form.email);
    fd.set('password', form.password);
    startTransition(async () => {
      const result = await registerAction(undefined, fd);
      if (result?.error) setServerError(result.error);
    });
  };

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

        {step === 1 ? (
          <>
            <h1 className="text-[22px] font-bold tracking-tight text-white mb-1">Create an account</h1>
            <p className="text-sm text-zinc-500 mb-6">Get started with Concordia in seconds.</p>

            {(
              [
                { key: 'username', label: 'Username',         type: 'text',     placeholder: 'cooluser' },
                { key: 'email',    label: 'Email',            type: 'email',    placeholder: 'you@example.com' },
                { key: 'password', label: 'Password',         type: 'password', placeholder: '••••••••' },
                { key: 'confirm',  label: 'Confirm Password', type: 'password', placeholder: '••••••••' },
              ] as const
            ).map(({ key, label, type, placeholder }) => (
              <div key={key} className="mb-4">
                <label className="block text-[11px] font-semibold uppercase tracking-widest text-zinc-400 mb-1.5">
                  {label}
                </label>
                <input
                  type={type}
                  placeholder={placeholder}
                  value={form[key]}
                  onChange={(e) => set(key)(e.target.value)}
                  className="w-full bg-[#09090b] border border-zinc-700 rounded-md text-sm text-white px-3 py-2.5 outline-none focus:border-indigo-500 transition-colors placeholder:text-zinc-600"
                  style={errors[key] ? { borderColor: '#ef4444' } : undefined}
                />
                {errors[key] && <p className="text-xs text-red-400 mt-1">{errors[key]}</p>}
              </div>
            ))}

            <button
              onClick={() => { if (validateStep1()) setStep(2); }}
              className="w-full bg-indigo-500 hover:bg-indigo-600 transition-colors text-white text-sm font-medium py-2.5 rounded-md cursor-pointer mb-5"
            >
              Continue
            </button>

            <p className="text-sm text-zinc-500 text-center">
              Already have an account?{' '}
              <Link href="/login" className="text-indigo-400 font-medium hover:text-indigo-300">
                Sign in
              </Link>
            </p>
          </>
        ) : (
          <>
            <h1 className="text-[22px] font-bold tracking-tight text-white mb-1">Set your presence</h1>
            <p className="text-sm text-zinc-500 mb-6">How should others see you when you join?</p>

            <div className="flex flex-col items-center mb-6">
              <div className="relative w-[72px] h-[72px] rounded-full bg-indigo-500 flex items-center justify-center text-[28px] font-bold text-white">
                {(form.username[0] || 'U').toUpperCase()}
                <div
                  className="absolute bottom-0.5 right-0.5 w-[18px] h-[18px] rounded-full border-[3px] border-[#18181b]"
                  style={{ background: STATUS_OPTIONS.find((s) => s.value === status)?.color }}
                />
              </div>
              <span className="mt-2 font-semibold text-white">{form.username || 'Username'}</span>
            </div>

            <label className="block text-[11px] font-semibold uppercase tracking-widest text-zinc-400 mb-2.5">
              Initial Status
            </label>
            <div className="flex flex-col gap-1.5 mb-6">
              {STATUS_OPTIONS.map((s) => (
                <div
                  key={s.value}
                  onClick={() => setStatus(s.value)}
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-md cursor-pointer transition-all"
                  style={{
                    border: `1px solid ${status === s.value ? '#6366f1' : '#3f3f46'}`,
                    background: status === s.value ? 'rgba(99,102,241,0.1)' : 'transparent',
                  }}
                >
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.color }} />
                  <span className="text-sm text-zinc-200">{s.label}</span>
                  {status === s.value && <span className="ml-auto text-indigo-400 text-xs">✓</span>}
                </div>
              ))}
            </div>

            {serverError && (
              <div className="mb-4 px-3 py-2.5 rounded-md bg-red-500/10 border border-red-500/30 text-sm text-red-400">
                {serverError}
              </div>
            )}

            <button
              onClick={handleCreateAccount}
              disabled={isPending}
              className="w-full bg-indigo-500 hover:bg-indigo-600 disabled:opacity-60 transition-colors text-white text-sm font-medium py-2.5 rounded-md cursor-pointer mb-3"
            >
              {isPending ? 'Creating account…' : 'Create Account'}
            </button>
            <div className="text-center">
              <button onClick={() => setStep(1)} className="text-xs text-zinc-500 hover:text-zinc-300 cursor-pointer">
                ← Back
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
