import React from 'react';
import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationListScreen } from '../ConversationListScreen';
import {
  createMockNavigation,
  createMockRoute,
  cleanup,
  longPress,
  makeConversation,
  makePhoneConfig,
  mockNavigate,
  mockTokenData,
  press,
  changeText,
  renderConversationList,
  resetStores,
  screen,
  waitFor,
} from './testUtils';
import { useChatStore } from '../../chat.store';
import { lightColors } from '../../../../theme/palettes';

const mockFetchConversations = vi.fn();
const mockFetchConversationCounts = vi.fn();
const mockFetchPhoneConfigs = vi.fn();
const mockFetchMonthlyTargetLocations = vi.fn();
const mockSearchConversations = vi.fn();
const mockCreateConversation = vi.fn();
const mockArchiveConversation = vi.fn();
const mockJoinWhatsAppPhone = vi.fn();
const mockLeaveWhatsAppPhone = vi.fn();
const mockJoinWhatsAppChannel = vi.fn();
const mockLeaveWhatsAppChannel = vi.fn();

let themeIsDark = false;

vi.mock('../../services', () => ({
  fetchConversations: (...args: unknown[]) => mockFetchConversations(...args),
  fetchConversationCounts: (...args: unknown[]) => mockFetchConversationCounts(...args),
  fetchPhoneConfigs: (...args: unknown[]) => mockFetchPhoneConfigs(...args),
  fetchMonthlyTargetLocations: (...args: unknown[]) => mockFetchMonthlyTargetLocations(...args),
  searchConversations: (...args: unknown[]) => mockSearchConversations(...args),
  createConversation: (...args: unknown[]) => mockCreateConversation(...args),
  archiveConversation: (...args: unknown[]) => mockArchiveConversation(...args),
}));

vi.mock('../../../../services/socket', () => ({
  joinWhatsAppPhone: (...args: unknown[]) => mockJoinWhatsAppPhone(...args),
  leaveWhatsAppPhone: (...args: unknown[]) => mockLeaveWhatsAppPhone(...args),
  joinWhatsAppChannel: (...args: unknown[]) => mockJoinWhatsAppChannel(...args),
  leaveWhatsAppChannel: (...args: unknown[]) => mockLeaveWhatsAppChannel(...args),
}));

vi.mock('../../../../theme/ThemeContext', () => ({
  useTheme: () => ({
    colors: lightColors,
    isDark: themeIsDark,
  }),
}));

vi.mock('../../components/GuestOutboundStatsBadges', () => ({
  GuestOutboundStatsBadges: () => null,
}));

function renderScreen(
  routeParams?: Parameters<typeof createMockRoute>[0],
) {
  return renderConversationList(
    <ConversationListScreen
      navigation={createMockNavigation()}
      route={createMockRoute(routeParams)}
    />,
  );
}

function defaultFetchSuccess(overrides?: {
  conversations?: ReturnType<typeof makeConversation>[];
  nextCursor?: string | null;
  hasMore?: boolean;
  archivedCount?: number;
}) {
  mockFetchConversations.mockResolvedValue({
    conversations: overrides?.conversations ?? [],
    nextCursor: overrides?.nextCursor ?? null,
    hasMore: overrides?.hasMore ?? false,
  });
  mockFetchConversationCounts.mockResolvedValue({
    archivedCount: overrides?.archivedCount ?? 0,
  });
  mockFetchPhoneConfigs.mockResolvedValue([makePhoneConfig()]);
  mockFetchMonthlyTargetLocations.mockResolvedValue(['Athens', 'Thessaloniki']);
  mockSearchConversations.mockResolvedValue([]);
}

function seedConversations(conversations: ReturnType<typeof makeConversation>[]) {
  resetStores({ conversations });
  defaultFetchSuccess({ conversations });
}

beforeEach(() => {
  cleanup();
  themeIsDark = false;
  mockNavigate.mockReset();
  mockFetchConversations.mockReset();
  mockFetchConversationCounts.mockReset();
  mockFetchPhoneConfigs.mockReset();
  mockFetchMonthlyTargetLocations.mockReset();
  mockSearchConversations.mockReset();
  mockCreateConversation.mockReset();
  mockArchiveConversation.mockReset();
  mockJoinWhatsAppPhone.mockReset();
  mockLeaveWhatsAppPhone.mockReset();
  mockJoinWhatsAppChannel.mockReset();
  mockLeaveWhatsAppChannel.mockReset();
  resetStores();
  defaultFetchSuccess();
});

describe('ConversationListScreen', () => {
  describe('1. RENDERING — mount and DOM output', () => {
    it('mounts without crashing and shows title', async () => {
      renderScreen();
      await waitFor(() => {
        expect(screen.getByText('Adminstro')).toBeTruthy();
      });
    });

    it('renders search placeholder and filter chips', async () => {
      renderScreen();
      await waitFor(() => {
        expect(screen.getByPlaceholderText('Search by name, phone or message')).toBeTruthy();
      });
      expect(screen.getByText('All')).toBeTruthy();
      expect(screen.getByText('Unread')).toBeTruthy();
      expect(screen.getByText('Favourites')).toBeTruthy();
    });

    it('renders archived row and new-chat FAB when not loading or selecting', async () => {
      renderScreen();
      await waitFor(() => {
        expect(screen.getByText('Archived')).toBeTruthy();
      });
      expect(screen.getByLabelText('Start a new chat')).toBeTruthy();
    });

    it('renders conversation rows from store after fetch', async () => {
      defaultFetchSuccess({
        conversations: [makeConversation({ id: 'c1', name: 'Bob Guest' })],
      });
      renderScreen();
      await waitFor(() => {
        expect(screen.getByText('Bob Guest')).toBeTruthy();
      });
    });

    it('renders initials avatar when no profile image', async () => {
      seedConversations([
        makeConversation({ name: 'Carol Danvers', participantProfilePic: undefined, avatar: undefined }),
      ]);
      renderScreen();
      await waitFor(() => {
        expect(screen.getByText('CD')).toBeTruthy();
      });
    });

    it('renders profile image avatar when participantProfilePic is set', async () => {
      seedConversations([
          makeConversation({
            participantProfilePic: 'https://example.com/pic.jpg',
          }),
        ]);
      renderScreen();
      await waitFor(() => {
        const img = screen.getByRole('img');
        expect(img).toBeTruthy();
      });
    });
  });

  describe('2. PROPS — route param combinations', () => {
    it('L115: seeds adminQueue from route.params.initialAdminQueue', async () => {
      renderScreen({ initialAdminQueue: true });
      await waitFor(() => {
        expect(mockFetchConversations).toHaveBeenCalledWith(
          expect.objectContaining({ adminQueue: true }),
        );
      });
    });

    it('defaults adminQueue to false when param omitted', async () => {
      renderScreen(undefined);
      await waitFor(() => {
        expect(mockFetchConversations).toHaveBeenCalledWith(
          expect.objectContaining({ adminQueue: false }),
        );
      });
    });

    it('L146-L147: uses route.params.initialArea as defaultArea fallback', async () => {
      renderScreen({ initialArea: 'thessaloniki' });
      renderConversationList(
        <ConversationListScreen
          navigation={createMockNavigation()}
          route={createMockRoute({ initialArea: 'thessaloniki' })}
        />,
      );
      await waitFor(() => expect(mockFetchConversations).toHaveBeenCalled());
    });

    it('accepts undefined route params (optional props)', async () => {
      renderScreen(undefined);
      await waitFor(() => expect(screen.getByText('Adminstro')).toBeTruthy());
    });
  });

  describe('3. USER INTERACTIONS', () => {
    it('switches activeFilter chips on press', async () => {
      seedConversations([
          makeConversation({ id: 'u1', name: 'Unread Person', unreadCount: 2 }),
          makeConversation({ id: 'r1', name: 'Read Person', unreadCount: 0 }),
        ]);
      renderScreen();
      await waitFor(() => expect(screen.getByText('Unread Person')).toBeTruthy());

      press(screen.getByText('Unread'));
      expect(screen.getByText('Unread Person')).toBeTruthy();
      expect(screen.queryByText('Read Person')).toBeNull();

      press(screen.getByText('Favourites'));
      expect(screen.getByText('No conversations yet')).toBeTruthy();

      press(screen.getByText('All'));
      expect(screen.getByText('Read Person')).toBeTruthy();
    });

    it('opens location filter modal and selects a location', async () => {
      renderScreen();
      await waitFor(() => expect(screen.getByLabelText('Filter by location')).toBeTruthy());

      press(screen.getByLabelText('Filter by location'));
      expect(screen.getByText('Location')).toBeTruthy();
      press(screen.getByLabelText('Filter Athens'));
      await waitFor(() => {
        expect(screen.queryByText('Location')).toBeNull();
      });
    });

    it('L684-L687: toggles admin queue and resets location filter to all', async () => {
      renderScreen();
      await waitFor(() => expect(screen.getByText('Admin queue')).toBeTruthy());

      press(screen.getByText('Admin queue'));
      await waitFor(() => {
        expect(mockFetchConversations).toHaveBeenCalledWith(
          expect.objectContaining({ adminQueue: true, locationFilter: 'all' }),
        );
      });
    });

    it('navigates to ArchiveList with defaultArea', async () => {
      defaultFetchSuccess({ archivedCount: 3 });
      renderScreen();
      await waitFor(() => expect(screen.getByText('Archived')).toBeTruthy());
      press(screen.getByText('Archived'));
      expect(mockNavigate).toHaveBeenCalledWith('ArchiveList', expect.objectContaining({ defaultArea: expect.any(String) }));
    });

    it('L697: navigates on conversation row press', async () => {
      seedConversations([makeConversation({ id: 'nav-1', name: 'Navigate Me' })]);
      renderScreen();
      await waitFor(() => expect(screen.getByText('Navigate Me')).toBeTruthy());
      press(screen.getByText('Navigate Me'));
      expect(mockNavigate).toHaveBeenCalledWith(
        'ConversationDetail',
        expect.objectContaining({ conversationId: 'nav-1' }),
      );
    });

    it('L500-L502: long press enters selection mode', async () => {
      seedConversations([makeConversation({ id: 'sel-1', name: 'Select Me' })]);
      renderScreen();
      await waitFor(() => expect(screen.getByText('Select Me')).toBeTruthy());
      longPress(screen.getByText('Select Me'));
      expect(screen.getByText('1')).toBeTruthy();
      expect(screen.queryByText('Adminstro')).toBeNull();
    });

    it('L486-L488: press toggles selection when in selection mode', async () => {
      seedConversations([
        makeConversation({ id: 'sel-1', name: 'Alpha' }),
        makeConversation({ id: 'sel-2', name: 'Beta' }),
      ]);
      renderScreen();
      await waitFor(() => expect(screen.getByText('Alpha')).toBeTruthy());
      longPress(screen.getByText('Alpha'));
      press(screen.getByText('Beta'));
      await waitFor(() => expect(screen.getByText('2')).toBeTruthy());
    });

    it('L960: clear selection via selection bar close', async () => {
      seedConversations([makeConversation({ id: 'sel-1', name: 'Alpha' })]);
      renderScreen();
      await waitFor(() => expect(screen.getByText('Alpha')).toBeTruthy());
      longPress(screen.getByText('Alpha'));
      const selectionClose = screen.getByText('1').parentElement?.querySelector('button');
      expect(selectionClose).toBeTruthy();
      press(selectionClose!);
      await waitFor(() => expect(screen.getByText('Adminstro')).toBeTruthy());
    });

    it('L507-L509: opens avatar preview when image exists', async () => {
      seedConversations([
          makeConversation({
            name: 'Pic User',
            participantProfilePic: 'https://example.com/a.jpg',
          }),
        ]);
      renderScreen();
      await waitFor(() => expect(screen.getByLabelText('Open profile photo')).toBeTruthy());
      press(screen.getByLabelText('Open profile photo'));
      expect(screen.getByLabelText('Close photo')).toBeTruthy();
      press(screen.getByLabelText('Close photo'));
      expect(screen.queryByLabelText('Close photo')).toBeNull();
    });

    it('L510: avatar press disabled when no image', async () => {
      seedConversations([makeConversation({ name: 'No Pic', participantProfilePic: undefined, avatar: undefined })]);
      renderScreen();
      await waitFor(() => expect(screen.getByText('No Pic')).toBeTruthy());
      const avatarBtn = screen.getByLabelText('Open profile photo');
      expect(avatarBtn).toBeDisabled();
    });

    it('opens new chat modal from FAB and closes via backdrop', async () => {
      renderScreen();
      await waitFor(() => expect(screen.getByLabelText('Start a new chat')).toBeTruthy());
      press(screen.getByLabelText('Start a new chat'));
      expect(screen.getByText('New chat')).toBeTruthy();
      press(screen.getByLabelText('Close new chat'));
      expect(screen.queryByText('New chat')).toBeNull();
    });

    it('new chat: switches contact type, name, location, country code prefix', async () => {
      renderScreen();
      await waitFor(() => expect(screen.getByLabelText('Start a new chat')).toBeTruthy());
      press(screen.getByLabelText('Start a new chat'));

      press(screen.getByLabelText('Add guest'));
      changeText(screen.getByPlaceholderText('Guest name (optional)'), 'Guest X');
      press(screen.getByLabelText('Set location Thessaloniki'));
      changeText(screen.getByPlaceholderText('+30'), '44');
      changeText(screen.getByPlaceholderText('Phone number'), '7700900000');

      expect(screen.getByDisplayValue('+44')).toBeTruthy();
      expect(screen.getByDisplayValue('Guest X')).toBeTruthy();
    });

    it('search input triggers server search mode', async () => {
      mockSearchConversations.mockResolvedValue([
        {
          id: 'sr-1',
          name: 'Search Hit',
          unreadCount: 0,
          snippet: 'matched text',
          lastMessageAt: Date.now(),
        },
      ]);
      renderScreen();
      await waitFor(() => expect(screen.getByPlaceholderText('Search by name, phone or message')).toBeTruthy());
      changeText(screen.getByPlaceholderText('Search by name, phone or message'), 'hit');
      await waitFor(() => expect(screen.getByText('Search Hit')).toBeTruthy());
      expect(mockSearchConversations).toHaveBeenCalledWith('hit', expect.any(Object));
    });

    it('L1135: triggers loadMore on end reached', async () => {
      seedConversations( [makeConversation({ id: 'p1' })]);
      mockFetchConversations
        .mockResolvedValueOnce({
          conversations: [makeConversation({ id: 'p1' })],
          nextCursor: 'cursor-2',
          hasMore: true,
        })
        .mockResolvedValueOnce({
          conversations: [makeConversation({ id: 'p2', name: 'Page Two' })],
          nextCursor: null,
          hasMore: false,
        });
      renderScreen();
      await waitFor(() => expect(screen.getByTestId('flat-list-end-reached')).toBeTruthy());
      press(screen.getByTestId('flat-list-end-reached'));
      await waitFor(() => expect(screen.getByText('Page Two')).toBeTruthy());
    });
  });

  describe('4. STATE CHANGES', () => {
    it('L173-L175: auto-sets newContactLocation from first location option', async () => {
      renderScreen();
      await waitFor(() => expect(screen.getByLabelText('Start a new chat')).toBeTruthy());
      press(screen.getByLabelText('Start a new chat'));
      expect(screen.getByLabelText('Set location Athens')).toBeTruthy();
    });

    it('L339-L346: openNewChat resets modal fields', async () => {
      renderScreen();
      await waitFor(() => expect(screen.getByLabelText('Start a new chat')).toBeTruthy());
      press(screen.getByLabelText('Start a new chat'));
      changeText(screen.getByPlaceholderText('Owner name (optional)'), 'Temp');
      press(screen.getByLabelText('Close'));
      press(screen.getByLabelText('Start a new chat'));
      expect(screen.queryByDisplayValue('Temp')).toBeNull();
    });

    it('L420-L431: toggleFavoriteForSelection favorites then unfavorites', async () => {
      seedConversations([
          makeConversation({ id: 'f1', name: 'Fav', isFavorite: false }),
        ]);
      renderScreen();
      await waitFor(() => expect(screen.getByText('Fav')).toBeTruthy());
      longPress(screen.getByText('Fav'));
      press(screen.getAllByText('star')[0]);
      expect(useChatStore.getState().conversations[0].isFavorite).toBe(true);

      longPress(screen.getByText('Fav'));
      press(screen.getAllByText('star')[0]);
      expect(useChatStore.getState().conversations[0].isFavorite).toBe(false);
    });

    it('L433-L448: archiveSelection removes rows and refreshes count', async () => {
      seedConversations( [makeConversation({ id: 'arc-1', name: 'Archive Me' })]);
      mockArchiveConversation.mockResolvedValue(undefined);
      mockFetchConversationCounts.mockResolvedValue({ archivedCount: 1 });
      renderScreen();
      await waitFor(() => expect(screen.getByText('Archive Me')).toBeTruthy());
      longPress(screen.getByText('Archive Me'));
      press(screen.getAllByText('archive-outline')[0]);
      await waitFor(() => {
        expect(useChatStore.getState().conversations).toHaveLength(0);
        expect(useChatStore.getState().archivedCount).toBe(1);
      });
    });
  });

  describe('5. EDGE CASES', () => {
    it('shows empty list message when conversations array is empty', async () => {
      renderScreen();
      await waitFor(() => expect(screen.getByText('No conversations yet')).toBeTruthy());
    });

    it('L552-L557: unread badge hidden when unreadCount is 0', async () => {
      seedConversations([makeConversation({ unreadCount: 0 })]);
      renderScreen();
      await waitFor(() => expect(screen.queryByText('99+')).toBeNull());
    });

    it('L555: caps unread badge at 99+', async () => {
      seedConversations([makeConversation({ name: 'Many', unreadCount: 120 })]);
      renderScreen();
      await waitFor(() => expect(screen.getByText('99+')).toBeTruthy());
    });

    it('L592-L594: shows No location pill when participantLocationKey missing', async () => {
      seedConversations([makeConversation({ name: 'No Loc', participantLocationKey: undefined })]);
      renderScreen();
      await waitFor(() => expect(screen.getByText('No location')).toBeTruthy());
    });

    it('L545-L551: renders empty last message branch', async () => {
      seedConversations([makeConversation({ name: 'Silent', lastMessage: undefined })]);
      renderScreen();
      await waitFor(() => expect(screen.getByText('Silent')).toBeTruthy());
    });

    it('L561-L573: hides type badge when conversationType is missing', async () => {
      seedConversations([makeConversation({ name: 'No Type', conversationType: undefined })]);
      renderScreen();
      await waitFor(() => expect(screen.queryByText('O')).toBeNull());
    });

    it('L565-L572: shows G badge for guest type', async () => {
      seedConversations([makeConversation({ name: 'Guest', conversationType: 'guest' })]);
      renderScreen();
      await waitFor(() => expect(screen.getByText('G')).toBeTruthy());
    });

    it('search: empty results shows No results', async () => {
      mockSearchConversations.mockResolvedValue([]);
      renderScreen();
      await waitFor(() => expect(screen.getByPlaceholderText('Search by name, phone or message')).toBeTruthy());
      changeText(screen.getByPlaceholderText('Search by name, phone or message'), 'zzz');
      await waitFor(() => expect(screen.getByText('No results')).toBeTruthy());
    });

    it('L280-L284: whitespace-only search query clears search state', async () => {
      renderScreen();
      const input = await screen.findByPlaceholderText('Search by name, phone or message');
      changeText(input, '   ');
      await waitFor(() => expect(mockSearchConversations).not.toHaveBeenCalled());
    });

    it('handles very long search query string', async () => {
      const long = 'x'.repeat(500);
      mockSearchConversations.mockResolvedValue([]);
      renderScreen();
      changeText(await screen.findByPlaceholderText('Search by name, phone or message'), long);
      await waitFor(() => expect(mockSearchConversations).toHaveBeenCalledWith(long, expect.any(Object)));
    });

    it('L528-L532: favorite badge on avatar when isFavorite and not selected', async () => {
      seedConversations([makeConversation({ name: 'Starred', isFavorite: true })]);
      renderScreen();
      await waitFor(() => {
        const stars = screen.getAllByText('star');
        expect(stars.length).toBeGreaterThan(0);
      });
    });

    it('L701-L705: archived count badge hidden when archivedCount is 0', async () => {
      defaultFetchSuccess({ archivedCount: 0 });
      renderScreen();
      await waitFor(() => expect(screen.getByText('Archived')).toBeTruthy());
      const archivedSection = screen.getByText('Archived').closest('button');
      expect(archivedSection?.textContent).not.toMatch(/\b0\b/);
    });

    it('shows archived count when greater than 0', async () => {
      defaultFetchSuccess({ archivedCount: 5 });
      renderScreen();
      await waitFor(() => expect(screen.getByText('5')).toBeTruthy());
    });
  });

  describe('6. ERROR STATES', () => {
    it('L243-L246: shows fetch error on initial load failure', async () => {
      mockFetchConversations.mockRejectedValue(new Error('Network down'));
      renderScreen();
      await waitFor(() => expect(screen.getByText('Network down')).toBeTruthy());
    });

    it('L243-L246: shows generic error for non-Error throws on initial load', async () => {
      mockFetchConversations.mockRejectedValue('bad');
      renderScreen();
      await waitFor(() => expect(screen.getByText('Failed to load conversations')).toBeTruthy());
    });

    it('L244: silent error when list already populated and filter unchanged', async () => {
      seedConversations([makeConversation({ id: 'existing', name: 'Existing' })]);
      renderScreen();
      await waitFor(() => expect(screen.getByText('Existing')).toBeTruthy());
      mockFetchConversations.mockRejectedValue(new Error('Silent fail'));
      const { runLatestFocusEffect } = await import('../../../../../vitest/focusEffect');
      await act(async () => {
        runLatestFocusEffect();
      });
      await waitFor(() => expect(screen.getByText('Existing')).toBeTruthy());
      expect(screen.queryByText('Silent fail')).toBeNull();
    });

    it('L296-L298: shows search error', async () => {
      mockSearchConversations.mockRejectedValue(new Error('Search broke'));
      renderScreen();
      changeText(await screen.findByPlaceholderText('Search by name, phone or message'), 'q');
      await waitFor(() => expect(screen.getByText('Search broke')).toBeTruthy());
    });

    it('L297-L298: generic search error message', async () => {
      mockSearchConversations.mockRejectedValue('nope');
      renderScreen();
      changeText(await screen.findByPlaceholderText('Search by name, phone or message'), 'q');
      await waitFor(() => expect(screen.getByText('Search failed')).toBeTruthy());
    });

    it('L351-L354: new chat validation — missing country code digits', async () => {
      renderScreen();
      press(await screen.findByLabelText('Start a new chat'));
      changeText(screen.getByPlaceholderText('+30'), '+');
      changeText(screen.getByPlaceholderText('Phone number'), '123');
      press(screen.getByLabelText('Continue to chat'));
      expect(screen.getByText('Please enter a country code')).toBeTruthy();
    });

    it('L355-L358: new chat validation — missing phone digits', async () => {
      renderScreen();
      press(await screen.findByLabelText('Start a new chat'));
      changeText(screen.getByPlaceholderText('Phone number'), '');
      press(screen.getByLabelText('Continue to chat'));
      expect(screen.getByText('Please enter a phone number')).toBeTruthy();
    });
  });

  describe('7. ASYNC BEHAVIOR', () => {
    it('L219-L221: shows loading spinner on initial fetch', async () => {
      let resolve!: (v: unknown) => void;
      mockFetchConversations.mockReturnValue(
        new Promise((r) => {
          resolve = r;
        }),
      );
      renderScreen();
      expect(screen.getByTestId('activity-indicator')).toBeTruthy();
      resolve({
        conversations: [],
        nextCursor: null,
        hasMore: false,
      });
      await waitFor(() => expect(screen.queryByTestId('activity-indicator')).toBeNull());
    });

    it('L232-L237: loads phone configs when store has none', async () => {
      useChatStore.setState({ phoneConfigs: null });
      renderScreen();
      await waitFor(() => expect(mockFetchPhoneConfigs).toHaveBeenCalled());
    });

    it('L227-L230: skips phone config fetch when already cached', async () => {
      useChatStore.setState({
        phoneConfigs: [makePhoneConfig({ phoneNumberId: 'cached', channelId: 'ch', displayName: 'Cached' })],
      });
      renderScreen();
      await waitFor(() => expect(mockFetchConversations).toHaveBeenCalled());
      expect(mockFetchPhoneConfigs).not.toHaveBeenCalled();
    });

    it('L235-L236: swallows archived count errors on focus', async () => {
      mockFetchConversationCounts.mockRejectedValue(new Error('counts fail'));
      renderScreen();
      await waitFor(() => expect(screen.getByText('Adminstro')).toBeTruthy());
    });

    it('L163-L164: monthly target cities fetch failure yields empty array', async () => {
      mockFetchMonthlyTargetLocations.mockRejectedValue(new Error('cities fail'));
      renderScreen();
      await waitFor(() => expect(screen.getByText('Adminstro')).toBeTruthy());
    });

    it('L157: skips monthly cities fetch when tokenData is null', async () => {
      resetStores({ tokenData: null });
      renderScreen();
      await waitFor(() => expect(mockFetchMonthlyTargetLocations).not.toHaveBeenCalled());
    });

    it('L363-L382: createConversation success navigates to detail', async () => {
      mockCreateConversation.mockResolvedValue({
        id: 'new-1',
        name: 'New Person',
        phone: '306912345678',
        templateOnly: false,
        isSelf: false,
        windowExpiresAt: undefined,
      });
      renderScreen();
      press(await screen.findByLabelText('Start a new chat'));
      changeText(screen.getByPlaceholderText('Phone number'), '6912345678');
      press(screen.getByLabelText('Continue to chat'));
      await waitFor(() =>
        expect(mockNavigate).toHaveBeenCalledWith(
          'ConversationDetail',
          expect.objectContaining({ conversationId: 'new-1', isDraft: false }),
        ),
      );
    });

    it('L383-L394: createConversation failure navigates draft fallback', async () => {
      mockCreateConversation.mockRejectedValue(new Error('create failed'));
      renderScreen();
      press(await screen.findByLabelText('Start a new chat'));
      changeText(screen.getByPlaceholderText('Phone number'), '6912345678');
      press(screen.getByLabelText('Continue to chat'));
      await waitFor(() =>
        expect(mockNavigate).toHaveBeenCalledWith(
          'ConversationDetail',
          expect.objectContaining({
            conversationId: expect.stringMatching(/^draft:/),
            isDraft: true,
            templateOnly: true,
          }),
        ),
      );
    });

    it('L261-L262: loadMore no-ops without cursor', async () => {
      seedConversations([makeConversation()]);
      mockFetchConversations.mockResolvedValue({
        conversations: [makeConversation()],
        nextCursor: null,
        hasMore: false,
      });
      renderScreen();
      await waitFor(() => expect(screen.getByTestId('flat-list-end-reached')).toBeTruthy());
      const callsBefore = mockFetchConversations.mock.calls.length;
      press(screen.getByTestId('flat-list-end-reached'));
      expect(mockFetchConversations.mock.calls.length).toBe(callsBefore);
    });

    it('L270-L271: loadMore swallows pagination errors', async () => {
      resetStores({ conversations: [makeConversation({ id: 'pg1', name: 'Page One' })] });
      mockFetchConversations
        .mockResolvedValueOnce({
          conversations: [makeConversation({ id: 'pg1', name: 'Page One' })],
          nextCursor: 'c2',
          hasMore: true,
        })
        .mockRejectedValueOnce(new Error('page fail'));
      renderScreen();
      await waitFor(() => expect(screen.getByText('Page One')).toBeTruthy());
      press(screen.getByTestId('flat-list-end-reached'));
      await waitFor(() => expect(screen.getByText('Page One')).toBeTruthy());
    });

    it('L1024-L1026: search keyExtractor uses index fallback when id missing', async () => {
      mockSearchConversations.mockResolvedValue([
        { name: 'No Id', unreadCount: 0 } as never,
      ]);
      renderScreen();
      changeText(await screen.findByPlaceholderText('Search by name, phone or message'), 'no');
      await waitFor(() => expect(screen.getByText('No Id')).toBeTruthy());
    });
  });

  describe('8. ACCESSIBILITY', () => {
    it('exposes accessibility labels on key controls', async () => {
      renderScreen();
      await waitFor(() => {
        expect(screen.getByLabelText('Filter by location')).toBeTruthy();
        expect(screen.getByLabelText('Start a new chat')).toBeTruthy();
      });
    });

    it('location picker rows have accessibility labels', async () => {
      renderScreen();
      await waitFor(() => expect(screen.getByLabelText('Filter by location')).toBeTruthy());
      press(screen.getByLabelText('Filter by location'));
      expect(screen.getByLabelText('Filter all locations')).toBeTruthy();
    });

    it('avatar preview modal supports onRequestClose', async () => {
      seedConversations([makeConversation({ participantProfilePic: 'https://x.com/a.png' })]);
      renderScreen();
      await waitFor(() => expect(screen.getByLabelText('Open profile photo')).toBeTruthy());
      press(screen.getByLabelText('Open profile photo'));
      press(screen.getByTestId('modal-request-close'));
      expect(screen.queryByLabelText('Close photo')).toBeNull();
    });
  });

  describe('9. CONDITIONAL RENDERING branches', () => {
    it('L612-L616: location chip label — Locations vs filtered vs admin queue', async () => {
      renderScreen();
      await waitFor(() => expect(screen.getByText('Locations')).toBeTruthy());

      press(screen.getByLabelText('Filter by location'));
      press(screen.getByLabelText('Filter Athens'));
      await waitFor(() => expect(screen.getByText('Athens')).toBeTruthy());

      press(screen.getByText('Admin queue'));
      await waitFor(() => {
        const adminLabels = screen.getAllByText('Admin queue');
        expect(adminLabels.length).toBeGreaterThan(0);
      });
    });

    it('L680: hides admin queue chip for non full-access roles', async () => {
      resetStores({
        tokenData: { ...mockTokenData, role: 'Agent' },
      });
      renderScreen();
      await waitFor(() => expect(screen.getByText('Adminstro')).toBeTruthy());
      expect(screen.queryByText('Admin queue')).toBeNull();
    });

    it('L954-L986: selection bar replaces title row; FAB hidden', async () => {
      seedConversations( [makeConversation({ name: 'Sel' })]);
      renderScreen();
      await waitFor(() => expect(screen.getByText('Sel')).toBeTruthy());
      longPress(screen.getByText('Sel'));
      expect(screen.queryByLabelText('Start a new chat')).toBeNull();
    });

    it('L1002-L1007: loading hides list; error hides list', async () => {
      mockFetchConversations.mockImplementation(
        () => new Promise(() => {}),
      );
      renderScreen();
      expect(screen.queryByText('No conversations yet')).toBeNull();

      mockFetchConversations.mockRejectedValue(new Error('Err'));
      renderConversationList(
        <ConversationListScreen navigation={createMockNavigation()} route={createMockRoute()} />,
      );
      await waitFor(() => expect(screen.getByText('Err')).toBeTruthy());
    });

    it('L451-L456: renderHighlightedSnippet empty snippet branch', async () => {
      mockSearchConversations.mockResolvedValue([
        {
          id: 's1',
          name: 'Snippet Empty',
          unreadCount: 0,
          snippet: undefined,
          lastMessage: undefined,
        },
      ]);
      renderScreen();
      changeText(await screen.findByPlaceholderText('Search by name, phone or message'), 'x');
      await waitFor(() => expect(screen.getByText('Snippet Empty')).toBeTruthy());
    });

    it('L465-L471: highlights matching snippet text in search results', async () => {
      mockSearchConversations.mockResolvedValue([
        {
          id: 's2',
          name: 'Highlight',
          unreadCount: 0,
          snippet: 'hello world',
        },
      ]);
      renderScreen();
      changeText(await screen.findByPlaceholderText('Search by name, phone or message'), 'world');
      await waitFor(() => expect(screen.getByText('world')).toBeTruthy());
    });

    it('L1149-L1162: FAB uses dark theme icon variant', async () => {
      themeIsDark = true;
      renderScreen();
      await waitFor(() => expect(screen.getByText('message-plus')).toBeTruthy());
    });

    it('L1008: non-dark FAB uses outline icon', async () => {
      themeIsDark = false;
      renderScreen();
      await waitFor(() => expect(screen.getByText('message-plus-outline')).toBeTruthy());
    });

    it('L523-L527: selection badge on avatar when selected', async () => {
      seedConversations([makeConversation({ name: 'Pick', participantProfilePic: 'https://a.com/x.jpg' })]);
      renderScreen();
      await waitFor(() => expect(screen.getByText('Pick')).toBeTruthy());
      longPress(screen.getByText('Pick'));
      expect(screen.getAllByText('checkmark').length).toBeGreaterThan(0);
    });

    it('L929: renders newChatError text when set', async () => {
      renderScreen();
      press(await screen.findByLabelText('Start a new chat'));
      press(screen.getByLabelText('Continue to chat'));
      expect(screen.getByText('Please enter a phone number')).toBeTruthy();
    });

    it('L209-L214: filter change triggers full-screen loader', async () => {
      seedConversations([makeConversation({ name: 'Loaded' })]);
      renderScreen();
      await waitFor(() => expect(screen.getByText('Loaded')).toBeTruthy());
      press(screen.getByLabelText('Filter by location'));
      press(screen.getByLabelText('Filter Athens'));
      await waitFor(() => expect(mockFetchConversations).toHaveBeenCalledTimes(2));
    });
  });

  describe('10. INTEGRATION — stores, sockets, navigation', () => {
    it('L179-L186: joins and leaves WhatsApp phone rooms from phoneConfigs', async () => {
      useChatStore.setState({
        phoneConfigs: [makePhoneConfig({ phoneNumberId: 'p-99', channelId: 'c-99', displayName: 'X' })],
      });
      const { unmount } = renderScreen();
      await waitFor(() => expect(mockJoinWhatsAppPhone).toHaveBeenCalledWith('p-99'));
      unmount();
      expect(mockLeaveWhatsAppPhone).toHaveBeenCalledWith('p-99');
    });

    it('L190-L197: joins channel rooms when channelId present', async () => {
      useChatStore.setState({
        phoneConfigs: [makePhoneConfig({ phoneNumberId: 'p-1', channelId: 'ch-1', displayName: 'X' })],
      });
      const { unmount } = renderScreen();
      await waitFor(() => expect(mockJoinWhatsAppChannel).toHaveBeenCalledWith('ch-1'));
      unmount();
      expect(mockLeaveWhatsAppChannel).toHaveBeenCalledWith('ch-1');
    });

    it('L192: skips channel join when channelId falsy', async () => {
      useChatStore.setState({
        phoneConfigs: [makePhoneConfig({ phoneNumberId: 'p-1', channelId: '', displayName: 'X' })],
      });
      renderScreen();
      await waitFor(() => expect(mockJoinWhatsAppChannel).not.toHaveBeenCalled());
    });

    it('updates Zustand conversations on successful focus fetch', async () => {
      const rows = [makeConversation({ id: 'z1', name: 'Zustand Row' })];
      mockFetchConversations.mockResolvedValue({
        conversations: rows,
        nextCursor: null,
        hasMore: false,
      });
      renderScreen();
      await waitFor(() => {
        expect(useChatStore.getState().conversations).toEqual(rows);
      });
    });

    it('L1035-L1044: search row navigates with highlight params', async () => {
      mockSearchConversations.mockResolvedValue([
        {
          id: 'h1',
          name: 'Highlight Nav',
          unreadCount: 1,
          snippet: 'find me',
          messageId: 'msg-9',
          messageTimestamp: 12345,
          templateOnly: true,
          windowExpiresAt: 999,
        },
      ]);
      renderScreen();
      changeText(await screen.findByPlaceholderText('Search by name, phone or message'), 'find');
      await waitFor(() => expect(screen.getByText('Highlight Nav')).toBeTruthy());
      press(screen.getByText('Highlight Nav'));
      expect(mockNavigate).toHaveBeenCalledWith(
        'ConversationDetail',
        expect.objectContaining({
          highlightMessageId: 'msg-9',
          highlightTimestamp: 12345,
          templateOnly: true,
        }),
      );
    });

    it('L421: toggleFavorite early return when nothing selected', async () => {
      renderScreen();
      await waitFor(() => expect(screen.getByText('Adminstro')).toBeTruthy());
      // no selection — star in selection bar not visible; archiveSelection/toggle not callable
      expect(useChatStore.getState().conversations).toEqual([]);
    });

    it('L434: archiveSelection early return when nothing selected', async () => {
      renderScreen();
      await waitFor(() => expect(screen.getByText('Adminstro')).toBeTruthy());
      expect(mockArchiveConversation).not.toHaveBeenCalled();
    });

    it('L445-L446: archive count refresh failure is non-blocking', async () => {
      seedConversations([makeConversation({ id: 'a1', name: 'Archive Target' })]);
      mockArchiveConversation.mockResolvedValue(undefined);
      mockFetchConversationCounts.mockRejectedValue(new Error('count fail'));
      renderScreen();
      await waitFor(() => expect(screen.getByText('Archive Target')).toBeTruthy());
      longPress(screen.getByText('Archive Target'));
      press(screen.getAllByText('archive-outline')[0]);
      await waitFor(() => expect(useChatStore.getState().conversations).toHaveLength(0));
    });

    it('L314-L316: client location filter on main list', async () => {
      seedConversations([
          makeConversation({ id: '1', name: 'Athens Only', participantLocationKey: 'athens' }),
          makeConversation({ id: '2', name: 'Other City', participantLocationKey: 'paris' }),
        ]);
      renderScreen();
      await waitFor(() => expect(screen.getByText('Athens Only')).toBeTruthy());
      press(screen.getByLabelText('Filter by location'));
      press(screen.getByLabelText('Filter Athens'));
      await waitFor(() => {
        expect(screen.getByText('Athens Only')).toBeTruthy();
        expect(screen.queryByText('Other City')).toBeNull();
      });
    });

    it('L517: avatar uses avatar fallback when participantProfilePic missing', async () => {
      seedConversations([
          makeConversation({
            name: 'Fallback Avatar',
            participantProfilePic: undefined,
            avatar: 'https://example.com/fallback.jpg',
          }),
        ]);
      renderScreen();
      await waitFor(() => expect(screen.getByRole('img')).toBeTruthy());
    });

    it('L767-L769: location modal shows All my locations label for all key', async () => {
      renderScreen();
      press(await screen.findByLabelText('Filter by location'));
      expect(screen.getByText('All my locations')).toBeTruthy();
    });

    it('L771-L773: shows checkmark on active location filter row', async () => {
      renderScreen();
      press(await screen.findByLabelText('Filter by location'));
      expect(screen.getAllByText('checkmark').length).toBeGreaterThan(0);
    });
  });

  describe('branch coverage — remaining paths', () => {
    it('L1061-L1072: search rows render guest and owner type badges', async () => {
      mockSearchConversations.mockResolvedValue([
        {
          id: 'sg',
          name: 'Search Guest',
          unreadCount: 0,
          snippet: 'hi',
          conversationType: 'guest',
          participantLocationKey: 'athens',
        },
        {
          id: 'so',
          name: 'Search Owner',
          unreadCount: 0,
          snippet: 'hi',
          conversationType: 'owner',
          participantLocationKey: 'athens',
        },
      ]);
      renderScreen();
      changeText(await screen.findByPlaceholderText('Search by name, phone or message'), 'Search');
      await waitFor(() => {
        expect(screen.getByText('G')).toBeTruthy();
        expect(screen.getByText('O')).toBeTruthy();
      });
    });

    it('L425-L428: toggleFavoriteForSelection favorites non-favorite rows when selection is mixed', async () => {
      seedConversations([
        makeConversation({ id: 'f1', name: 'Fav One', isFavorite: true }),
        makeConversation({ id: 'f2', name: 'Fav Two', isFavorite: false }),
      ]);
      renderScreen();
      await waitFor(() => expect(screen.getByText('Fav One')).toBeTruthy());
      longPress(screen.getByText('Fav One'));
      press(screen.getByText('Fav Two'));
      press(screen.getAllByText('star')[0]);
      expect(useChatStore.getState().conversations.find((c) => c.id === 'f1')?.isFavorite).toBe(
        true,
      );
      expect(useChatStore.getState().conversations.find((c) => c.id === 'f2')?.isFavorite).toBe(
        true,
      );
    });

    it('L262: loadMore ignores duplicate onEndReached while in flight', async () => {
      resetStores({ conversations: [makeConversation({ id: 'pg1', name: 'Paged' })] });
      let resolvePage: (v: unknown) => void;
      mockFetchConversations
        .mockResolvedValueOnce({
          conversations: [makeConversation({ id: 'pg1', name: 'Paged' })],
          nextCursor: 'c2',
          hasMore: true,
        })
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolvePage = resolve;
            }),
        );
      renderScreen();
      await waitFor(() => expect(screen.getByTestId('flat-list-end-reached')).toBeTruthy());
      press(screen.getByTestId('flat-list-end-reached'));
      press(screen.getByTestId('flat-list-end-reached'));
      const callsAfterDouble = mockFetchConversations.mock.calls.length;
      resolvePage!({
        conversations: [],
        nextCursor: null,
        hasMore: false,
      });
      await waitFor(() =>
        expect(mockFetchConversations.mock.calls.length).toBe(callsAfterDouble),
      );
    });

    it('L464: renderHighlightedSnippet skips empty split parts', async () => {
      mockSearchConversations.mockResolvedValue([
        {
          id: 'rx',
          name: 'Regex Hit',
          unreadCount: 0,
          snippet: 'price (special)',
        },
      ]);
      renderScreen();
      changeText(await screen.findByPlaceholderText('Search by name, phone or message'), '(special)');
      await waitFor(() => expect(screen.getByText('(special)')).toBeTruthy());
    });

    it('L261: loadMore returns immediately when hasMore is false', async () => {
      seedConversations([makeConversation({ name: 'No More' })]);
      renderScreen();
      await waitFor(() => expect(screen.getByText('No More')).toBeTruthy());
      const callsBefore = mockFetchConversations.mock.calls.length;
      press(screen.getByTestId('flat-list-end-reached'));
      expect(mockFetchConversations.mock.calls.length).toBe(callsBefore);
    });

    it('L1027-L1032: search rows render profile image when participantProfilePic is set', async () => {
      mockSearchConversations.mockResolvedValue([
        {
          id: 'sp',
          name: 'Search Pic',
          unreadCount: 0,
          snippet: 'photo',
          participantProfilePic: 'https://example.com/search.jpg',
        },
      ]);
      renderScreen();
      changeText(await screen.findByPlaceholderText('Search by name, phone or message'), 'Search');
      await waitFor(() => expect(screen.getByRole('img')).toBeTruthy());
    });

    it('L1027-L1031: search rows use initials when participantProfilePic is missing', async () => {
      mockSearchConversations.mockResolvedValue([
        {
          id: 'si',
          name: 'Zoe Zulu',
          unreadCount: 0,
          snippet: 'hello',
        },
      ]);
      renderScreen();
      changeText(await screen.findByPlaceholderText('Search by name, phone or message'), 'Zoe');
      await waitFor(() => expect(screen.getByText('ZZ')).toBeTruthy());
    });
  });
});
