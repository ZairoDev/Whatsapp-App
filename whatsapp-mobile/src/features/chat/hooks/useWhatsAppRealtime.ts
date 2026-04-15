import { useEffect, useRef } from 'react';
import { getSocket } from '../../../services';
import { useChatStore } from '../chat.store';
import type { Message } from '../types';
import { markConversationRead } from '../services';

type WhatsAppNewMessagePayload = {
  eventId?: string;
  conversationId?: string;
  businessPhoneId?: string;
  message?: any;
  lastMessagePreview?: string;
};

type WhatsAppMessageStatusPayload = {
  eventId?: string;
  conversationId?: string;
  messageId?: string; // wamid
  status?: 'sent' | 'delivered' | 'read' | 'failed' | 'error' | 'pending' | 'queued';
};

type WhatsAppConversationReadPayload = {
  eventId?: string;
  conversationId?: string;
  userId?: string;
  lastReadMessageId?: string;
  lastReadAt?: string | number | Date;
};

function toMs(ts: any): number {
  if (!ts) return Date.now();
  if (typeof ts === 'number') return ts;
  const d = ts instanceof Date ? ts : new Date(ts);
  const ms = d.getTime();
  return Number.isFinite(ms) ? ms : Date.now();
}

function normalizeStatus(raw: WhatsAppMessageStatusPayload['status']): Message['status'] | undefined {
  switch (raw) {
    case 'sent':     return 'sent';
    case 'delivered': return 'delivered';
    case 'read':     return 'read';
    case 'failed':
    case 'error':    return 'failed';
    default:         return undefined;
  }
}

function mapIncomingMessage(conversationId: string, raw: any): Message | null {
  if (!raw) return null;
  const wamid = (raw.messageId ?? raw.id) as string | undefined;
  const id = String(raw._id ?? raw.id ?? wamid ?? `evt-${Date.now()}`);
  const direction = (raw.direction as 'incoming' | 'outgoing') ?? undefined;
  const type = (raw.type as Message['type']) ?? 'text';

  const contentObj = raw.content;
  const text =
    typeof contentObj === 'string'
      ? contentObj
      : (contentObj && typeof contentObj === 'object' && (contentObj.text ?? contentObj.caption)) || '';

  return {
    id,
    conversationId,
    whatsappMessageId: wamid ? String(wamid) : undefined,
    content: String(text ?? ''),
    displayText: String(text ?? ''),
    timestamp: toMs(raw.timestamp),
    status: raw.status as Message['status'] | undefined,
    type: (['image', 'video', 'audio', 'reaction', 'text'] as const).includes(type as any)
      ? (type as Message['type'])
      : 'text',
    direction,
    ...(raw.mediaUrl       ? { mediaUrl: String(raw.mediaUrl) }                   : {}),
    ...(raw.thumbnailUrl   ? { thumbnailUrl: String(raw.thumbnailUrl) }           : {}),
    ...(raw.reactedToMessageId ? { reactedToMessageId: String(raw.reactedToMessageId) } : {}),
    ...(raw.reactionEmoji  ? { reactionEmoji: String(raw.reactionEmoji) }         : {}),
  };
}

// Bounded LRU set for deduplication
function lruAdd(set: Set<string>, key: string, max: number) {
  if (set.has(key)) return;
  set.add(key);
  if (set.size <= max) return;
  const first = set.values().next().value as string | undefined;
  if (first) set.delete(first);
}

/**
 * Registers Socket.IO listeners for real-time WhatsApp events.
 *
 * Mounted once at the ChatAppStack level so it stays alive for the entire
 * session.  The hook is deliberately self-healing:
 *
 *  • If the socket hasn't been created yet when the hook mounts (race between
 *    connectSocket in RootNavigator and ChatAppStack rendering), a polling
 *    interval retries every 300 ms until the socket object exists.
 *
 *  • Once the socket is found, listeners are attached to it permanently
 *    (Socket.IO keeps handlers across reconnections automatically).
 *
 *  • The socket's own 'connect' event re-joins tracked rooms — see socket.ts —
 *    so no extra logic is needed here for reconnect.
 */
export function useWhatsAppRealtime() {
  const seenEventIds = useRef<Set<string>>(new Set());
  // Track whether we've already attached listeners to avoid double-registration.
  const attached = useRef(false);

  useEffect(() => {
    let pollInterval: ReturnType<typeof setInterval> | null = null;

    // ---------- handlers (stable references, defined once per mount) ----------

    const handleNewMessage = async (data: WhatsAppNewMessagePayload) => {
      const eventId = data?.eventId;
      if (eventId) {
        if (seenEventIds.current.has(eventId)) return;
        lruAdd(seenEventIds.current, eventId, 400);
      }

      const conversationId = data?.conversationId;
      const rawMessage = data?.message;
      if (!conversationId || !rawMessage) return;

      const msg = mapIncomingMessage(conversationId, rawMessage);
      if (!msg) return;

      const previewText =
        (data.lastMessagePreview && String(data.lastMessagePreview)) ||
        (msg.displayText?.trim() ? msg.displayText : msg.content) ||
        `${msg.type} message`;

      const store = useChatStore.getState();
      store.upsertMessage(msg);
      store.upsertConversationFromMessage({
        conversationId,
        previewText: String(previewText).slice(0, 200),
        timestamp: msg.timestamp,
        direction: msg.direction,
      });

      // Auto-mark as read when the user is already viewing this conversation.
      if (msg.direction === 'incoming' && store.activeConversationId === conversationId) {
        try {
          await markConversationRead(conversationId);
        } catch {
          // non-blocking
        }
      }
    };

    const handleStatus = (data: WhatsAppMessageStatusPayload) => {
      const eventId = data?.eventId;
      if (eventId) {
        if (seenEventIds.current.has(eventId)) return;
        lruAdd(seenEventIds.current, eventId, 400);
      }
      const conversationId = data?.conversationId;
      const messageId = data?.messageId;
      if (!conversationId || !messageId) return;
      const status = normalizeStatus(data.status);
      if (!status) return;
      useChatStore.getState().updateMessageStatus(conversationId, String(messageId), status);
    };

    const handleConversationRead = (data: WhatsAppConversationReadPayload) => {
      const eventId = data?.eventId;
      if (eventId) {
        if (seenEventIds.current.has(eventId)) return;
        lruAdd(seenEventIds.current, eventId, 400);
      }
      // Readers are re-fetched by ConversationDetailScreen when the screen is
      // focused; this handler is a hook for future lightweight updates.
    };

    // ---------- attach once the socket exists ----------

    function attach() {
      if (attached.current) return true;
      const s = getSocket();
      if (!s) return false;

      s.on('whatsapp-new-message', handleNewMessage);
      s.on('whatsapp-message-status', handleStatus);
      s.on('whatsapp-conversation-read', handleConversationRead);
      attached.current = true;
      return true;
    }

    if (!attach()) {
      // Socket hasn't been created yet (timing race on first render).
      // Poll until it's ready.
      pollInterval = setInterval(() => {
        if (attach() && pollInterval) {
          clearInterval(pollInterval);
          pollInterval = null;
        }
      }, 300);
    }

    return () => {
      if (pollInterval) clearInterval(pollInterval);

      // Only remove listeners if we actually added them.
      if (attached.current) {
        const s = getSocket();
        if (s) {
          s.off('whatsapp-new-message', handleNewMessage);
          s.off('whatsapp-message-status', handleStatus);
          s.off('whatsapp-conversation-read', handleConversationRead);
        }
        attached.current = false;
      }
    };
  }, []); // intentionally empty — the socket is a singleton, run once per mount
}
