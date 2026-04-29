'use client';

import Link from 'next/link';
import { useState } from 'react';

type FormFields = { username: string; email: string; password: string; confirm: string };
type FormErrors = Partial<FormFields>;

const STATUS_OPTIONS = [
  { value: 'online',  label: 'Online',          color: '#22c55e' },
  { value: 'away',    label: 'Away',            color: '#eab308' },
  { value: 'dnd',     label: 'Do Not Disturb',  color: '#ef4444' },
  { value: 'offline', label: 'Invisible',       color: '#71717a' },
];

export default function RegisterPage() {
  const [step, setStep] = useState<1 | 2>(1);
  const [form, setForm] = useState<FormFields>({
    username: '',
    email: '',
    password: '',
    confirm: '',
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [status, setStatus] = useState('online');
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

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

  const handleRegister = async () => {
    setApiError(null);
    setLoading(true);

    try {
      const res = await fetch('http://localhost:3000/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: form.username,
          email: form.email,
          password: form.password,
          status, // optional
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setApiError(data?.message || 'Registration failed');
        setLoading(false);
        return;
      }

      window.location.href = '/login';

    } catch (err) {
      console.error(err);
      setApiError('Something went wrong. Try again.');
      setLoading(false);
    }
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
        {/* Header */}
        <div className="flex items-center gap-2.5 mb-7">
          <div className="w-9 h-9 rounded-lg bg-indigo-500 flex items-center justify-center font-bold text-white text-lg shrink-0">
            C
          </div>
          <span className="text-xl font-bold tracking-tight text-white">Concordia</span>
        </div>

        {step === 1 ? (
          <>
            <h1 className="text-[22px] font-bold text-white mb-1">Create an account</h1>
            <p className="text-sm text-zinc-500 mb-6">Get started with Concordia in seconds.</p>

            {(
              [
                { key: 'username', label: 'Username', type: 'text', placeholder: 'cooluser' },
                { key: 'email', label: 'Email', type: 'email', placeholder: 'you@example.com' },
                { key: 'password', label: 'Password', type: 'password', placeholder: '••••••••' },
                { key: 'confirm', label: 'Confirm Password', type: 'password', placeholder: '••••••••' },
              ] as const
            ).map(({ key, label, type, placeholder }) => (
              <div key={key} className="mb-4">
                <label className="block text-[11px] font-semibold uppercase text-zinc-400 mb-1.5">
                  {label}
                </label>
                <input
                  type={type}
                  placeholder={placeholder}
                  value={form[key]}
                  onChange={(e) => set(key)(e.target.value)}
                  className="w-full bg-[#09090b] border border-zinc-700 rounded-md text-sm text-white px-3 py-2.5 outline-none focus:border-indigo-500 transition-colors"
                  style={errors[key] ? { borderColor: '#ef4444' } : undefined}
                />
                {errors[key] && <p className="text-xs text-red-400 mt-1">{errors[key]}</p>}
              </div>
            ))}

            <button
              onClick={() => {
                if (validateStep1()) setStep(2);
              }}
              className="w-full bg-indigo-500 hover:bg-indigo-600 text-white py-2.5 rounded-md mb-5"
            >
              Continue
            </button>

            <p className="text-sm text-zinc-500 text-center">
              Already have an account?{' '}
              <Link href="/login" className="text-indigo-400 hover:text-indigo-300">
                Sign in
              </Link>
            </p>
          </>
        ) : (
          <>
            <h1 className="text-[22px] font-bold text-white mb-1">Set your presence</h1>
            <p className="text-sm text-zinc-500 mb-6">How should others see you?</p>

            {/* Avatar preview */}
            <div className="flex flex-col items-center mb-6">
              <div className="relative w-[72px] h-[72px] rounded-full bg-indigo-500 flex items-center justify-center text-[28px] font-bold text-white">
                {(form.username[0] || 'U').toUpperCase()}
                <div
                  className="absolute bottom-0.5 right-0.5 w-[18px] h-[18px] rounded-full border-[3px] border-[#18181b]"
                  style={{ background: STATUS_OPTIONS.find((s) => s.value === status)?.color }}
                />
              </div>
              <span className="mt-2 text-white">{form.username}</span>
            </div>

            {/* Status */}
            <div className="flex flex-col gap-2 mb-6">
              {STATUS_OPTIONS.map((s) => (
                <div
                  key={s.value}
                  onClick={() => setStatus(s.value)}
                  className="px-3 py-2 rounded-md cursor-pointer border"
                  style={{
                    borderColor: status === s.value ? '#6366f1' : '#3f3f46',
                  }}
                >
                  {s.label}
                </div>
              ))}
            </div>

            {/* API error */}
            {apiError && (
              <div className="mb-3 text-sm text-red-400">{apiError}</div>
            )}

            {/* Submit */}
            <button
              onClick={handleRegister}
              disabled={loading}
              className="w-full bg-indigo-500 hover:bg-indigo-600 text-white py-2.5 rounded-md mb-3 disabled:opacity-60"
            >
              {loading ? 'Creating account...' : 'Create Account'}
            </button>

            <div className="text-center">
              <button onClick={() => setStep(1)} className="text-xs text-zinc-500">
                ← Back
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};