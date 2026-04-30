import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

const GATEWAY = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';

const STRIP_REQ_HEADERS = new Set(['host', 'authorization', 'cookie', 'connection', 'keep-alive']);
const STRIP_RESP_HEADERS = new Set(['transfer-encoding', 'connection', 'keep-alive']);

async function refreshAccessToken(): Promise<string | null> {
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get('refresh_token')?.value;
  if (!refreshToken) return null;

  const res = await fetch(`${GATEWAY}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  }).catch(() => null);

  if (!res?.ok) return null;

  const { access_token, expires_in } = await res.json() as {
    access_token: string;
    expires_in: number;
  };

  cookieStore.set('access_token', access_token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: new Date(Date.now() + expires_in * 1000),
  });

  return access_token;
}

async function forwardToGateway(
  method: string,
  url: string,
  reqHeaders: Record<string, string>,
  body: string | undefined,
): Promise<Response> {
  return fetch(url, {
    method,
    headers: reqHeaders,
    body: method !== 'GET' && method !== 'HEAD' ? body : undefined,
  });
}

async function handle(
  req: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const { path } = await context.params;
  const cookieStore = await cookies();
  let accessToken = cookieStore.get('access_token')?.value;

  if (!accessToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const targetUrl = `${GATEWAY}/${path.join('/')}${req.nextUrl.search}`;

  const fwdHeaders: Record<string, string> = {};
  req.headers.forEach((v, k) => {
    if (!STRIP_REQ_HEADERS.has(k.toLowerCase())) fwdHeaders[k] = v;
  });
  fwdHeaders['Authorization'] = `Bearer ${accessToken}`;

  const bodyText =
    req.method !== 'GET' && req.method !== 'HEAD' ? await req.text() : undefined;

  let upstream = await forwardToGateway(req.method, targetUrl, fwdHeaders, bodyText);

  if (upstream.status === 401) {
    const newToken = await refreshAccessToken();
    if (!newToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    fwdHeaders['Authorization'] = `Bearer ${newToken}`;
    upstream = await forwardToGateway(req.method, targetUrl, fwdHeaders, bodyText);
  }

  const respBody = await upstream.arrayBuffer();
  const respHeaders = new Headers();
  upstream.headers.forEach((v, k) => {
    if (!STRIP_RESP_HEADERS.has(k.toLowerCase())) respHeaders.set(k, v);
  });

  return new NextResponse(respBody, { status: upstream.status, headers: respHeaders });
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
