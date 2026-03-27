/**
 * Client-side API fetch wrapper.
 * access_token is httpOnly — forwarded automatically via Next.js rewrite proxy.
 * Handles 401 → auto-refresh.
 * Used in 'use client' components and client-side actions.
 */

async function refreshToken(): Promise<boolean> {
  const res = await fetch('/api/auth/refresh', { method: 'POST' });
  return res.ok;
}

export async function clientFetch<T>(
  path: string,
  init?: RequestInit,
  retry = true,
): Promise<T> {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(init?.headers ?? {}),
  };

  const res = await fetch(path, { ...init, headers });

  if (res.status === 401 && retry) {
    const refreshed = await refreshToken();
    if (refreshed) return clientFetch<T>(path, init, false);
    window.location.href = '/login';
    throw new Error('Session expired');
  }

  if (!res.ok) {
    const body = await res.text().catch(() => 'Unknown error');
    throw new Error(`${res.status}: ${body}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/** Convenience wrappers */
export const apiGet = <T>(path: string) => clientFetch<T>(path);

export const apiPost = <T>(path: string, body?: unknown) =>
  clientFetch<T>(path, {
    method: 'POST',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

export const apiPatch = <T>(path: string, body?: unknown) =>
  clientFetch<T>(path, {
    method: 'PATCH',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

export const apiDelete = <T>(path: string) =>
  clientFetch<T>(path, { method: 'DELETE' });
