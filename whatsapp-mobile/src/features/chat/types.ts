/**
 * Chat feature types.
 */
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
  type: 'text' | 'image' | 'audio' | 'video' | 'reaction';
  direction?: 'incoming' | 'outgoing';
  displayText?: string;
  /** URL for image/video/audio media. Used to render image/video in the bubble. */
  mediaUrl?: string;
  /** Optional thumbnail URL for video messages. Falls back to mediaUrl if not set. */
  thumbnailUrl?: string;
}

export interface Conversation {
  id: string;
  name: string;
  lastMessage?: string;
  lastMessageAt?: number;
  unreadCount: number;
  avatar?: string;
  /** Participant phone (E.164) for sending templates */
  phone?: string;
  /** Whether this conversation is marked as favourite in the UI */
  isFavorite?: boolean;
  /**
   * True when the WhatsApp 24-hour customer-service window has expired.
   * The backend sets this; the client NEVER computes it independently.
   * When true the composer switches to template-only mode.
   */
  templateOnly?: boolean;
  /**
   * True for the "You" / self-chat conversation.
   * Self-chats are personal notes — they NEVER use template-only mode.
   */
  isSelf?: boolean;
}

export interface ChatState {
  conversations: Conversation[];
  activeConversationId: string | null;
  messages: Record<string, Message[]>;
  isLoading: boolean;
  error: string | null;
}
