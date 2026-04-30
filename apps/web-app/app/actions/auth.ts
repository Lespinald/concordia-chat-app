'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

const GATEWAY = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';

export type AuthState = { error?: string } | undefined;

export async function loginAction(
  _state: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const email = (formData.get('email') as string | null)?.trim() ?? '';
  const password = (formData.get('password') as string | null) ?? '';

  if (!email || !password) {
    return { error: 'Email and password are required.' };
  }

  let res: Response;
  try {
    res = await fetch(`${GATEWAY}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    return { error: 'Could not reach the server. Please try again.' };
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as Record<string, string>;
    return { error: body.error ?? 'Invalid email or password.' };
  }

  const { access_token, refresh_token, expires_in } = await res.json() as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  const cookieStore = await cookies();
  const expiresAt = new Date(Date.now() + expires_in * 1000);

  cookieStore.set('access_token', access_token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });

  cookieStore.set('refresh_token', refresh_token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });

  redirect('/app');
}

export async function registerAction(
  _state: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const username = (formData.get('username') as string | null)?.trim() ?? '';
  const email = (formData.get('email') as string | null)?.trim() ?? '';
  const password = (formData.get('password') as string | null) ?? '';

  if (!username || !email || !password) {
    return { error: 'All fields are required.' };
  }

  let res: Response;
  try {
    res = await fetch(`${GATEWAY}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password }),
    });
  } catch {
    return { error: 'Could not reach the server. Please try again.' };
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as Record<string, string>;
    return { error: body.error ?? 'Registration failed. Please try again.' };
  }

  redirect('/login');
}

export async function logoutAction(): Promise<void> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get('access_token')?.value;

  if (accessToken) {
    await fetch(`${GATEWAY}/auth/logout`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    }).catch(() => {});
  }

  cookieStore.delete('access_token');
  cookieStore.delete('refresh_token');

  redirect('/login');
}
