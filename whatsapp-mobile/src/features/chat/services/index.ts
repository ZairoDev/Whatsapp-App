/**
 * Chat-specific API / socket services.
 * Backend: GET /api/whatsapp/conversations returns { success, conversations, archivedCount, pagination } and requires Bearer token.
 */
import api from '../../../services/api';
import type { Message, Conversation } from '../types';

export type WhatsAppArea = 'athens' | 'thessaloniki';

/** Phone ID from env: use EXPO_PUBLIC_WHATSAPP_ATHENS_PHONE_ID / EXPO_PUBLIC_WHATSAPP_THESSALONIKI_PHONE_ID in .env for Expo. */
function getPhoneIdForArea(area: WhatsAppArea): string {
  if (area === 'athens') {
    return (
      (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_WHATSAPP_ATHENS_PHONE_ID) ||
      (typeof process !== 'undefined' && (process.env as Record<string, string>)?.WHATSAPP_ATHENS_PHONE_ID) ||
      ''
    );
  }
  return (
    (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_WHATSAPP_THESSALONIKI_PHONE_ID) ||
    (typeof process !== 'undefined' && (process.env as Record<string, string>)?.WHATSAPP_THESSALONIKI_PHONE_ID) ||
    ''
  );
}

/** Map backend conversation doc to app Conversation type */
function mapApiConversation(c: Record<string, unknown>): Conversation {
  const id = (c._id ?? c.id)?.toString() ?? '';
  const name = (c.participantName ?? c.participantPhone ?? '') as string;
  const lastMessage = (c.lastMessageContent ?? c.lastMessage) as string | undefined;
  const lastMessageTime = c.lastMessageTime as string | Date | number | undefined;
  const lastMessageAt =
    typeof lastMessageTime === 'number'
      ? lastMessageTime
      : lastMessageTime instanceof Date
        ? lastMessageTime.getTime()
        : typeof lastMessageTime === 'string'
          ? new Date(lastMessageTime).getTime()
          : undefined;
  const unreadCount = typeof c.unreadCount === 'number' ? c.unreadCount : 0;
  const avatar = (c.participantProfilePic ?? c.avatar) as string | undefined;
  return { id, name, lastMessage, lastMessageAt, unreadCount, avatar };
}

/** Response shape from GET /api/whatsapp/conversations */
interface ConversationsApiResponse {
  success?: boolean;
  conversations?: Record<string, unknown>[];
  archivedCount?: number;
  pagination?: { limit: number; hasMore: boolean; nextCursor: string | null };
}

export interface FetchConversationsResult {
  conversations: Conversation[];
  nextCursor: string | null;
  hasMore: boolean;
}


interface ArchivedConversationsApiResponse {
  success?: boolean;
  conversations?: Record<string, unknown>[];
  count?: number;
}

const CONVERSATIONS_PAGE_SIZE = 25;

export async function fetchConversations(
  area: WhatsAppArea,
  cursor?: string | null
): Promise<FetchConversationsResult> {
  const phoneId = getPhoneIdForArea(area);
  if (!phoneId) {
    throw new Error(
      `Missing phone ID for area: ${area}. Set EXPO_PUBLIC_WHATSAPP_ATHENS_PHONE_ID / EXPO_PUBLIC_WHATSAPP_THESSALONIKI_PHONE_ID in .env`
    );
  }
  const params: Record<string, string | number> = { limit: CONVERSATIONS_PAGE_SIZE, phoneId };
  if (cursor) {
    params.cursor = cursor;
  }
  const { data } = await api.get<ConversationsApiResponse>('/whatsapp/conversations', {
    params,
  });
  const raw = data?.conversations;
  const conversations = Array.isArray(raw) ? raw.map((c) => mapApiConversation(c)) : [];
  const pagination = data?.pagination;
  const hasMore = pagination?.hasMore ?? false;
  const nextCursor = pagination?.nextCursor ?? null;
  return { conversations, nextCursor, hasMore };
}

export async function fetchArchivedConversations(): Promise<Conversation[]> {
  const { data } = await api.get<ArchivedConversationsApiResponse>('/whatsapp/conversations/archive');
  const raw = data?.conversations;
  return Array.isArray(raw) ? raw.map((c) => mapApiConversation(c)) : [];
}

/** Response shape from GET /api/whatsapp/conversations/:id/messages */
interface MessagesApiResponse {
  success?: boolean;
  messages?: Record<string, unknown>[];
  pagination?: {
    limit: number;
    hasMore: boolean;
    nextCursor: { messageId: string; timestamp: string } | null;
  };
}

export interface FetchMessagesResult {
  messages: Message[];
  nextCursor: { messageId: string; timestamp: string } | null;
  hasMore: boolean;
}

export interface ConversationSearchResult {
  id: string;
  name: string;
  phone?: string;
  lastMessage?: string;
  lastMessageAt?: number;
  unreadCount: number;
  snippet?: string;
  messageId?: string;
  messageTimestamp?: number;
}

const MESSAGES_PAGE_SIZE = 20;

function mapApiMessage(m: Record<string, unknown>, conversationId: string): Message {
  const id = (m._id ?? m.id ?? m.messageId)?.toString() ?? '';
  const content = (m.displayText ?? m.content) as string;
  const rawContent = m.content;
  const text =
    typeof rawContent === 'string'
      ? rawContent
      : (rawContent && typeof rawContent === 'object' && (rawContent as { text?: string }).text) ||
        content ||
        '';
  const ts = m.timestamp;
  const timestamp =
    typeof ts === 'number'
      ? ts
      : ts instanceof Date
        ? ts.getTime()
        : typeof ts === 'string'
          ? new Date(ts).getTime()
          : 0;
  const type = ((m.type as string) || 'text') as Message['type'];
  const direction = (m.direction as 'incoming' | 'outgoing') || 'incoming';
  const contentStr = typeof text === 'string' && text ? text : (typeof content === 'string' ? content : '');
  const displayStr = typeof m.displayText === 'string' ? m.displayText : contentStr;

  // Media URL: support mediaUrl, url, or nested content.image/video url
  const contentObj = rawContent && typeof rawContent === 'object' ? (rawContent as Record<string, unknown>) : null;
  let mediaUrl: string | undefined;
  if (typeof m.mediaUrl === 'string' && m.mediaUrl) mediaUrl = m.mediaUrl;
  else if (typeof m.url === 'string' && m.url) mediaUrl = m.url;
  else if (contentObj && typeof contentObj.url === 'string') mediaUrl = contentObj.url;
  else if (contentObj?.image && typeof (contentObj.image as { url?: string }).url === 'string') mediaUrl = (contentObj.image as { url: string }).url;
  else if (contentObj?.video && typeof (contentObj.video as { url?: string }).url === 'string') mediaUrl = (contentObj.video as { url: string }).url;
  else mediaUrl = undefined;

  let thumbnailUrl: string | undefined;
  if (typeof m.thumbnailUrl === 'string' && m.thumbnailUrl) thumbnailUrl = m.thumbnailUrl;
  else if (contentObj?.video && typeof (contentObj.video as { thumbnailUrl?: string }).thumbnailUrl === 'string') thumbnailUrl = (contentObj.video as { thumbnailUrl: string }).thumbnailUrl;
  else thumbnailUrl = undefined;

  const msg: Message = {
    id,
    conversationId,
    content: contentStr,
    timestamp,
    type: type === 'text' || type === 'image' || type === 'audio' || type === 'video' ? type : 'text',
    direction,
    displayText: displayStr,
  };
  if (mediaUrl !== undefined) msg.mediaUrl = mediaUrl;
  if (thumbnailUrl !== undefined) msg.thumbnailUrl = thumbnailUrl;
  return msg;
}

export async function fetchConversationMessages(
  conversationId: string,
  area: WhatsAppArea,
  limit: number = MESSAGES_PAGE_SIZE,
  beforeMessageId?: string | null,
  beforeTimestamp?: string | null
): Promise<FetchMessagesResult> {
  const phoneId = getPhoneIdForArea(area);
  if (!phoneId) {
    throw new Error(`Missing phone ID for area: ${area}`);
  }
  const params: Record<string, string | number> = {
    limit,
    phoneId,
    ...(beforeMessageId ? { beforeMessageId: String(beforeMessageId) } : {}),
    ...(beforeTimestamp ? { beforeTimestamp: String(beforeTimestamp) } : {}),
  };

  const { data } = await api.get<MessagesApiResponse>(
    `/whatsapp/conversations/${conversationId}/messages`,
    { params }
  );
  const raw = data?.messages;
  const messages = Array.isArray(raw)
    ? raw.map((m) => mapApiMessage(m, conversationId))
    : [];
  const pagination = data?.pagination;
  const hasMore = pagination?.hasMore ?? false;
  const nextCursor = pagination?.nextCursor ?? null;
  return { messages, nextCursor, hasMore };
}

/** @deprecated Use fetchConversationMessages */
export async function fetchMessages(conversationId: string): Promise<Message[]> {
  const { data } = await api.get<Message[]>(`/conversations/${conversationId}/messages`);
  return data;
}

export async function sendMessage(
  conversationId: string,
  content: string,
  type: Message['type'] = 'text'
): Promise<Message> {
  const { data } = await api.post<Message>(`/conversations/${conversationId}/messages`, {
    content,
    type,
  });
  return data;
}

export interface ConversationReader {
  userId: string;
  name: string;
  avatar: string | null;
  lastReadAt?: number;
  lastReadMessageId?: string;
}

interface UnifiedSearchApiResponse {
  success?: boolean;
  query?: string;
  results?: {
    conversations?: Array<Record<string, unknown>>;
    totalResults?: number;
    searchTime?: number;
    hasStartNewChat?: boolean;
    startNewChatPhone?: string;
  };
}

export async function searchConversations(
  area: WhatsAppArea,
  query: string
): Promise<ConversationSearchResult[]> {
  const phoneId = getPhoneIdForArea(area);
  if (!phoneId) {
    throw new Error(
      `Missing phone ID for area: ${area}. Set EXPO_PUBLIC_WHATSAPP_ATHENS_PHONE_ID / EXPO_PUBLIC_WHATSAPP_THESSALONIKI_PHONE_ID in .env`
    );
  }

  const params = {
    query,
    phoneId,
    limit: 50,
  };

  const { data } = await api.get<UnifiedSearchApiResponse>('/whatsapp/search/unified', {
    params,
  });

  const rawConversations = (data?.results?.conversations ?? []) as Array<Record<string, unknown>>;

  return rawConversations.map((conv) => {
    const id = (conv.conversationId as string) ?? (conv._id as string) ?? '';
    const phone = (conv.participantPhone as string) ?? '';
    const name = (conv.participantName as string) ?? phone ?? '';
    const lastMessage = (conv.lastMessageContent as string) ?? '';
    const ts = conv.lastMessageTime as string | number | Date | undefined;
    const lastMessageAt =
      typeof ts === 'number'
        ? ts
        : ts instanceof Date
          ? ts.getTime()
          : typeof ts === 'string'
            ? new Date(ts).getTime()
            : undefined;
    const unreadCount =
      typeof conv.unreadCount === 'number' ? (conv.unreadCount as number) : 0;

    // Try to use the first matched message snippet; fall back to lastMessage
    const matches = conv.matches as
      | {
          matchedMessages?: Array<{
            snippet?: string;
            messageId?: string;
            timestamp?: string | number | Date;
          }>;
        }
      | undefined;
    const firstMatch =
      matches?.matchedMessages && matches.matchedMessages.length > 0
        ? matches.matchedMessages[0]
        : undefined;
    const firstSnippet = firstMatch?.snippet;
    const rawSnippet = (firstSnippet as string) ?? lastMessage ?? '';
    // Strip any HTML tags (e.g. <mark>) from backend highlight
    const snippet = rawSnippet.replace(/<[^>]+>/g, '');

    const mt = firstMatch?.timestamp as string | number | Date | undefined;
    const messageTimestamp =
      typeof mt === 'number'
        ? mt
        : mt instanceof Date
          ? mt.getTime()
          : typeof mt === 'string'
            ? new Date(mt).getTime()
            : undefined;

    return {
      id,
      name,
      phone,
      lastMessage,
      lastMessageAt,
      unreadCount,
      snippet,
      messageId: firstMatch?.messageId as string | undefined,
      messageTimestamp,
    };
  });
}

interface ConversationReadersApiResponse {
  success?: boolean;
  readers?: Array<{
    userId?: string;
    name?: string;
    avatar?: string | null;
    lastReadAt?: string | number | Date;
    lastReadMessageId?: string;
  }>;
}

export async function fetchConversationReaders(
  conversationId: string
): Promise<ConversationReader[]> {
  if (!conversationId) return [];
  try {
    const { data } = await api.get<ConversationReadersApiResponse>(
      `/whatsapp/conversations/${conversationId}/readers`
    );
    const raw = data?.readers ?? [];
    return raw.map((r) => {
      const ts = r.lastReadAt;
      const lastReadAt =
        typeof ts === 'number'
          ? ts
          : ts instanceof Date
            ? ts.getTime()
            : typeof ts === 'string'
              ? new Date(ts).getTime()
              : undefined;
      return {
        userId: (r.userId ?? '') as string,
        name: (r.name ?? 'Unknown') as string,
        avatar: (r.avatar ?? null) as string | null,
        lastReadAt,
        lastReadMessageId: r.lastReadMessageId as string | undefined,
      };
    });
  } catch {
    return [];
  }
}
