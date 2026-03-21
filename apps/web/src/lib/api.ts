/**
 * Server-side API client.
 * Reads the access token from Next.js cookies and calls the NestJS backend.
 * Used only in Server Components and Route Handlers.
 */
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

const API_BASE = process.env.API_INTERNAL_URL ?? 'http://localhost:3000';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function getToken(): Promise<string | null> {
  const store = await cookies();
  return store.get('access_token')?.value ?? null;
}

export async function apiFetch<T>(
  path: string,
  init?: RequestInit & { skipAuth?: boolean },
): Promise<T> {
  const token = await getToken();

  if (!token && !init?.skipAuth) {
    redirect('/login');
  }

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(init?.headers ?? {}),
  };

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    cache: 'no-store', // all dashboard data is real-time
  });

  if (res.status === 401) {
    redirect('/login');
  }

  if (!res.ok) {
    const body = await res.text().catch(() => 'Unknown error');
    throw new ApiError(res.status, body);
  }

  // Handle 204 No Content
  if (res.status === 204) return undefined as T;

  return res.json() as Promise<T>;
}
