import { io, Socket } from 'socket.io-client';
import { SOCKET_CONFIG } from '../constants';

/**
 * Socket.io client instance.
 * Connect when user is authenticated; disconnect on logout.
 */
let socket: Socket | null = null;

export function getSocket(): Socket | null {
  return socket;
}

export function connectSocket(token?: string): Socket {
  if (socket?.connected) return socket;

  socket = io(SOCKET_CONFIG.URL, {
    reconnectionAttempts: SOCKET_CONFIG.RECONNECT_ATTEMPTS,
    reconnectionDelay: SOCKET_CONFIG.RECONNECT_DELAY_MS,
    auth: token ? { token } : undefined,
  });

  return socket;
}

export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
