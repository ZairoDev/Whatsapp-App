import { vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, type RenderOptions } from '@testing-library/react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ChatAppStackParamList } from '../../../../core/navigation/ChatAppStack';
import type { Conversation } from '../../types';
import type { PhoneConfig } from '../../types';
import type { TokenInterface } from '../../../auth/types';
import { useAuthStore } from '../../../auth/auth.store';
import { useChatStore } from '../../chat.store';

export type ConversationListProps = NativeStackScreenProps<ChatAppStackParamList, 'ConversationList'>;

export const mockNavigate = vi.fn();

/** React Native Testing Library `press` equivalent for DOM tests. */
export function press(element: Element) {
  fireEvent.click(element);
}

/** React Native Testing Library `longPress` equivalent for DOM tests. */
export function longPress(element: Element) {
  fireEvent.contextMenu(element);
}

export function createMockNavigation(): ConversationListProps['navigation'] {
  return {
    navigate: mockNavigate,
    goBack: vi.fn(),
    dispatch: vi.fn(),
    reset: vi.fn(),
    setParams: vi.fn(),
    setOptions: vi.fn(),
    isFocused: vi.fn(() => true),
    canGoBack: vi.fn(() => false),
    getId: vi.fn(() => 'nav-id'),
    getParent: vi.fn(),
    getState: vi.fn(),
    addListener: vi.fn(() => vi.fn()),
    removeListener: vi.fn(),
    push: vi.fn(),
    pop: vi.fn(),
    popToTop: vi.fn(),
    replace: vi.fn(),
  } as unknown as ConversationListProps['navigation'];
}

export function createMockRoute(
  params?: ChatAppStackParamList['ConversationList'],
): ConversationListProps['route'] {
  return {
    key: 'ConversationList-key',
    name: 'ConversationList',
    params,
  };
}

export const mockTokenData: TokenInterface = {
  role: 'SuperAdmin',
  allotedArea: ['athens', 'thessaloniki'],
  email: 'admin@test.com',
  name: 'Admin',
};

export function makePhoneConfig(overrides: Partial<PhoneConfig> = {}): PhoneConfig {
  return {
    phoneNumberId: 'phone-1',
    displayName: 'Line 1',
    area: 'athens',
    channelId: 'channel-1',
    ...overrides,
  };
}

export function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: overrides.id ?? 'conv-1',
    name: overrides.name ?? 'Alice Example',
    lastMessage: overrides.lastMessage ?? 'Hello there',
    lastMessageAt: overrides.lastMessageAt ?? Date.now(),
    unreadCount: overrides.unreadCount ?? 0,
    phone: overrides.phone ?? '306912345678',
    participantLocationKey: overrides.participantLocationKey ?? 'athens',
    conversationType: overrides.conversationType ?? 'owner',
    isFavorite: overrides.isFavorite ?? false,
    ...overrides,
  };
}

export function resetStores({
  conversations = [] as Conversation[],
  phoneConfigs = [] as PhoneConfig[],
  archivedCount = 0,
  tokenData = mockTokenData,
}: {
  conversations?: Conversation[];
  phoneConfigs?: PhoneConfig[] | null;
  archivedCount?: number;
  tokenData?: TokenInterface | null;
} = {}) {
  useChatStore.setState({
    conversations,
    phoneConfigs,
    archivedCount,
    activeConversationId: null,
    messages: {},
    archivedConversations: [],
    isLoading: false,
    error: null,
  });
  useAuthStore.setState({
    tokenData,
    isHydrated: true,
    sessionExpired: false,
  });
}

export function renderConversationList(
  ui: React.ReactElement,
  options?: RenderOptions,
) {
  return render(ui, options);
}

/** React Native Testing Library `changeText` equivalent for DOM tests. */
export function changeText(element: Element, value: string) {
  fireEvent.change(element, { target: { value } });
}

export { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
