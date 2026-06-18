/**
 * Chat-specific API / socket services.
 * Backend: GET /api/whatsapp/conversations returns { success, conversations, archivedCount, pagination } and requires Bearer token.
 */
import api from '../../../services/api';
import { getApiErrorMessage } from '../../../services/apiErrors';
import type { Message, Conversation, PhoneConfig } from '../types';
import {
  locationFilterToApiParam,
  normalizeLocationKey,
  parseMonthlyTargetLocationNames,
  toDisplayLocation,
  type LocationFilterValue,
} from '../utils/locations';

/** Normalized city key — dynamic (MonthlyTarget / addons), not hardcoded. */
export type WhatsAppArea = string;

let phoneConfigsInFlight: Promise<PhoneConfig[]> | null = null;

/** Normalized location key used by Adminstro (`participantLocationKey`). */
export function areaToLocationKey(area: WhatsAppArea): string {
  return normalizeLocationKey(area);
}

/** Display label for `locationFilter` query param (matches Adminstro web). */
export function areaToLocationFilter(area: WhatsAppArea): string {
  return toDisplayLocation(area);
}

export function conversationMatchesArea(conversation: Conversation, area: WhatsAppArea): boolean {
  const wanted = areaToLocationKey(area);
  const key = normalizeLocationKey(conversation.participantLocationKey ?? '');
  return Boolean(key && key === wanted);
}

export interface FetchConversationsOptions {
  /** "all" = unified inbox (server scopes by allotted areas). Omit param on the wire. */
  locationFilter?: LocationFilterValue;
  cursor?: string | null;
  /**
   * When true, fetch only conversations with an empty/missing participantLocationKey.
   * Privileged roles (SuperAdmin, Admin, Developer) only — mirrors Adminstro's adminQueue inbox tab.
   */
  adminQueue?: boolean;
}

/** Active cities from MonthlyTarget addons (SuperAdmin inbox picker). */
export async function fetchMonthlyTargetLocations(): Promise<string[]> {
  const { data } = await api.get<{ locations?: unknown }>('/monthlyTargets/getLocations');
  return parseMonthlyTargetLocationNames(data?.locations);
}

// ---------------------------------------------------------------------------
// Phone config resolution
// The mobile must use the same phone IDs as the website. The website resolves
// them via GET /api/whatsapp/phone-configs (DB channels + legacy config; no Meta fetch).
// ---------------------------------------------------------------------------

interface PhoneConfigsApiResponse {
  success?: boolean;
  phoneConfigs?: Record<string, unknown>[];
  data?: { phoneConfigs?: Record<string, unknown>[] };
}

/** Fetch phone configs from the backend (DB channels + legacy lines). */
export async function fetchPhoneConfigs(): Promise<PhoneConfig[]> {
  const { data } = await api.get<PhoneConfigsApiResponse>('/whatsapp/phone-configs');
  // Some deployments wrap payload under `data`.
  const raw = (data?.phoneConfigs ?? data?.data?.phoneConfigs) as Record<string, unknown>[] | undefined;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((c) => ({
      phoneNumberId: String((c as any).phoneNumberId ?? (c as any).phone_number_id ?? ''),
      displayNumber: c.displayNumber as string | undefined,
      displayName: c.displayName as string | undefined,
      // Area can be string, string[], or comma-separated string.
      area: (c.area ?? (c as any).areas ?? '') as string | string[],
      businessAccountId: c.businessAccountId as string | undefined,
      isInternal: Boolean(c.isInternal),
      // Channel-based fields (DB-managed lines): channelId ties back to WhatsappChannel._id;
      // locations lists the city keys / display names assigned to this phone line.
      channelId: typeof c.channelId === 'string' ? c.channelId : undefined,
      locations: Array.isArray(c.locations)
        ? (c.locations as { displayName: string; locationKey: string }[])
        : undefined,
    }))
    .filter((c) => c.phoneNumberId);
}

/** Resolve the correct phoneId for an area from backend phone configs. */
export function getPhoneIdForArea(area: WhatsAppArea, configs: PhoneConfig[]): string {
  const wanted = normalizeLocationKey(area);
  const normalizeAreas = (rawArea: PhoneConfig['area']): string[] => {
    const arr = Array.isArray(rawArea) ? rawArea : [rawArea];
    return arr
      .flatMap((a) => String(a ?? '').split(','))
      .map((s) => normalizeLocationKey(s))
      .filter(Boolean);
  };

  const matchesAreaField = configs.filter((c) => normalizeAreas(c.area).includes(wanted));
  const matchesLocations = configs.filter((c) =>
    (c.locations ?? []).some((loc) => normalizeLocationKey(loc.locationKey) === wanted),
  );
  const matches = matchesAreaField.length > 0 ? matchesAreaField : matchesLocations;
  // Prefer non-internal configs, but fall back to internal if that's all we have.
  const preferred = matches.find((c) => !c.isInternal) ?? matches[0];
  return preferred?.phoneNumberId ?? '';
}

export async function ensurePhoneId(area: WhatsAppArea, phoneId?: string): Promise<string> {
  if (phoneId) return phoneId;

  // Try the in-memory store first (populated by ConversationListScreen).
  try {
    const { useChatStore } = require('../chat.store');
    const existing = (useChatStore.getState().phoneConfigs ?? null) as PhoneConfig[] | null;
    if (existing && existing.length) {
      const resolved = getPhoneIdForArea(area, existing);
      if (resolved) return resolved;
    }
  } catch {
    // non-blocking
  }

  // If missing, fetch once (deduped) and store for the rest of the session.
  if (!phoneConfigsInFlight) {
    phoneConfigsInFlight = fetchPhoneConfigs().finally(() => {
      phoneConfigsInFlight = null;
    });
  }
  const configs = await phoneConfigsInFlight;
  try {
    const { useChatStore } = require('../chat.store');
    useChatStore.getState().setPhoneConfigs(configs);
  } catch {
    // non-blocking
  }
  const resolved = getPhoneIdForArea(area, configs);
  if (!resolved) {
    const availableAreas = Array.from(
      new Set(
        (configs ?? [])
          .flatMap((c) => (Array.isArray(c.area) ? c.area : [c.area]))
          .flatMap((a) => String(a ?? '').split(','))
          .map((s) => s.trim())
          .filter(Boolean)
      )
    );
    const internalCount = (configs ?? []).filter((c) => c.isInternal).length;
    throw new Error(
      `No phone config found for area "${area}". Backend returned ${configs.length} phone configs (internal: ${internalCount}). Areas seen: ${availableAreas.length ? availableAreas.join(', ') : '(none)'}.`
    );
  }
  return resolved;
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
  const participantProfilePic = (c.participantProfilePic ?? c.profilePic ?? c.avatar) as
    | string
    | undefined;
  const avatar = participantProfilePic;
  const phone = (c.participantPhone as string) ?? undefined;
  const conversationTypeRaw = (c.conversationType ?? c.type) as string | undefined;
  const conversationType =
    conversationTypeRaw === 'guest' || conversationTypeRaw === 'owner'
      ? (conversationTypeRaw as 'guest' | 'owner')
      : undefined;

  // Self-chat ("You") — check backend fields that indicate a personal/notes conversation.
  // Self-chats never use template-only mode; messages always go directly.
  const isSelf = Boolean(
    c.isSelf ??
    c.isOwn ??
    c.isSelfChat ??
    (c.type === 'self')
  );

  // Backend may signal the 24-hour window expiry via several field names.
  // Self-chats always bypass this — templateOnly is forced false for them.
  const templateOnly = isSelf
    ? false
    : Boolean(
        c.windowExpired ??
        c.isWindowExpired ??
        c.templateOnly ??
        c.isTemplateOnly ??
        false
      );

  // Compute when the 24-hour messaging window closes.
  // The backend stores `lastIncomingMessageTime` (last customer message).
  // windowExpiresAt = lastIncomingMessageTime + 24 h (in ms).
  const rawIncoming =
    (c.lastIncomingMessageTime ?? c.lastCustomerMessageAt) as string | Date | number | undefined;
  let windowExpiresAt: number | undefined;
  if (rawIncoming) {
    const incomingMs =
      typeof rawIncoming === 'number'
        ? rawIncoming
        : rawIncoming instanceof Date
          ? rawIncoming.getTime()
          : new Date(rawIncoming).getTime();
    if (!isNaN(incomingMs)) {
      windowExpiresAt = incomingMs + 24 * 60 * 60 * 1000;
    }
  }

  const participantLocationKey =
    typeof c.participantLocationKey === 'string'
      ? c.participantLocationKey
      : typeof (c as { participantLocation?: string }).participantLocation === 'string'
        ? String((c as { participantLocation: string }).participantLocation)
            .toLowerCase()
            .trim()
        : undefined;
  const businessPhoneId =
    typeof c.businessPhoneId === 'string'
      ? c.businessPhoneId
      : typeof (c as { phoneNumberId?: string }).phoneNumberId === 'string'
        ? (c as { phoneNumberId: string }).phoneNumberId
        : undefined;

  const listingLinkSentCount =
    typeof c.listingLinkSentCount === 'number' ? c.listingLinkSentCount : undefined;
  const optionsSentCount =
    typeof c.optionsSentCount === 'number' ? c.optionsSentCount : undefined;

  // Channel-routing fields — frozen at conversation creation in Adminstro.
  // Used for outbound phone resolution and inbox visibility across WABA migrations.
  const whatsappChannelId =
    typeof c.whatsappChannelId === 'string'
      ? c.whatsappChannelId
      : c.whatsappChannelId != null
        ? String(c.whatsappChannelId)
        : undefined;

  const channelTypeRaw = c.channelType as string | undefined;
  const channelType: Conversation['channelType'] =
    channelTypeRaw === 'guest' || channelTypeRaw === 'owner' ||
    channelTypeRaw === 'support' || channelTypeRaw === 'backup'
      ? channelTypeRaw
      : undefined;

  const rentalTypeRaw = c.rentalType as string | undefined;
  const rentalType: Conversation['rentalType'] =
    rentalTypeRaw === 'Short Term' || rentalTypeRaw === 'Long Term' || rentalTypeRaw === 'General'
      ? rentalTypeRaw
      : undefined;

  return {
    id,
    name,
    lastMessage,
    lastMessageAt,
    unreadCount,
    avatar,
    participantProfilePic,
    phone,
    conversationType,
    isSelf,
    templateOnly,
    windowExpiresAt,
    participantLocationKey,
    businessPhoneId,
    listingLinkSentCount,
    optionsSentCount,
    whatsappChannelId,
    channelType,
    rentalType,
  };
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

export async function createConversation(params: {
  participantPhone: string;
  participantName?: string;
  participantLocation?: string;
  conversationType: 'owner' | 'guest';
  area: WhatsAppArea;
}): Promise<Conversation> {
  const phoneDigits = params.participantPhone.replace(/\D/g, '');
  if (!phoneDigits) {
    throw new Error('Phone number is required');
  }

  const phoneNumberId = await ensurePhoneId(params.area);
  const body: Record<string, unknown> = {
    participantPhone: phoneDigits,
    phoneNumberId,
    conversationType: params.conversationType,
  };
  if (params.participantName?.trim()) body.participantName = params.participantName.trim();
  if (params.participantLocation?.trim()) {
    body.participantLocation = params.participantLocation.trim();
    body.location = params.participantLocation.trim();
  }

  const { data } = await api.post<{ success?: boolean; conversation?: Record<string, unknown> }>(
    '/whatsapp/conversations',
    body
  );

  const conv = (data?.conversation ?? null) as Record<string, unknown> | null;
  if (!conv) {
    throw new Error('Failed to create conversation');
  }
  return mapApiConversation(conv);
}


interface ArchivedConversationsApiResponse {
  success?: boolean;
  conversations?: Record<string, unknown>[];
  count?: number;
}

const CONVERSATIONS_PAGE_SIZE = 25;

export async function fetchConversations(
  options: FetchConversationsOptions = {},
): Promise<FetchConversationsResult> {
  const params: Record<string, string | number | boolean> = { limit: CONVERSATIONS_PAGE_SIZE };
  if (options.cursor) {
    params.cursor = options.cursor;
  }
  const locationFilter = locationFilterToApiParam(options.locationFilter ?? 'all');
  if (locationFilter) {
    params.locationFilter = locationFilter;
  }
  if (options.adminQueue) {
    params.adminQueue = 'true';
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
  conversationType?: 'owner' | 'guest';
  participantLocationKey?: string;
  participantProfilePic?: string;
  lastMessage?: string;
  lastMessageAt?: number;
  unreadCount: number;
  snippet?: string;
  messageId?: string;
  messageTimestamp?: number;
  listingLinkSentCount?: number;
  optionsSentCount?: number;
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
  let type = ((m.type as string) || 'text') as Message['type'];
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

  const whatsappMessageId =
    typeof m.messageId === 'string' ? (m.messageId as string) : undefined;
  const reactedToMessageId =
    typeof (m as any).reactedToMessageId === 'string'
      ? ((m as any).reactedToMessageId as string)
      : undefined;
  const reactionEmoji =
    typeof (m as any).reactionEmoji === 'string'
      ? ((m as any).reactionEmoji as string)
      : undefined;

  // Map delivery/read status for outgoing messages only
  let status: Message['status'] | undefined;
  if (direction === 'outgoing') {
    const rawStatus = (m as any).status as string | undefined;
    switch (rawStatus) {
      case 'queued':
      case 'pending':
        status = 'sending';
        break;
      case 'sent':
        status = 'sent';
        break;
      case 'delivered':
        status = 'delivered';
        break;
      case 'read':
        status = 'read';
        break;
      case 'failed':
      case 'error':
        status = 'failed';
        break;
      default:
        status = undefined;
    }
  }

  const VALID_TYPES: Message['type'][] = ['text', 'image', 'audio', 'video', 'reaction', 'document', 'sticker', 'location', 'interactive', 'template'];
  const normalizedType: Message['type'] = VALID_TYPES.includes(type as Message['type']) ? (type as Message['type']) : 'text';

  const source = (m as any).source as 'meta' | 'internal' | undefined;
  const isInternal = Boolean((m as any).isInternal);
  const isForwarded = Boolean((m as any).isForwarded);
  const filename = typeof (m as any).filename === 'string' ? (m as any).filename as string : undefined;
  const fileSize = typeof (m as any).fileSize === 'number' ? (m as any).fileSize as number : undefined;
  const mimeType = typeof (m as any).mimeType === 'string' ? (m as any).mimeType as string : undefined;

  const replyToMessageId = typeof (m as any).replyToMessageId === 'string'
    ? (m as any).replyToMessageId as string
    : undefined;

  const rawReplyContext = (m as any).replyContext;
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

  const rawLocation = contentObj?.location;
  const location: Message['location'] =
    rawLocation && typeof rawLocation === 'object'
      ? {
          latitude: Number((rawLocation as any).latitude ?? 0),
          longitude: Number((rawLocation as any).longitude ?? 0),
          name: typeof (rawLocation as any).name === 'string' ? (rawLocation as any).name : undefined,
          address: typeof (rawLocation as any).address === 'string' ? (rawLocation as any).address : undefined,
        }
      : undefined;

  const msg: Message = {
    id,
    conversationId,
    content: contentStr,
    timestamp,
    type: normalizedType,
    direction,
    displayText: displayStr,
    ...(status ? { status } : {}),
  };
  if (whatsappMessageId) msg.whatsappMessageId = whatsappMessageId;
  if (reactedToMessageId) msg.reactedToMessageId = reactedToMessageId;
  if (reactionEmoji) msg.reactionEmoji = reactionEmoji;
  if (mediaUrl !== undefined) msg.mediaUrl = mediaUrl;
  if (thumbnailUrl !== undefined) msg.thumbnailUrl = thumbnailUrl;
  if (filename) msg.filename = filename;
  if (fileSize !== undefined) msg.fileSize = fileSize;
  if (mimeType) msg.mimeType = mimeType;
  if (source) msg.source = source;
  if (isInternal) msg.isInternal = isInternal;
  if (isForwarded) msg.isForwarded = isForwarded;
  if (replyToMessageId) msg.replyToMessageId = replyToMessageId;
  if (replyContext) msg.replyContext = replyContext;
  if (location) msg.location = location;
  return msg;
}

export async function fetchConversationMessages(
  conversationId: string,
  _area?: WhatsAppArea,
  limit: number = MESSAGES_PAGE_SIZE,
  beforeMessageId?: string | null,
  beforeTimestamp?: string | null
): Promise<FetchMessagesResult> {
  const params: Record<string, string | number> = {
    limit,
    ...(beforeMessageId ? { beforeMessageId: String(beforeMessageId) } : {}),
    ...(beforeTimestamp ? { beforeTimestamp: String(beforeTimestamp) } : {}),
  };

  const { data } = await api.get<MessagesApiResponse>(
    `/whatsapp/conversations/${conversationId}/messages`,
    { params }
  );
  const raw = data?.messages ?? [];
  const mapped = Array.isArray(raw)
    ? raw.map((m) => mapApiMessage(m, conversationId))
    : [];

  // Separate base messages and reaction messages, then attach aggregated reactions
  const baseMessages: Message[] = [];
  const reactionBuckets = new Map<string, { emoji: string; count: number; fromSelf?: boolean }[]>();

  for (const msg of mapped) {
    if (msg.type !== 'reaction') {
      baseMessages.push(msg);
      continue;
    }
    const targetId = msg.reactedToMessageId;
    if (!targetId || !msg.reactionEmoji) continue;

    const key = targetId;
    const list = reactionBuckets.get(key) ?? [];
    let entry = list.find((r) => r.emoji === msg.reactionEmoji);
    if (!entry) {
      entry = { emoji: msg.reactionEmoji, count: 0, fromSelf: msg.direction === 'outgoing' };
      list.push(entry);
    }
    entry.count += 1;
    reactionBuckets.set(key, list);
  }

  const messages = baseMessages.map((m) => {
    const key = m.whatsappMessageId ?? m.id;
    const reactions = reactionBuckets.get(key);
    return reactions ? { ...m, reactions } : m;
  });
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
  to: string,
  content: string,
  type: Message['type'] = 'text',
  /** wamid of the message being replied to — sent to Meta for threaded replies */
  replyToMessageId?: string,
): Promise<void> {
  if (!conversationId || !content.trim()) return;
  try {
    await api.post('/whatsapp/send-message', {
      ...(to.trim() ? { to } : {}),
      message: content,
      conversationId,
      type,
      ...(replyToMessageId ? { replyToMessageId } : {}),
    });
  } catch (e) {
    throw new Error(getApiErrorMessage(e, 'Failed to send message'));
  }
}

export type UploadMediaResult = {
  success?: boolean;
  mediaId?: string;
  url?: string;
  mimeType?: string;
  filename?: string;
  size?: number;
  phoneNumberId?: string;
};

export async function uploadWhatsAppMedia(params: {
  uri: string;
  mimeType: string;
  filename: string;
  phoneNumberId?: string;
}): Promise<UploadMediaResult> {
  const form = new FormData();
  // React Native FormData file object
  form.append('file', {
    uri: params.uri,
    name: params.filename,
    type: params.mimeType,
  } as any);
  if (params.phoneNumberId) form.append('phoneNumberId', params.phoneNumberId);

  const { data } = await api.post<UploadMediaResult>('/whatsapp/upload-media', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data ?? {};
}

export async function sendMediaMessage(params: {
  conversationId: string;
  to: string;
  mediaType: 'image' | 'document' | 'audio' | 'video' | 'sticker';
  mediaId?: string;
  mediaUrl?: string;
  caption?: string;
  filename?: string;
}): Promise<void> {
  const { conversationId, to, mediaType, mediaId, mediaUrl, caption, filename } = params;
  if (!conversationId || !to?.trim() || !mediaType) return;
  if (!mediaId && !mediaUrl) return;
  try {
    await api.post('/whatsapp/send-media', {
      to,
      mediaType,
      ...(mediaId ? { mediaId } : {}),
      ...(mediaUrl ? { mediaUrl } : {}),
      ...(caption ? { caption } : {}),
      ...(filename ? { filename } : {}),
      conversationId,
    });
  } catch (e) {
    throw new Error(getApiErrorMessage(e, 'Failed to send media'));
  }
}

export async function sendReaction(
  conversationId: string,
  messageId: string,
  emoji: string
): Promise<void> {
  if (!conversationId || !messageId || !emoji) return;
  await api.post('/whatsapp/send-reaction', {
    conversationId,
    messageId,
    emoji,
  });
}

/** Mark a conversation as read for the current user */
export async function markConversationRead(conversationId: string): Promise<void> {
  if (!conversationId) return;
  await api.post('/whatsapp/conversations/read', {
    conversationId,
  });
}

export interface ConversationReader {
  userId: string;
  name: string;
  avatar: string | null;
  lastReadAt?: number;
  lastReadMessageId?: string;
}

/** WhatsApp template component (HEADER, BODY, BUTTONS, FOOTER) */
export interface WhatsAppTemplateComponent {
  type: string;
  format?: string;
  text?: string;
  url?: string;
  example?: { body_text?: string[]; header_text?: string[]; header_handle?: string[] };
  buttons?: Array<{ type: string; text?: string; url?: string }>;
  [key: string]: unknown;
}

/** WhatsApp message template from GET /api/whatsapp/templates */
export interface WhatsAppTemplate {
  id?: string;
  name: string;
  language?: string;
  status?: string;
  components?: WhatsAppTemplateComponent[];
}

/** Extract {{1}}, {{2}}, etc. from template components in order */
export function getTemplateVariables(template: WhatsAppTemplate): string[] {
  const seen = new Set<number>();
  const ordered: number[] = [];

  const extractFrom = (str: string | undefined) => {
    if (typeof str !== 'string') return;
    const regex = /\{\{(\d+)\}\}/g;
    let m;
    while ((m = regex.exec(str)) !== null) {
      const n = parseInt(m[1], 10);
      if (!seen.has(n)) {
        seen.add(n);
        ordered.push(n);
      }
    }
  };

  for (const comp of template.components ?? []) {
    if (comp.type === 'HEADER' && comp.format === 'TEXT') extractFrom(comp.text);
    if (comp.type === 'BODY') extractFrom(comp.text);
    if (comp.type === 'BUTTONS' && Array.isArray(comp.buttons)) {
      for (const btn of comp.buttons) {
        if (btn.type === 'URL' && btn.url) extractFrom(btn.url);
      }
    }
  }
  ordered.sort((a, b) => a - b);
  return ordered.map((n) => `{{${n}}}`);
}

/** WhatsApp template component for sending (header, body, button) */
export type WhatsAppSendComponent =
  | { type: 'header'; parameters: Array<{ type: string; text: string }> }
  | { type: 'body'; parameters: Array<{ type: string; text: string }> }
  | { type: 'button'; sub_type: 'url'; index: number; parameters: Array<{ type: string; text: string }> };

/** Build WhatsApp API components array from template + flat parameter values */
export function buildTemplateComponents(
  template: WhatsAppTemplate,
  values: string[]
): WhatsAppSendComponent[] {
  const components: WhatsAppSendComponent[] = [];
  let valueIdx = 0;

  const consumeParams = (count: number) => {
    const params: Array<{ type: string; text: string }> = [];
    for (let i = 0; i < count && valueIdx < values.length; i++) {
      params.push({ type: 'text', text: (values[valueIdx++] ?? '').trim() });
    }
    return params;
  };

  const countVarsIn = (str: string | undefined): number => {
    if (typeof str !== 'string') return 0;
    const matches = str.match(/\{\{\d+\}\}/g);
    return matches ? matches.length : 0;
  };

  for (const comp of template.components ?? []) {
    if (comp.type === 'HEADER' && comp.format === 'TEXT') {
      const n = countVarsIn(comp.text);
      if (n > 0) {
        components.push({ type: 'header', parameters: consumeParams(n) });
      }
    }
    if (comp.type === 'BODY') {
      const n = countVarsIn(comp.text);
      if (n > 0) {
        components.push({ type: 'body', parameters: consumeParams(n) });
      }
    }
    if (comp.type === 'BUTTONS' && Array.isArray(comp.buttons)) {
      let btnIdx = 0;
      for (const btn of comp.buttons) {
        if (btn.type === 'URL' && btn.url && countVarsIn(btn.url) > 0) {
          components.push({
            type: 'button',
            sub_type: 'url',
            index: btnIdx,
            parameters: consumeParams(1),
          });
        }
        btnIdx++;
      }
    }
  }
  return components;
}

/** Build preview text from template with values substituted for {{1}}, {{2}}, etc. */
export function getTemplatePreview(
  template: WhatsAppTemplate,
  values: string[]
): { header?: string; body?: string; footer?: string } {
  const replaceVars = (str: string | undefined): string => {
    if (typeof str !== 'string') return '';
    const vars = getTemplateVariables(template);
    let out = str;
    vars.forEach((v, i) => {
      const val = values[i]?.trim() ?? '';
      out = out.replace(new RegExp(`\\{\\{${i + 1}\\}\\}`, 'g'), val);
    });
    return out;
  };

  const result: { header?: string; body?: string; footer?: string } = {};
  for (const comp of template.components ?? []) {
    if (comp.type === 'HEADER' && comp.format === 'TEXT' && comp.text) {
      result.header = replaceVars(comp.text);
    }
    if (comp.type === 'BODY' && comp.text) {
      result.body = replaceVars(comp.text);
    }
    if (comp.type === 'FOOTER' && comp.text) {
      result.footer = comp.text; // footer typically has no vars
    }
  }
  return result;
}

interface TemplatesApiResponse {
  success?: boolean;
  templates?: WhatsAppTemplate[];
  warning?: string;
  code?: string;
  metaUnavailable?: boolean;
  wabaId?: string | null;
  wabaSource?: string;
  upstreamMessage?: string;
}

export interface FetchTemplatesResult {
  templates: WhatsAppTemplate[];
  warning?: string;
  code?: string;
  metaUnavailable?: boolean;
}

/**
 * Fetch approved WhatsApp templates from the backend.
 * Requires channel context — pass `conversationId` (preferred) or `phoneNumberId`.
 * Without either, the backend returns an empty list (no env fallback).
 */
export async function fetchWhatsAppTemplates(options?: {
  conversationId?: string;
  phoneNumberId?: string;
}): Promise<FetchTemplatesResult> {
  const params: Record<string, string> = {};
  if (options?.conversationId) params.conversationId = options.conversationId;
  else if (options?.phoneNumberId) params.phoneNumberId = options.phoneNumberId;

  const { data } = await api.get<TemplatesApiResponse>('/whatsapp/templates', { params });
  const list = data?.templates;
  return {
    templates: Array.isArray(list) ? list : [],
    warning: data?.warning,
    code: data?.code,
    metaUnavailable: data?.metaUnavailable,
  };
}

export interface SendTemplateParams {
  /** Recipient phone (E.164) - optional when conversationId provided (backend will resolve) */
  to?: string;
  /** Full template object for building components */
  template: WhatsAppTemplate;
  /** Values for {{1}}, {{2}}, etc. in order */
  parameters: string[];
  /** Conversation ID - required for DB association; backend uses this to resolve `to` if not provided */
  conversationId?: string;
  /** Filled template text for display in DB */
  templateText?: string;
  /** Area to resolve correct WhatsApp phoneNumberId (Athens vs Thessaloniki) */
  area?: WhatsAppArea;
  /** Optional phoneNumberId override (if already resolved) */
  phoneNumberId?: string;
}

function isMongoObjectId(id: string | undefined | null): boolean {
  if (!id) return false;
  // Strict 24-hex format. Draft IDs like "draft:918..." must not be sent as conversationId.
  return /^[a-fA-F0-9]{24}$/.test(id);
}

export async function sendTemplate(params: SendTemplateParams): Promise<{ success?: boolean; messageId?: string }> {
  const { to, template, parameters, conversationId, templateText, area, phoneNumberId: phoneNumberIdParam } =
    params;
  const languageCode = template.language ?? 'en';
  const components = buildTemplateComponents(template, parameters);
  const body: Record<string, unknown> = {
    templateName: template.name,
    languageCode,
    components,
    templateText,
  };
  if (isMongoObjectId(conversationId)) {
    body.conversationId = conversationId;
  } else if (phoneNumberIdParam) {
    body.phoneNumberId = phoneNumberIdParam;
  } else if (area) {
    const phoneId = await ensurePhoneId(area);
    if (phoneId) body.phoneNumberId = phoneId;
  }
  if (to?.trim()) {
    body.to = to.replace(/\D/g, '');
  }
  try {
    const { data } = await api.post<{ success?: boolean; messageId?: string }>(
      '/whatsapp/send-template',
      body
    );
    return data ?? {};
  } catch (e) {
    throw new Error(getApiErrorMessage(e, 'Failed to send template'));
  }
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
  query: string,
  options: { locationFilter?: LocationFilterValue } = {},
): Promise<ConversationSearchResult[]> {
  const params: Record<string, string | number> = {
    query,
    limit: 50,
  };
  const locationFilter = locationFilterToApiParam(options.locationFilter ?? 'all');
  if (locationFilter) {
    params.locationFilter = locationFilter;
  }

  const { data } = await api.get<UnifiedSearchApiResponse>('/whatsapp/search/unified', {
    params,
  });

  const rawConversations = (data?.results?.conversations ?? []) as Array<Record<string, unknown>>;

  // locationFilter is applied server-side for SuperAdmin; search payloads omit location keys.
  return rawConversations.map((conv) => {
    const id = (conv.conversationId as string) ?? (conv._id as string) ?? '';
    const phone = (conv.participantPhone as string) ?? '';
    const name = (conv.participantName as string) ?? phone ?? '';
    const participantProfilePic = (conv.participantProfilePic ??
      (conv as { profilePic?: string }).profilePic) as string | undefined;
    const participantLocationKey =
      typeof (conv as { participantLocationKey?: string }).participantLocationKey === 'string'
        ? String((conv as { participantLocationKey: string }).participantLocationKey)
            .toLowerCase()
            .trim()
        : typeof (conv as { participantLocation?: string }).participantLocation === 'string'
          ? String((conv as { participantLocation: string }).participantLocation)
              .toLowerCase()
              .trim()
          : undefined;
    const ctRaw = (conv as { conversationType?: string; type?: string }).conversationType ??
      (conv as { conversationType?: string; type?: string }).type;
    const conversationType =
      ctRaw === 'guest' || ctRaw === 'owner' ? (ctRaw as 'guest' | 'owner') : undefined;
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

    const listingLinkSentCount =
      typeof conv.listingLinkSentCount === 'number' ? (conv.listingLinkSentCount as number) : undefined;
    const optionsSentCount =
      typeof conv.optionsSentCount === 'number' ? (conv.optionsSentCount as number) : undefined;

    return {
      id,
      name,
      phone,
      participantProfilePic,
      participantLocationKey,
      conversationType,
      lastMessage,
      lastMessageAt,
      unreadCount,
      snippet,
      messageId: firstMatch?.messageId as string | undefined,
      messageTimestamp,
      listingLinkSentCount,
      optionsSentCount,
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

// ─── Archive / Unarchive ────────────────────────────────────────────────────

/** Archive a conversation for the current user (POST /whatsapp/conversations/archive) */
export async function archiveConversation(conversationId: string): Promise<void> {
  if (!conversationId) return;
  await api.post('/whatsapp/conversations/archive', { conversationId });
}

/** Unarchive a conversation for the current user (DELETE /whatsapp/conversations/archive) */
export async function unarchiveConversation(conversationId: string): Promise<void> {
  if (!conversationId) return;
  await api.delete('/whatsapp/conversations/archive', { params: { conversationId } });
}

// ─── Conversation counts ─────────────────────────────────────────────────────

export interface ConversationCounts {
  totalCount: number;
  ownerCount: number;
  guestCount: number;
  archivedCount?: number;
}

/** GET /whatsapp/conversations/counts */
export async function fetchConversationCounts(): Promise<ConversationCounts> {
  const { data } = await api.get<ConversationCounts & { success?: boolean }>('/whatsapp/conversations/counts');
  return {
    totalCount: data?.totalCount ?? 0,
    ownerCount: data?.ownerCount ?? 0,
    guestCount: data?.guestCount ?? 0,
    archivedCount: data?.archivedCount,
  };
}

// ─── Conversation meta ───────────────────────────────────────────────────────

export interface ConversationMetaParams {
  participantName?: string;
  participantProfilePic?: string;
  conversationType?: 'owner' | 'guest';
  participantLocation?: string;
}

/** POST /whatsapp/conversations/:id/meta */
export async function updateConversationMeta(
  conversationId: string,
  params: ConversationMetaParams
): Promise<void> {
  if (!conversationId) return;
  await api.post(`/whatsapp/conversations/${conversationId}/meta`, params);
}

// ─── Forward messages ────────────────────────────────────────────────────────

export interface ForwardMessagesResult {
  success: boolean;
  results: Array<{ messageId: string; conversationId: string; success: boolean }>;
  errors?: Array<{ messageId: string; conversationId: string; error: string }>;
  summary?: { total: number; successful: number; failed: number };
}

/** POST /whatsapp/forward-message — forward messages to one or more conversations */
export async function forwardMessages(
  messageIds: string[],
  conversationIds: string[],
): Promise<ForwardMessagesResult> {
  if (!messageIds.length || !conversationIds.length) {
    return { success: false, results: [] };
  }
  const { data } = await api.post<ForwardMessagesResult>('/whatsapp/forward-message', {
    messageIds,
    conversationIds,
  });
  return data ?? { success: false, results: [] };
}

// ─── Bunny CDN upload ────────────────────────────────────────────────────────

export interface UploadToBunnyResult {
  success?: boolean;
  url?: string;
  filename?: string;
  mimeType?: string;
  size?: number;
}

/** POST /whatsapp/upload-to-bunny — upload a file to Bunny CDN, returns public URL */
export async function uploadToBunny(params: {
  uri: string;
  mimeType: string;
  filename: string;
}): Promise<UploadToBunnyResult> {
  const form = new FormData();
  form.append('file', {
    uri: params.uri,
    name: params.filename,
    type: params.mimeType,
  } as any);
  const { data } = await api.post<UploadToBunnyResult>('/whatsapp/upload-to-bunny', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data ?? {};
}

export {
  fetchCallPermissions,
  fetchIceServers,
  sendCallPermissionRequest,
  startWhatsAppCall,
  terminateWhatsAppCall,
  answerIncomingWhatsAppCall,
  rejectIncomingWhatsAppCall,
  parseCallPermissionState,
} from './call.api';
export type { CallPermissionState, StartCallResult, CallAction } from './call.api';

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
