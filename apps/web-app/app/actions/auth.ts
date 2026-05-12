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

  if (typeof window !== 'undefined') {
    localStorage.setItem('access_token', access_token);
    localStorage.setItem('refresh_token', refresh_token);
    window.location.href = '/';
  }
  return undefined;
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

  if (typeof window !== 'undefined') {
    window.location.href = '/login';
  }
  return undefined;
}

export async function logoutAction(): Promise<void> {
  if (typeof window !== 'undefined') {
    const accessToken = localStorage.getItem('access_token');
    if (accessToken) {
      await fetch(`${GATEWAY}/auth/logout`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      }).catch(() => {});
    }
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    window.location.href = '/login';
  }
}
