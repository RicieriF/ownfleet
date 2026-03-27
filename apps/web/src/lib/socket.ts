'use client';

/**
 * Socket.IO singleton for real-time tracking.
 * Fetches a short-lived ws-token (60s) from GET /api/v1/auth/ws-token before
 * each connection attempt. The access_token httpOnly cookie is forwarded
 * automatically via the Next.js rewrite proxy.
 * Only instantiated on the client side.
 */
import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

async function fetchWsToken(): Promise<string | null> {
  try {
    let res = await fetch('/api/v1/auth/ws-token');
    if (res.status === 401) {
      // access_token expired — try refresh first
      const refreshed = await fetch('/api/auth/refresh', { method: 'POST' });
      if (!refreshed.ok) return null;
      res = await fetch('/api/v1/auth/ws-token');
    }
    if (!res.ok) return null;
    const data = (await res.json()) as { token?: string };
    return data.token ?? null;
  } catch {
    return null;
  }
}

export function getSocket(): Socket {
  if (!socket) {
    const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'http://localhost:3000';
    socket = io(WS_URL, {
      // auth is called before each connection/reconnection attempt —
      // each attempt gets a fresh 60s ws-token
      auth: (cb: (data: { token: string | null }) => void) => {
        fetchWsToken().then((token) => cb({ token }));
      },
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30_000,
      randomizationFactor: 0.5,
    });
  }
  return socket;
}

export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export type { Socket } from 'socket.io-client';
