/**
 * Manager WebSocket hook.
 *
 * Connects to the manager WS namespace using a short-lived ws-token (60s).
 * Handles:
 *  - ws-token fetch + renewal on disconnect/reconnect
 *  - Exponential backoff reconnection (1s → 2s → 4s → … max 30s)
 *  - Automatic cleanup on unmount
 *
 * Usage:
 *   const { socket, connected } = useManagerSocket();
 *   useEffect(() => { socket?.on('courier:moved', handler); }, [socket]);
 */
import { useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '../store/auth';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';
const WS_URL = API_URL.replace(/^http/, 'ws');

async function fetchWsToken(): Promise<string | null> {
  const { accessToken, refreshAccessToken } = useAuthStore.getState();
  if (!accessToken) return null;

  const doFetch = async (token: string) => {
    const res = await fetch(`${API_URL}/api/v1/auth/ws-token`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json() as { token?: string };
    return data.token ?? null;
  };

  let result = await doFetch(accessToken).catch(() => null);
  if (!result) {
    // access token may be expired — try refresh first
    const refreshed = await refreshAccessToken();
    if (!refreshed) return null;
    const { accessToken: newToken } = useAuthStore.getState();
    if (!newToken) return null;
    result = await doFetch(newToken).catch(() => null);
  }
  return result;
}

export function useManagerSocket() {
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const backoffRef = useRef(1000);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmounted = useRef(false);

  function clearReconnectTimer() {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
  }

  async function connect() {
    if (unmounted.current) return;

    const wsToken = await fetchWsToken();
    if (!wsToken || unmounted.current) return;

    // Clean up any existing socket
    if (socketRef.current) {
      socketRef.current.removeAllListeners();
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    const socket = io(WS_URL, {
      auth: { token: wsToken },
      transports: ['websocket'],
      reconnection: false, // We handle reconnection manually for ws-token renewal
    });

    socket.on('connect', () => {
      if (unmounted.current) return;
      backoffRef.current = 1000; // Reset backoff on successful connect
      setConnected(true);
    });

    socket.on('disconnect', () => {
      if (unmounted.current) return;
      setConnected(false);
      scheduleReconnect();
    });

    socket.on('connect_error', () => {
      if (unmounted.current) return;
      setConnected(false);
      socket.disconnect();
      scheduleReconnect();
    });

    socketRef.current = socket;
  }

  function scheduleReconnect() {
    clearReconnectTimer();
    const delay = backoffRef.current;
    // Exponential backoff: 1s → 2s → 4s → 8s → 16s → 30s cap
    backoffRef.current = Math.min(backoffRef.current * 2, 30_000);
    reconnectTimer.current = setTimeout(() => {
      if (!unmounted.current) void connect();
    }, delay);
  }

  useEffect(() => {
    unmounted.current = false;
    void connect();

    // Reconnect when app comes back to foreground
    const handleAppState = (state: AppStateStatus) => {
      if (state === 'active' && !socketRef.current?.connected) {
        clearReconnectTimer();
        backoffRef.current = 1000;
        void connect();
      }
    };
    const sub = AppState.addEventListener('change', handleAppState);

    return () => {
      unmounted.current = true;
      clearReconnectTimer();
      sub.remove();
      socketRef.current?.removeAllListeners();
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { socket: socketRef.current, connected };
}
