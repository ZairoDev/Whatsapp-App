import { create } from 'zustand';
import type { ChatState, Conversation, Message, PhoneConfig } from './types';

interface ChatStore extends ChatState {
  setConversations: (conversations: Conversation[]) => void;
  appendConversations: (conversations: Conversation[]) => void;
  setArchivedConversations: (archivedConversations: Conversation[]) => void;
  setActiveConversation: (id: string | null) => void;
  setMessages: (conversationId: string, messages: Message[]) => void;
  addMessage: (message: Message) => void;
  upsertMessage: (message: Message) => void;
  updateMessageStatus: (conversationId: string, whatsappMessageId: string, status: Message['status']) => void;
  upsertConversationFromMessage: (payload: {
    conversationId: string;
    previewText: string;
    timestamp: number;
    direction?: 'incoming' | 'outgoing';
  }) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setPhoneConfigs: (configs: PhoneConfig[]) => void;
  reset: () => void;
}

const initialState: ChatState = {
  conversations: [],
  activeConversationId: null,
  messages: {},
  phoneConfigs: null,
  isLoading: false,
  error: null,
};

export const useChatStore = create<ChatStore>((set) => ({
  ...initialState,
  setConversations: (conversations) => set({ conversations }),
  appendConversations: (conversations) =>
    set((state) => {
      const existingIds = new Set(state.conversations.map((c) => c.id));
      const newOnes = conversations.filter((c) => !existingIds.has(c.id));
      return { conversations: [...state.conversations, ...newOnes] };
    }),
    setArchivedConversations: (archivedConversations) =>
      set((state) => ({
        ...state,
        archivedConversations,
      })),
  setActiveConversation: (activeConversationId) => set({ activeConversationId }),
  setMessages: (conversationId, messages) =>
    set((state) => ({
      messages: { ...state.messages, [conversationId]: messages },
    })),
  addMessage: (message) =>
    set((state) => {
      const list = state.messages[message.conversationId] ?? [];
      return {
        messages: {
          ...state.messages,
          // Messages are stored newest-first (index 0 = newest) because
          // ConversationDetailScreen renders an inverted FlatList.
          [message.conversationId]: [message, ...list],
        },
      };
    }),
  upsertMessage: (message) =>
    set((state) => {
      const list = state.messages[message.conversationId] ?? [];
      const key = message.whatsappMessageId ?? message.id;
      const idx = list.findIndex((m) => (m.whatsappMessageId ?? m.id) === key);
      // If we didn't find by canonical key but this is an outgoing message with a
      // WhatsApp message id (wamid), try to merge into a local optimistic bubble
      // that was created before the wamid existed.
      let optimisticIdx = -1;
      if (idx === -1 && message.direction === 'outgoing' && message.whatsappMessageId) {
        optimisticIdx = list.findIndex((m) => {
          if (m.direction !== 'outgoing') return false;
          if (m.whatsappMessageId) return false;
          // Only attempt to link to a bubble we created optimistically.
          if (m.status !== 'sending' && m.status !== 'sent') return false;
          // Basic heuristic: same text + close timestamp.
          if ((m.content ?? '').trim() !== (message.content ?? '').trim()) return false;
          const dt = Math.abs((m.timestamp ?? 0) - (message.timestamp ?? 0));
          return dt <= 2 * 60 * 1000; // 2 minutes
        });
      }

      const updated =
        idx >= 0
          ? [...list.slice(0, idx), { ...list[idx], ...message }, ...list.slice(idx + 1)]
          : optimisticIdx >= 0
            ? [
                ...list.slice(0, optimisticIdx),
                { ...list[optimisticIdx], ...message, whatsappMessageId: message.whatsappMessageId },
                ...list.slice(optimisticIdx + 1),
              ]
            : [message, ...list];

      // Keep newest-first by timestamp so new realtime messages appear at bottom
      // (inverted FlatList renders index 0 at the bottom).
      const next = [...updated].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
      return { messages: { ...state.messages, [message.conversationId]: next } };
    }),
  updateMessageStatus: (conversationId, whatsappMessageId, status) =>
    set((state) => {
      const list = state.messages[conversationId] ?? [];
      const idx = list.findIndex((m) => m.whatsappMessageId === whatsappMessageId || m.id === whatsappMessageId);
      // If we can't find by wamid, try to attach this wamid to the most recent
      // outgoing optimistic bubble that doesn't yet have a whatsappMessageId.
      let targetIdx = idx;
      if (targetIdx === -1) {
        const candidates = list
          .map((m, i) => ({ m, i }))
          .filter(
            ({ m }) =>
              m.direction === 'outgoing' &&
              !m.whatsappMessageId &&
              (m.status === 'sending' || m.status === 'sent')
          );
        // list is newest-first; pick the first (most recent) candidate.
        targetIdx = candidates.length ? candidates[0].i : -1;
      }

      if (targetIdx === -1) return state as any;
      const existing = list[targetIdx];
      if (existing.status === status) return state as any;
      const next = [...list];
      next[targetIdx] = {
        ...existing,
        whatsappMessageId: existing.whatsappMessageId ?? whatsappMessageId,
        status,
      };
      return { messages: { ...state.messages, [conversationId]: next } };
    }),
  upsertConversationFromMessage: ({ conversationId, previewText, timestamp, direction }) =>
    set((state) => {
      const list = state.conversations ?? [];
      const idx = list.findIndex((c) => c.id === conversationId);
      if (idx === -1) return state as any;
      const conv = list[idx];
      const unreadCount =
        direction === 'incoming' && state.activeConversationId !== conversationId
          ? (conv.unreadCount ?? 0) + 1
          : conv.unreadCount ?? 0;
      const updated: Conversation = {
        ...conv,
        lastMessage: previewText,
        lastMessageAt: timestamp,
        unreadCount,
      };
      const next = [...list];
      next[idx] = updated;
      // keep newest-first by lastMessageAt
      next.sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0));
      return { conversations: next };
    }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
  setPhoneConfigs: (phoneConfigs) => set({ phoneConfigs }),
  reset: () => set(initialState),
}));
