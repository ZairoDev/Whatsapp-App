import { io, Socket } from 'socket.io-client';
import { SOCKET_CONFIG } from '../constants';

/**
 * Socket.io client instance.
 * Connect when user is authenticated; disconnect on logout.
 */
let socket: Socket | null = null;

/**
 * Rooms to re-join automatically whenever the socket (re)connects.
 * This ensures that even if the socket isn't yet connected when a screen
 * calls joinConversationRoom / joinWhatsAppPhone, the emit is deferred and
 * replayed on the 'connect' event — which is the fix for "I have to go back
 * and come back to see new messages".
 */
const activePhoneRooms = new Set<string>();
const activeConversationRooms = new Set<string>();
/** WhatsApp channel rooms (stable channel IDs from DB, not phone IDs) */
const activeChannelRooms = new Set<string>();
/** Retarget room (Advert/SuperAdmin only) */
let joinedRetargetRoom = false;

export function getSocket(): Socket | null {
  return socket;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    // base64url -> base64
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
    // atob is available in RN/Expo; avoid Node Buffer dependency.
    const json = globalThis.atob(b64 + pad);
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function getUserIdFromJwt(token?: string): string | null {
  if (!token) return null;
  const payload = decodeJwtPayload(token);
  const id = (payload?.id ?? payload?._id ?? payload?.userId) as string | undefined;
  return id ? String(id) : null;
}

export function connectSocket(token?: string): Socket {
  if (socket?.connected) return socket;

  // If there's already a socket that's still connecting, return it.
  if (socket && !socket.disconnected) return socket;

  socket = io(SOCKET_CONFIG.URL, {
    transports: ['websocket'],
    reconnectionAttempts: SOCKET_CONFIG.RECONNECT_ATTEMPTS,
    reconnectionDelay: SOCKET_CONFIG.RECONNECT_DELAY_MS,
    auth: token ? { token } : undefined,
  });

  const userId = getUserIdFromJwt(token);

  socket.on('connect', () => {
    const s = socket;
    if (!s) return;

    // Register user identity (mobile has no session cookies).
    if (userId) {
      s.emit('register-user', { employeeId: userId });
      s.emit('join-whatsapp-room', userId);
    } else {
      s.emit('join-whatsapp-room');
    }

    // Re-join every room that components declared as active.
    // This handles two cases:
    //   1. Socket was still connecting when the screen first mounted.
    //   2. Socket reconnected after a temporary network drop.
    for (const phoneId of activePhoneRooms) {
      s.emit('join-whatsapp-phone', phoneId);
    }
    for (const convId of activeConversationRooms) {
      s.emit('join-conversation', convId);
    }
    for (const channelId of activeChannelRooms) {
      s.emit('join-whatsapp-channel', channelId);
    }
    if (joinedCallsRoom) {
      s.emit('join-whatsapp-calls-room');
    }
    if (joinedRetargetRoom) {
      s.emit('join-whatsapp-retarget');
    }
    // Join sync room for history sync events
    s.emit('join-whatsapp-sync-room');
  });

  return socket;
}

export function joinWhatsAppPhone(phoneNumberId: string) {
  activePhoneRooms.add(phoneNumberId);
  // Emit immediately if already connected; otherwise the 'connect' handler above
  // will replay it once the connection is established.
  if (socket?.connected) socket.emit('join-whatsapp-phone', phoneNumberId);
}

export function leaveWhatsAppPhone(phoneNumberId: string) {
  activePhoneRooms.delete(phoneNumberId);
  if (socket?.connected) socket.emit('leave-whatsapp-phone', phoneNumberId);
}

/** Join a stable WhatsApp channel room (by DB channel ID, not phone number ID) */
export function joinWhatsAppChannel(channelId: string) {
  if (!channelId) return;
  activeChannelRooms.add(channelId);
  if (socket?.connected) socket.emit('join-whatsapp-channel', channelId);
}

/** Leave a WhatsApp channel room */
export function leaveWhatsAppChannel(channelId: string) {
  activeChannelRooms.delete(channelId);
  if (socket?.connected) socket.emit('leave-whatsapp-channel', channelId);
}

/** Join the retarget room (Advert/SuperAdmin only) */
export function joinWhatsAppRetargetRoom() {
  if (joinedRetargetRoom) return;
  joinedRetargetRoom = true;
  if (socket?.connected) socket.emit('join-whatsapp-retarget');
}

/** Leave the retarget room */
export function leaveWhatsAppRetargetRoom() {
  if (!joinedRetargetRoom) return;
  joinedRetargetRoom = false;
  if (socket?.connected) socket.emit('leave-whatsapp-retarget');
}

export function joinConversationRoom(conversationId: string) {
  activeConversationRooms.add(conversationId);
  if (socket?.connected) socket.emit('join-conversation', conversationId);
}

export function leaveConversationRoom(conversationId: string) {
  activeConversationRooms.delete(conversationId);
  if (socket?.connected) socket.emit('leave-conversation', conversationId);
}

/** Join global WhatsApp calls room (backend relays SDP answers / call status here). */
let joinedCallsRoom = false;

export function joinWhatsAppCallsRoom() {
  if (joinedCallsRoom) return;
  joinedCallsRoom = true;
  if (socket?.connected) socket.emit('join-whatsapp-calls-room');
}

export function leaveWhatsAppCallsRoom() {
  if (!joinedCallsRoom) return;
  joinedCallsRoom = false;
  if (socket?.connected) socket.emit('leave-whatsapp-calls-room');
}

export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  // Clear tracked rooms on explicit logout so a fresh login starts clean.
  activePhoneRooms.clear();
  activeConversationRooms.clear();
  activeChannelRooms.clear();
  joinedRetargetRoom = false;
}
