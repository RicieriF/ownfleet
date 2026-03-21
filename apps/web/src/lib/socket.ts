'use client';

/**
 * Socket.IO singleton for real-time tracking.
 * Connects to the NestJS backend with the access_token from cookie.
 * Only instantiated on the client side.
 */
import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

function getAccessToken(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(/(?:^|;\s*)access_token=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export function getSocket(): Socket {
  if (!socket) {
    const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'http://localhost:3000';
    socket = io(WS_URL, {
      auth: { token: getAccessToken() },
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
