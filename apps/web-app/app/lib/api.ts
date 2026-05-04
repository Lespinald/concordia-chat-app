const GATEWAY = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';

export function getWebSocketUrl(path: string = '/ws'): string {
  const wsGateway = GATEWAY.replace(/^http/, 'ws');
  let url = `${wsGateway}${path}`;
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('access_token');
    if (token) {
      url += `?token=${token}`;
    }
  }
  return url;
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = `${GATEWAY}/${path.replace(/^\/+/, '')}`;
  const headers = new Headers(init?.headers);
  
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('access_token');
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }
  }

  let res = await fetch(url, { ...init, headers });

  if (res.status === 401 && typeof window !== 'undefined') {
    const refreshToken = localStorage.getItem('refresh_token');
    if (refreshToken) {
      try {
        const refreshRes = await fetch(`${GATEWAY}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: refreshToken }),
        });

        if (refreshRes.ok) {
          const { access_token } = await refreshRes.json();
          localStorage.setItem('access_token', access_token);
          headers.set('Authorization', `Bearer ${access_token}`);
          res = await fetch(url, { ...init, headers });
        } else {
          localStorage.removeItem('access_token');
          localStorage.removeItem('refresh_token');
          window.location.href = '/login';
        }
      } catch (err) {
        // ignore
      }
    }
  }

  return res;
}
