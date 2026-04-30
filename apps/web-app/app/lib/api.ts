export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = `/api/proxy/${path.replace(/^\/+/, '')}`;
  return fetch(url, init);
}
