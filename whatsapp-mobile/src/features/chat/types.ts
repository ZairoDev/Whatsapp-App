/**
 * Chat feature types.
 */

/** Quoted/replied-to message context returned by the server */
export interface ReplyContext {
  messageId: string;
  from: string;
  type: string;
  content?: {
    text?: string;
    caption?: string;
  };
  mediaUrl?: string;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId?: string;
  /** WhatsApp message ID (wamid) for reactions/replies */
  whatsappMessageId?: string;
  /** If this message is a reaction, which WhatsApp message ID it targets */
  reactedToMessageId?: string;
  /** If this message is a reaction, the emoji used */
  reactionEmoji?: string;
  /** Aggregated reactions attached to a base message */
  reactions?: { emoji: string; count: number; fromSelf?: boolean }[];
  content: string;
  timestamp: number;
  status?: 'sending' | 'sent' | 'delivered' | 'read' | 'failed';
  type: 'text' | 'image' | 'audio' | 'video' | 'reaction' | 'document' | 'sticker' | 'location' | 'interactive' | 'template';
  direction?: 'incoming' | 'outgoing';
  displayText?: string;
  /** URL for image/video/audio/document media. Used to render media in the bubble. */
  mediaUrl?: string;
  /** Optional thumbnail URL for video messages. Falls back to mediaUrl if not set. */
  thumbnailUrl?: string;
  /** Original filename for document messages */
  filename?: string;
  /** File size in bytes for document messages */
  fileSize?: number;
  /** MIME type for document messages */
  mimeType?: string;
  /** Source of the message: Meta WhatsApp or internal ("You" conversation) */
  source?: 'meta' | 'internal';
  /** True when this is an internal note (never sent via Meta) */
  isInternal?: boolean;
  /** True when this message was forwarded from another conversation */
  isForwarded?: boolean;
  /** wamid of the message being replied to (set when this message replies to another) */
  replyToMessageId?: string;
  /** Full context of the quoted/replied-to message (from server) */
  replyContext?: ReplyContext;
  /** Location payload for type='location' */
  location?: {
    latitude: number;
    longitude: number;
    name?: string;
    address?: string;
  };
}

export interface Conversation {
  id: string;
  name: string;
  lastMessage?: string;
  lastMessageAt?: number;
  unreadCount: number;
  /** Avatar URL (if available). */
  avatar?: string;
  /** Profile picture for the participant (guest/owner) when provided by backend. */
  participantProfilePic?: string;
  /** Participant phone (E.164) for sending templates */
  phone?: string;
  /** Conversation category (Adminstro model): owner vs guest. */
  conversationType?: 'owner' | 'guest';
  /** Whether this conversation is marked as favourite in the UI */
  isFavorite?: boolean;
  /**
   * True when the WhatsApp 24-hour customer-service window has expired.
   * The backend sets this; the client NEVER computes it independently.
   * When true the composer switches to template-only mode.
   */
  templateOnly?: boolean;
  /**
   * Unix ms timestamp at which the 24-hour messaging window closes
   * (= lastIncomingMessageTime + 24 h). Present only when a customer
   * message has been received. Used to show a live countdown.
   */
  windowExpiresAt?: number;
  /**
   * True for the "You" / self-chat conversation.
   * Self-chats are personal notes — they NEVER use template-only mode.
   */
  isSelf?: boolean;
  /** Normalized city key from backend (e.g. "athens") — used for workspace inbox filtering. */
  participantLocationKey?: string;
  /** Meta business phone line id for this thread. */
  businessPhoneId?: string;
  /** Outgoing VacationSaga listing links sent to this guest (from GET /whatsapp/conversations). */
  listingLinkSentCount?: number;
  /** Outgoing text messages matching "options sent" (guests only). */
  optionsSentCount?: number;
  /** True when this conversation has been archived by the current user */
  isArchivedByUser?: boolean;
  /** Timestamp when archived */
  archivedAt?: number;
  /**
   * WhatsappChannel._id frozen at conversation creation.
   * Used by the backend for outbound routing across WABA migrations;
   * the mobile stores it so it can be included in socket room management.
   */
  whatsappChannelId?: string;
  /**
   * Channel type frozen at creation: which audience this number targets.
   * guest = booking guests, owner = property owners, support/backup = internal.
   */
  channelType?: 'guest' | 'owner' | 'support' | 'backup';
  /**
   * Rental-type dimension frozen at creation: Short Term, Long Term, or General.
   * Controls which employees see the conversation in the inbox.
   */
  rentalType?: 'Short Term' | 'Long Term' | 'General';
}

/** Shape returned by GET /api/whatsapp/phone-configs */
export interface PhoneConfig {
  phoneNumberId: string;
  displayNumber?: string;
  displayName?: string;
  area: string | string[];
  businessAccountId?: string;
  isInternal?: boolean;
  /** WhatsappChannel._id — present for DB-managed channels (not legacy .env lines). */
  channelId?: string;
  /** Locations assigned to this phone line (from DB PhoneAreaConfig + Channel.assignedLocations). */
  locations?: { displayName: string; locationKey: string }[];
}

export interface ChatState {
  conversations: Conversation[];
  activeConversationId: string | null;
  messages: Record<string, Message[]>;
  /** Phone configs fetched from the backend (DB channels + legacy lines). Null = not yet loaded. */
  phoneConfigs: PhoneConfig[] | null;
  /** Archived conversations list */
  archivedConversations: Conversation[];
  /** Total archived count from /whatsapp/conversations/counts */
  archivedCount: number;
  isLoading: boolean;
  error: string | null;
}
