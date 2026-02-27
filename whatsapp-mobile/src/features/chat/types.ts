/**
 * Chat feature types.
 */
export interface Message {
  id: string;
  conversationId: string;
  senderId?: string;
  content: string;
  timestamp: number;
  status?: 'sending' | 'sent' | 'delivered' | 'read';
  type: 'text' | 'image' | 'audio' | 'video';
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
}

export interface ChatState {
  conversations: Conversation[];
  activeConversationId: string | null;
  messages: Record<string, Message[]>;
  isLoading: boolean;
  error: string | null;
}
