import { io, type Socket } from 'socket.io-client';
import { getToken } from './api';

/**
 * Single Socket.IO connection to the control plane.
 * Empty URL = same origin (vite dev proxy or nginx in production).
 */
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL ?? '';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (socket) return socket;
  socket = io(SOCKET_URL, {
    transports: ['websocket', 'polling'],
    autoConnect: true,
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 8000,
    auth: { token: getToken() ?? undefined },
  });
  return socket;
}

/** Re-create the socket after login/logout so the auth payload is refreshed. */
export function resetSocket(): Socket | null {
  socket?.disconnect();
  socket = null;
  return null;
}

export function subscribe<T>(event: string, handler: (payload: T) => void): () => void {
  const s = getSocket();
  const listener = (payload: T) => handler(payload);
  s.on(event, listener);
  return () => {
    s.off(event, listener);
  };
}
