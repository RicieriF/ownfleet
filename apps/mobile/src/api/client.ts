/**
 * API client for the courier mobile app.
 * Reads access token from Zustand store, handles 401 → auto-refresh.
 */
import { useAuthStore } from '../store/auth';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

async function apiFetch<T>(
  path: string,
  init?: RequestInit,
  retry = true,
): Promise<T> {
  const { accessToken, refreshAccessToken, clearAuth } = useAuthStore.getState();

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    ...(init?.headers ?? {}),
  };

  const res = await fetch(`${API_URL}${path}`, { ...init, headers });

  if (res.status === 401 && retry) {
    const refreshed = await refreshAccessToken();
    if (refreshed) return apiFetch<T>(path, init, false);
    await clearAuth();
    throw new Error('SESSION_EXPIRED');
  }

  if (!res.ok) {
    const body = await res.text().catch(() => 'Unknown error');
    throw new Error(`${res.status}: ${body}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const apiGet = <T>(path: string) => apiFetch<T>(path);

export const apiPost = <T>(path: string, body?: unknown) =>
  apiFetch<T>(path, {
    method: 'POST',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

export const apiPatch = <T>(path: string, body?: unknown) =>
  apiFetch<T>(path, {
    method: 'PATCH',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

export const apiDelete = <T>(path: string) =>
  apiFetch<T>(path, { method: 'DELETE' });

export const apiPostForm = async <T>(path: string, form: FormData): Promise<T> => {
  const { accessToken, refreshAccessToken, clearAuth } = useAuthStore.getState();

  const headers: HeadersInit = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
  // Note: do NOT set Content-Type for FormData — fetch sets it with boundary automatically
  const res = await fetch(`${API_URL}${path}`, { method: 'POST', headers, body: form });

  if (res.status === 401) {
    const refreshed = await refreshAccessToken();
    if (refreshed) return apiPostForm<T>(path, form);
    await clearAuth();
    throw new Error('SESSION_EXPIRED');
  }

  if (!res.ok) {
    const body = await res.text().catch(() => 'Unknown error');
    throw new Error(`${res.status}: ${body}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
};
