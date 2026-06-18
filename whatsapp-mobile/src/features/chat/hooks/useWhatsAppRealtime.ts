import { useEffect, useRef } from 'react';
import { getSocket } from '../../../services';
import { useChatStore } from '../chat.store';
import type { Conversation, Message } from '../types';
import { markConversationRead } from '../services';
import { buildOutboundBodyText } from '../utils/guestOutboundStats';

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

type WhatsAppNewConversationPayload = {
  eventId?: string;
  conversation?: any;
};

type WhatsAppConversationUpdatePayload = {
  eventId?: string;
  conversationId?: string;
  updates?: Partial<Record<string, unknown>>;
  isArchivedByUser?: boolean;
  archivedAt?: string | number | Date | null;
};

type WhatsAppHistorySyncPayload = {
  eventId?: string;
  status?: string;
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

const VALID_MSG_TYPES: Message['type'][] = ['text', 'image', 'audio', 'video', 'reaction', 'document', 'sticker', 'location', 'interactive', 'template'];

function mapIncomingMessage(conversationId: string, raw: any): Message | null {
  if (!raw) return null;
  const wamid = (raw.messageId ?? raw.id) as string | undefined;
  const id = String(raw._id ?? raw.id ?? wamid ?? `evt-${Date.now()}`);
  const direction = (raw.direction as 'incoming' | 'outgoing') ?? undefined;
  const rawType = (raw.type as string) ?? 'text';
  const type: Message['type'] = VALID_MSG_TYPES.includes(rawType as Message['type'])
    ? (rawType as Message['type'])
    : 'text';

  const contentObj = raw.content;
  const text =
    typeof contentObj === 'string'
      ? contentObj
      : (contentObj && typeof contentObj === 'object' && (contentObj.text ?? contentObj.caption)) || '';

  const rawReplyContext = raw.replyContext;
  const replyContext: import('../types').ReplyContext | undefined =
    rawReplyContext && typeof rawReplyContext === 'object'
      ? {
          messageId: String(rawReplyContext.messageId ?? ''),
          from: String(rawReplyContext.from ?? ''),
          type: String(rawReplyContext.type ?? 'text'),
          content: rawReplyContext.content
            ? {
                text: typeof rawReplyContext.content.text === 'string' ? rawReplyContext.content.text : undefined,
                caption: typeof rawReplyContext.content.caption === 'string' ? rawReplyContext.content.caption : undefined,
              }
            : undefined,
          mediaUrl: typeof rawReplyContext.mediaUrl === 'string' ? rawReplyContext.mediaUrl : undefined,
        }
      : undefined;

  const rawLocation = contentObj && typeof contentObj === 'object' ? (contentObj as any).location : undefined;
  const location: Message['location'] =
    rawLocation && typeof rawLocation === 'object'
      ? {
          latitude: Number(rawLocation.latitude ?? 0),
          longitude: Number(rawLocation.longitude ?? 0),
          name: typeof rawLocation.name === 'string' ? rawLocation.name : undefined,
          address: typeof rawLocation.address === 'string' ? rawLocation.address : undefined,
        }
      : undefined;

  return {
    id,
    conversationId,
    whatsappMessageId: wamid ? String(wamid) : undefined,
    content: String(text ?? ''),
    displayText: String(text ?? ''),
    timestamp: toMs(raw.timestamp),
    status: raw.status as Message['status'] | undefined,
    type,
    direction,
    ...(raw.mediaUrl       ? { mediaUrl: String(raw.mediaUrl) }                         : {}),
    ...(raw.thumbnailUrl   ? { thumbnailUrl: String(raw.thumbnailUrl) }                 : {}),
    ...(raw.filename       ? { filename: String(raw.filename) }                         : {}),
    ...(raw.mimeType       ? { mimeType: String(raw.mimeType) }                         : {}),
    ...(raw.reactedToMessageId ? { reactedToMessageId: String(raw.reactedToMessageId) } : {}),
    ...(raw.reactionEmoji  ? { reactionEmoji: String(raw.reactionEmoji) }               : {}),
    ...(raw.replyToMessageId ? { replyToMessageId: String(raw.replyToMessageId) }       : {}),
    ...(replyContext        ? { replyContext }                                           : {}),
    ...(raw.source         ? { source: raw.source as 'meta' | 'internal' }              : {}),
    ...(raw.isInternal     ? { isInternal: Boolean(raw.isInternal) }                    : {}),
    ...(raw.isForwarded    ? { isForwarded: Boolean(raw.isForwarded) }                  : {}),
    ...(location           ? { location }                                               : {}),
  };
}

/** Map raw conversation payload from socket to our Conversation type */
function mapSocketConversation(raw: any): Conversation | null {
  if (!raw) return null;
  const id = String(raw._id ?? raw.id ?? '');
  if (!id) return null;
  const name = String(raw.participantName ?? raw.participantPhone ?? raw.name ?? '');
  const lastMessage = raw.lastMessageContent ?? raw.lastMessage as string | undefined;
  const ts = raw.lastMessageTime ?? raw.lastMessageAt;
  const lastMessageAt =
    typeof ts === 'number' ? ts
    : ts instanceof Date   ? ts.getTime()
    : typeof ts === 'string' ? new Date(ts).getTime()
    : undefined;

  return {
    id,
    name,
    lastMessage: typeof lastMessage === 'string' ? lastMessage : undefined,
    lastMessageAt,
    unreadCount: typeof raw.unreadCount === 'number' ? raw.unreadCount : 0,
    phone: typeof raw.participantPhone === 'string' ? raw.participantPhone : undefined,
    conversationType:
      raw.conversationType === 'guest' || raw.conversationType === 'owner'
        ? raw.conversationType
        : undefined,
    businessPhoneId: typeof raw.businessPhoneId === 'string' ? raw.businessPhoneId : undefined,
    participantLocationKey: typeof (raw.participantLocationKey ?? raw.participantLocation) === 'string'
      ? String(raw.participantLocationKey ?? raw.participantLocation).toLowerCase().trim()
      : undefined,
    participantProfilePic: typeof raw.participantProfilePic === 'string' ? raw.participantProfilePic : undefined,
    avatar: typeof raw.participantProfilePic === 'string' ? raw.participantProfilePic : undefined,
    isSelf: Boolean(raw.isSelf ?? raw.isOwn),
    templateOnly: Boolean(raw.templateOnly ?? raw.windowExpired ?? raw.isWindowExpired ?? false),
    isArchivedByUser: Boolean(raw.isArchivedByUser),
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
 *
 * @param onHistorySyncNeeded Optional callback invoked when the server signals
 *   a history sync is complete — callers can use this to refresh conversation lists.
 */
export function useWhatsAppRealtime(onHistorySyncNeeded?: () => void) {
  const seenEventIds = useRef<Set<string>>(new Set());
  // Track whether we've already attached listeners to avoid double-registration.
  const attached = useRef(false);
  const onHistorySyncNeededRef = useRef(onHistorySyncNeeded);
  onHistorySyncNeededRef.current = onHistorySyncNeeded;

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

      const contentObj = rawMessage.content;
      const bodyText = buildOutboundBodyText({
        text:
          typeof contentObj === 'string'
            ? contentObj
            : contentObj && typeof contentObj === 'object'
              ? String(contentObj.text ?? '')
              : String(msg.content ?? ''),
        caption:
          contentObj && typeof contentObj === 'object'
            ? String(contentObj.caption ?? '')
            : '',
      });

      const store = useChatStore.getState();
      store.upsertMessage(msg);
      store.upsertConversationFromMessage({
        conversationId,
        previewText: String(previewText).slice(0, 200),
        statsBodyText: bodyText,
        timestamp: msg.timestamp,
        direction: msg.direction,
        messageType: msg.type,
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

    // Echo messages (sent from another device/tab by the same user)
    const handleMessageEcho = async (data: WhatsAppNewMessagePayload) => {
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
        messageType: msg.type,
      });
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
      const conversationId = data?.conversationId;
      if (!conversationId) return;
      // Clear unread count locally when another user reads this conversation,
      // and also when the current user's read is confirmed by the server.
      useChatStore.getState().markConversationReadLocal(conversationId);
    };

    const handleNewConversation = (data: WhatsAppNewConversationPayload) => {
      const eventId = data?.eventId;
      if (eventId) {
        if (seenEventIds.current.has(eventId)) return;
        lruAdd(seenEventIds.current, eventId, 400);
      }
      const conv = mapSocketConversation(data?.conversation);
      if (!conv) return;
      useChatStore.getState().prependConversation(conv);
    };

    const handleConversationUpdate = (data: WhatsAppConversationUpdatePayload) => {
      const eventId = data?.eventId;
      if (eventId) {
        if (seenEventIds.current.has(eventId)) return;
        lruAdd(seenEventIds.current, eventId, 400);
      }
      const conversationId = data?.conversationId;
      if (!conversationId) return;

      const updates: Partial<Conversation> = {};

      // Archive state changes
      if (typeof data.isArchivedByUser === 'boolean') {
        updates.isArchivedByUser = data.isArchivedByUser;
      }
      if (data.archivedAt !== undefined) {
        updates.archivedAt = data.archivedAt
          ? toMs(data.archivedAt)
          : undefined;
      }

      // Any other fields from the `updates` payload
      const raw = data.updates ?? {};
      if (typeof (raw as any).participantName === 'string') {
        updates.name = (raw as any).participantName;
      }
      if (typeof (raw as any).participantProfilePic === 'string') {
        updates.participantProfilePic = (raw as any).participantProfilePic;
        updates.avatar = (raw as any).participantProfilePic;
      }
      if (typeof (raw as any).conversationType === 'string') {
        const ct = (raw as any).conversationType;
        if (ct === 'guest' || ct === 'owner') updates.conversationType = ct;
      }

      if (Object.keys(updates).length > 0) {
        useChatStore.getState().updateConversation(conversationId, updates);
      }
    };

    const handleHistorySync = (data: WhatsAppHistorySyncPayload) => {
      const eventId = data?.eventId;
      if (eventId) {
        if (seenEventIds.current.has(eventId)) return;
        lruAdd(seenEventIds.current, eventId, 400);
      }
      // Notify callers that conversation lists may be stale
      onHistorySyncNeededRef.current?.();
    };

    // ---------- attach once the socket exists ----------

    function attach() {
      if (attached.current) return true;
      const s = getSocket();
      if (!s) return false;

      s.on('whatsapp-new-message', handleNewMessage);
      s.on('whatsapp-message-echo', handleMessageEcho);
      s.on('whatsapp-message-status', handleStatus);
      s.on('whatsapp-conversation-read', handleConversationRead);
      s.on('whatsapp-new-conversation', handleNewConversation);
      s.on('whatsapp-conversation-update', handleConversationUpdate);
      s.on('whatsapp-history-sync', handleHistorySync);
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
          s.off('whatsapp-message-echo', handleMessageEcho);
          s.off('whatsapp-message-status', handleStatus);
          s.off('whatsapp-conversation-read', handleConversationRead);
          s.off('whatsapp-new-conversation', handleNewConversation);
          s.off('whatsapp-conversation-update', handleConversationUpdate);
          s.off('whatsapp-history-sync', handleHistorySync);
        }
        attached.current = false;
      }
    };
  }, []); // intentionally empty — the socket is a singleton, run once per mount
}
