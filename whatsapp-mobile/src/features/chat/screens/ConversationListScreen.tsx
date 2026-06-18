import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../auth/auth.store';
import { useChatStore } from '../chat.store';
import {
  archiveConversation,
  createConversation,
  fetchConversationCounts,
  fetchConversations,
  fetchMonthlyTargetLocations,
  fetchPhoneConfigs,
  searchConversations,
} from '../services';
import {
  formatLocationLabel,
  getInboxLocationFilterChoices,
  getInboxLocationOptions,
  hasFullLocationAccess,
  normalizeLocationKey,
  resolveConversationArea,
  resolveDefaultLocationKey,
  type LocationFilterValue,
} from '../utils/locations';
import type { ChatAppStackParamList } from '../../../core/navigation/ChatAppStack';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { colors } from '../../../theme/colors';
import type { Conversation } from '../types';
import type { ConversationSearchResult } from '../services';
import { joinWhatsAppPhone, leaveWhatsAppPhone, joinWhatsAppChannel, leaveWhatsAppChannel } from '../../../services/socket';
import { GuestOutboundStatsBadges } from '../components/GuestOutboundStatsBadges';

type Props = NativeStackScreenProps<ChatAppStackParamList, 'ConversationList'>;

const HEADER_GREEN = '#075E54';
const FILTER_TABS = ['All', 'Unread', 'Favourites', 'Labels'] as const;
type FilterTab = (typeof FILTER_TABS)[number];

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase().slice(0, 2);
  }
  return (name.trim().slice(0, 2) || '?').toUpperCase();
}

function formatListDate(ts?: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const isThisYear = d.getFullYear() === now.getFullYear();
  if (isThisYear) {
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' });
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function ConversationListScreen({ route, navigation }: Props) {
  const tokenData = useAuthStore((s) => s.tokenData);
  const { conversations, setConversations, appendConversations, phoneConfigs, setPhoneConfigs, archivedCount, setArchivedCount } = useChatStore();
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ConversationSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<FilterTab>('All');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [countryCode, setCountryCode] = useState('+30');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [newContactName, setNewContactName] = useState('');
  const [newContactType, setNewContactType] = useState<'owner' | 'guest'>('owner');
  const [newContactLocation, setNewContactLocation] = useState('');
  const [newChatError, setNewChatError] = useState<string | null>(null);
  const [locationFilter, setLocationFilter] = useState<LocationFilterValue>('all');
  /**
   * When true, fetch conversations with no participantLocationKey (admin queue).
   * Only shown to full-access roles (SuperAdmin / Admin / Developer).
   */
  const [adminQueue, setAdminQueue] = useState(false);
  const [monthlyTargetCities, setMonthlyTargetCities] = useState<string[]>([]);
  const [showLocationFilterModal, setShowLocationFilterModal] = useState(false);
  const [avatarPreviewUri, setAvatarPreviewUri] = useState<string | null>(null);
  /** Tracks which inbox location filter the list was last loaded for. */
  const lastFetchedLocationFilterRef = useRef<LocationFilterValue | null>(null);
  const lastFetchedAdminQueueRef = useRef<boolean>(false);
  const onEndReachedCalled = useRef(false);

  const locationContext = useMemo(
    () => ({
      role: tokenData?.role,
      allotedArea: tokenData?.allotedArea,
      monthlyTargetCities,
    }),
    [tokenData?.role, tokenData?.allotedArea, monthlyTargetCities],
  );

  const locationOptions = useMemo(
    () => getInboxLocationOptions(locationContext),
    [locationContext],
  );

  const locationFilterChoices = useMemo(
    () => getInboxLocationFilterChoices(locationContext),
    [locationContext],
  );

  const defaultArea = useMemo(
    () =>
      resolveDefaultLocationKey(locationContext) ||
      normalizeLocationKey(route.params?.initialArea ?? 'athens'),
    [locationContext, route.params?.initialArea],
  );

  const resolveArea = useCallback(
    (conversation?: { participantLocationKey?: string }) =>
      resolveConversationArea(conversation ?? {}, defaultArea),
    [defaultArea],
  );

  useEffect(() => {
    if (!tokenData) return;
    let cancelled = false;
    (async () => {
      try {
        const cities = await fetchMonthlyTargetLocations();
        if (!cancelled) setMonthlyTargetCities(cities);
      } catch {
        if (!cancelled) setMonthlyTargetCities([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tokenData]);

  useEffect(() => {
    if (!newContactLocation && locationOptions.length > 0) {
      setNewContactLocation(normalizeLocationKey(locationOptions[0]));
    }
  }, [locationOptions, newContactLocation]);

  // Join all allowed business-line rooms (same as Adminstro web) for realtime delivery.
  useEffect(() => {
    const configs = phoneConfigs ?? [];
    const phoneIds = configs.map((c) => c.phoneNumberId).filter(Boolean);
    phoneIds.forEach((id) => joinWhatsAppPhone(id));
    return () => {
      phoneIds.forEach((id) => leaveWhatsAppPhone(id));
    };
  }, [phoneConfigs]);

  // Dual-room: also join stable WhatsappChannel rooms so real-time events survive
  // WABA/number migrations.  Mirrors the channelWatcher logic added in Adminstro web.
  useEffect(() => {
    const configs = phoneConfigs ?? [];
    const channelIds = configs.map((c) => c.channelId).filter((id): id is string => Boolean(id));
    channelIds.forEach((id) => joinWhatsAppChannel(id));
    return () => {
      channelIds.forEach((id) => leaveWhatsAppChannel(id));
    };
  }, [phoneConfigs]);

  // Refetch whenever this screen is focused. The old useEffect skipped loading when the
  // Zustand store already had rows for this area — but React Navigation often keeps this
  // screen mounted under the detail screen, so returning from a chat never re-ran the
  // effect and the list stayed stale vs the website (fresh GET each visit).
  //
  // Phone configs come from GET /api/whatsapp/phone-configs (DB channels + legacy lines).
  // phoneId is resolved from those configs — not from hardcoded .env values.
  useFocusEffect(
    useCallback(() => {
      const filterChanged =
        lastFetchedLocationFilterRef.current !== locationFilter ||
        lastFetchedAdminQueueRef.current !== adminQueue;
      lastFetchedLocationFilterRef.current = locationFilter;
      lastFetchedAdminQueueRef.current = adminQueue;
      const hadList = useChatStore.getState().conversations.length > 0;
      const showFullScreenLoader = !hadList || filterChanged;

      let cancelled = false;
      (async () => {
        try {
          if (showFullScreenLoader) {
            setLoading(true);
          }
          setError(null);
          setNextCursor(null);
          setHasMore(false);

          let configs = useChatStore.getState().phoneConfigs;
          if (!configs) {
            configs = await fetchPhoneConfigs();
            if (!cancelled) setPhoneConfigs(configs);
          }

          const [result] = await Promise.all([
            fetchConversations({ locationFilter, adminQueue }),
            fetchConversationCounts()
              .then((counts) => { if (!cancelled) setArchivedCount(counts.archivedCount ?? 0); })
              .catch(() => {}),
          ]);
          if (!cancelled) {
            setConversations(result.conversations);
            setNextCursor(result.nextCursor);
            setHasMore(result.hasMore);
          }
        } catch (e) {
          if (!cancelled && showFullScreenLoader) {
            setError(e instanceof Error ? e.message : 'Failed to load conversations');
          }
        } finally {
          if (!cancelled && showFullScreenLoader) {
            setLoading(false);
          }
        }
      })();

      return () => {
        cancelled = true;
      };
    }, [locationFilter, adminQueue, setConversations, setPhoneConfigs]),
  );

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || !nextCursor) return;
    if (onEndReachedCalled.current) return;
    onEndReachedCalled.current = true;
    try {
      setLoadingMore(true);
      const result = await fetchConversations({ locationFilter, adminQueue, cursor: nextCursor });
      appendConversations(result.conversations);
      setNextCursor(result.nextCursor);
      setHasMore(result.hasMore);
    } catch {
      // non-blocking
    } finally {
      setLoadingMore(false);
      onEndReachedCalled.current = false;
    }
  }, [locationFilter, hasMore, nextCursor, loadingMore, appendConversations]);

  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults([]);
      setSearchError(null);
      setSearchLoading(false);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        setSearchLoading(true);
        setSearchError(null);
        const results = await searchConversations(q, { locationFilter });
        if (!cancelled) {
          setSearchResults(results);
        }
      } catch (e) {
        if (!cancelled) {
          setSearchError(e instanceof Error ? e.message : 'Search failed');
        }
      } finally {
        if (!cancelled) {
          setSearchLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [locationFilter, searchQuery]);

  const filteredConversations = useMemo(() => {
    let list = conversations;
    if (locationFilter !== 'all') {
      list = list.filter((c) => (c.participantLocationKey ?? '').toLowerCase() === locationFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          (c.lastMessage?.toLowerCase().includes(q) ?? false) ||
          c.id.toLowerCase().includes(q)
      );
    }
    if (activeFilter === 'Unread') {
      list = list.filter((c) => (c.unreadCount ?? 0) > 0);
    }
    if (activeFilter === 'Favourites') {
      list = list.filter((c) => c.isFavorite);
    }
    return list;
  }, [conversations, locationFilter, searchQuery, activeFilter]);

  // archivedCount comes from the store; refreshed via /whatsapp/conversations/counts on focus

  const isSelectionMode = selectedIds.length > 0;

  const openNewChat = useCallback(() => {
    setNewChatError(null);
    setPhoneNumber('');
    setNewContactName('');
    setNewContactType('owner');
    setNewContactLocation(defaultArea);
    setShowNewChatModal(true);
  }, [defaultArea]);

  const startChatWithNumber = useCallback(async () => {
    const ccDigits = countryCode.replace(/[^\d]/g, '');
    const phoneDigits = phoneNumber.replace(/[^\d]/g, '');
    if (!ccDigits) {
      setNewChatError('Please enter a country code');
      return;
    }
    if (!phoneDigits) {
      setNewChatError('Please enter a phone number');
      return;
    }

    const to = `${ccDigits}${phoneDigits}`;
    setNewChatError(null);

    try {
      // Adminstro parity: create Owner/Guest conversation with a location.
      const created = await createConversation({
        participantPhone: to,
        participantName: newContactName.trim() || undefined,
        participantLocation: formatLocationLabel(newContactLocation, locationOptions),
        conversationType: newContactType,
        area: newContactLocation,
      });
      setShowNewChatModal(false);
      navigation.navigate('ConversationDetail', {
        conversationId: created.id,
        area: resolveArea(created),
        conversationName: created.name,
        participantPhone: created.phone,
        templateOnly: created.templateOnly,
        isDraft: false,
        isSelf: created.isSelf,
        windowExpiresAt: created.windowExpiresAt,
      });
    } catch {
      // Fallback: draft-only flow (still allows sending templates).
      setShowNewChatModal(false);
      navigation.navigate('ConversationDetail', {
        conversationId: `draft:${to}`,
        area: newContactLocation || defaultArea,
        conversationName: `+${to}`,
        participantPhone: to,
        templateOnly: true,
        isDraft: true,
      });
    }
  }, [
    countryCode,
    phoneNumber,
    navigation,
    defaultArea,
    locationOptions,
    newContactName,
    newContactType,
    newContactLocation,
    resolveArea,
  ]);

  const clearSelection = useCallback(() => {
    setSelectedIds([]);
  }, []);

  const toggleSelected = useCallback(
    (id: string) => {
      setSelectedIds((prev) =>
        prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
      );
    },
    []
  );

  const toggleFavoriteForSelection = useCallback(() => {
    if (selectedIds.length === 0) return;
    const setIds = new Set(selectedIds);
    const allFav = conversations
      .filter((c) => setIds.has(c.id))
      .every((c) => c.isFavorite);
    const next = conversations.map((c) =>
      setIds.has(c.id) ? { ...c, isFavorite: !allFav } : c
    );
    setConversations(next);
    clearSelection();
  }, [selectedIds, conversations, setConversations, clearSelection]);

  const archiveSelection = useCallback(async () => {
    if (selectedIds.length === 0) return;
    const ids = [...selectedIds];
    clearSelection();
    // Archive each selected conversation via the real API
    await Promise.allSettled(ids.map((id) => archiveConversation(id)));
    // Remove archived conversations from the local list
    setConversations(useChatStore.getState().conversations.filter((c) => !ids.includes(c.id)));
    // Refresh archived count
    try {
      const counts = await fetchConversationCounts();
      setArchivedCount(counts.archivedCount ?? 0);
    } catch {
      // non-blocking
    }
  }, [selectedIds, clearSelection, setConversations, setArchivedCount]);

  const renderHighlightedSnippet = (snippet: string | undefined, query: string) => {
    if (!snippet) {
      return (
        <Text style={styles.lastMessage} numberOfLines={2}>
          {' '}
        </Text>
      );
    }
    const safeQuery = escapeRegExp(query);
    const regex = new RegExp(`(${safeQuery})`, 'ig');
    const parts = snippet.split(regex);
    return (
      <Text style={styles.lastMessage} numberOfLines={2}>
        {parts.map((part, index) => {
          if (!part) return null;
          if (part.toLowerCase() === query.toLowerCase()) {
            return (
              <Text key={index} style={styles.highlightText}>
                {part}
              </Text>
            );
          }
          return <Text key={index}>{part}</Text>;
        })}
      </Text>
    );
  };

  const renderRow = useCallback(
    ({ item }: { item: Conversation }) => (
      <TouchableOpacity
        style={[
          styles.row,
          selectedIds.includes(item.id) && styles.rowSelected,
        ]}
        onPress={() => {
          if (isSelectionMode) {
            toggleSelected(item.id);
          } else {
            navigation.navigate('ConversationDetail', {
              conversationId: item.id,
              area: resolveArea(item),
              conversationName: item.name,
              participantPhone: item.phone,
              isSelf: item.isSelf,
              templateOnly: item.templateOnly,
              windowExpiresAt: item.windowExpiresAt,
            });
          }
        }}
        onLongPress={() => {
          toggleSelected(item.id);
        }}
        activeOpacity={0.7}
      >
        <Pressable
          onPress={() => {
            const uri = item.participantProfilePic ?? item.avatar;
            if (uri) setAvatarPreviewUri(uri);
          }}
          disabled={!(item.participantProfilePic || item.avatar)}
          style={styles.avatar}
          accessibilityRole={item.participantProfilePic || item.avatar ? 'button' : 'text'}
          accessibilityLabel="Open profile photo"
          hitSlop={6}
        >
          {item.participantProfilePic || item.avatar ? (
            <Image source={{ uri: (item.participantProfilePic ?? item.avatar)! }} style={styles.avatarImage} />
          ) : (
            <Text style={styles.avatarText} numberOfLines={1}>
              {getInitials(item.name)}
            </Text>
          )}
          {selectedIds.includes(item.id) && (
            <View style={styles.avatarSelectionBadge}>
              <Ionicons name="checkmark" size={16} color="#fff" />
            </View>
          )}
          {item.isFavorite && !selectedIds.includes(item.id) && (
            <View style={styles.avatarFavoriteBadge}>
              <Ionicons name="star" size={14} color="#fff" />
            </View>
          )}
        </Pressable>
        <View style={styles.rowCenter}>
          <View style={styles.rowTop}>
            <View style={styles.rowTopLeft}>
              <Text style={styles.name} numberOfLines={1}>
                {item.name}
              </Text>
              <GuestOutboundStatsBadges conversation={item} variant="inline" />
            </View>
            <Text style={styles.date}>{formatListDate(item.lastMessageAt)}</Text>
          </View>
          <View style={styles.rowBottom}>
            {item.lastMessage ? (
              <Text style={styles.lastMessage} numberOfLines={1}>
                {item.lastMessage}
              </Text>
            ) : (
              <Text style={styles.lastMessage} numberOfLines={1} />
            )}
            {(item.unreadCount ?? 0) > 0 && (
              <View style={styles.unreadBadge}>
                <Text style={styles.unreadText}>
                  {item.unreadCount > 99 ? '99+' : item.unreadCount}
                </Text>
              </View>
            )}
          </View>
          <View style={styles.metaRow}>
            {!!item.conversationType && (
              <View
                style={[
                  styles.typeBadgeInline,
                  item.conversationType === 'guest'
                    ? styles.typeBadgeInlineGuest
                    : styles.typeBadgeInlineOwner,
                ]}
              >
                <Text style={styles.typeBadgeInlineText}>
                  {item.conversationType === 'guest' ? 'G' : 'O'}
                </Text>
              </View>
            )}
            <View
              style={[
                styles.pill,
                item.participantLocationKey ? styles.pillLocation : styles.pillNoLocation,
              ]}
            >
              <Ionicons
                name="location-outline"
                size={12}
                color={item.participantLocationKey ? colors.textSecondary : '#B45309'}
              />
              <Text
                style={[
                  styles.pillText,
                  item.participantLocationKey ? styles.pillTextMuted : styles.pillTextWarn,
                ]}
              >
                {item.participantLocationKey
                  ? formatLocationLabel(item.participantLocationKey, locationOptions)
                  : 'No location'}
              </Text>
            </View>
          </View>
        </View>
      </TouchableOpacity>
    ),
    [navigation, resolveArea, locationOptions, isSelectionMode, selectedIds, toggleSelected],
  );

  const renderFooter = () =>
    loadingMore ? (
      <View style={styles.footerLoader}>
        <ActivityIndicator size="small" color={colors.primary} />
      </View>
    ) : null;

  const listHeader = (
    <>
      <View style={styles.titleRow}>
        <Text style={styles.title}>WhatsApp</Text>
        <View style={styles.titleIcons}>
          <TouchableOpacity style={styles.iconBtn} hitSlop={8} onPress={openNewChat}>
            <Ionicons name="person-add-outline" size={22} color={colors.primary} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconBtn} hitSlop={8}>
            <Ionicons name="create-outline" size={22} color={colors.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconBtn} hitSlop={8}>
            <Ionicons name="ellipsis-vertical" size={20} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.searchWrap}>
        <Ionicons name="search" size={20} color={colors.textMuted} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search by name, phone or message"
          placeholderTextColor={colors.textMuted}
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      </View>

      <View style={styles.tabsRow}>
        <View style={styles.tabsLeft}>
          {FILTER_TABS.map((tab) => (
            <TouchableOpacity
              key={tab}
              style={[styles.tab, activeFilter === tab && styles.tabActive]}
              onPress={() => setActiveFilter(tab)}
            >
              <Text style={[styles.tabText, activeFilter === tab && styles.tabTextActive]}>
                {tab}
              </Text>
              {tab === 'Labels' && (
                <Ionicons
                  name="chevron-down"
                  size={14}
                  color={colors.textMuted}
                  style={styles.tabChevron}
                />
              )}
            </TouchableOpacity>
          ))}
        </View>

        <Pressable
          onPress={() => setShowLocationFilterModal(true)}
          accessibilityRole="button"
          accessibilityLabel="Filter by location"
          style={({ pressed }) => [styles.locationFilterBtn, pressed && styles.locationFilterBtnPressed]}
          hitSlop={8}
        >
          <Ionicons name="location-outline" size={16} color={colors.primary} />
          <Text style={styles.locationFilterText}>
            {adminQueue
              ? 'Admin queue'
              : locationFilter === 'all'
                ? 'All my locations'
                : formatLocationLabel(locationFilter, locationOptions)}
          </Text>
          <Ionicons name="chevron-down" size={14} color={colors.textMuted} />
        </Pressable>
      </View>

      {/* Admin queue toggle — only shown to full-access roles */}
      {hasFullLocationAccess(tokenData?.role) && (
        <TouchableOpacity
          style={[styles.adminQueueRow, adminQueue && styles.adminQueueRowActive]}
          activeOpacity={0.7}
          onPress={() => {
            setAdminQueue((prev) => !prev);
            setLocationFilter('all');
          }}
        >
          <Ionicons
            name={adminQueue ? 'albums' : 'albums-outline'}
            size={18}
            color={adminQueue ? '#fff' : colors.textMuted}
          />
          <Text style={[styles.adminQueueText, adminQueue && styles.adminQueueTextActive]}>
            Admin queue
          </Text>
          {adminQueue && (
            <View style={styles.adminQueueBadge}>
              <Text style={styles.adminQueueBadgeText}>ON</Text>
            </View>
          )}
        </TouchableOpacity>
      )}

      <TouchableOpacity
        style={styles.archivedRow}
        activeOpacity={0.7}
        onPress={() => navigation.navigate('ArchiveList', { defaultArea })}
      >
        <Ionicons name="archive-outline" size={22} color={colors.textMuted} />
        <Text style={styles.archivedText}>Archived</Text>
        {archivedCount > 0 && (
          <View style={styles.archivedCount}>
            <Text style={styles.archivedCountText}>{archivedCount}</Text>
          </View>
        )}
      </TouchableOpacity>
    </>
  );

  return (
    <View style={styles.container}>
      <Modal
        visible={Boolean(avatarPreviewUri)}
        transparent
        animationType="fade"
        onRequestClose={() => setAvatarPreviewUri(null)}
      >
        <TouchableWithoutFeedback onPress={() => setAvatarPreviewUri(null)}>
          <View style={styles.avatarPreviewOverlay}>
            <TouchableWithoutFeedback>
              <View style={styles.avatarPreviewCard}>
                <Pressable
                  onPress={() => setAvatarPreviewUri(null)}
                  style={styles.avatarPreviewClose}
                  accessibilityRole="button"
                  accessibilityLabel="Close photo"
                  hitSlop={10}
                >
                  <Ionicons name="close" size={22} color="#fff" />
                </Pressable>
                {!!avatarPreviewUri && (
                  <Image source={{ uri: avatarPreviewUri }} style={styles.avatarPreviewImage} />
                )}
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      <Modal
        visible={showLocationFilterModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowLocationFilterModal(false)}
      >
        <TouchableWithoutFeedback onPress={() => setShowLocationFilterModal(false)}>
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback>
              <View style={styles.pickerCard}>
                <Text style={styles.pickerTitle}>Location</Text>
                {locationFilterChoices.map((key) => (
                  <Pressable
                    key={key}
                    onPress={() => {
                      setLocationFilter(key);
                      setShowLocationFilterModal(false);
                    }}
                    style={({ pressed }) => [
                      styles.pickerRow,
                      key === locationFilter && styles.pickerRowActive,
                      pressed && styles.pickerRowPressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`Filter ${key === 'all' ? 'all locations' : formatLocationLabel(key, locationOptions)}`}
                  >
                    <Text style={styles.pickerRowText}>
                      {key === 'all'
                        ? 'All my locations'
                        : formatLocationLabel(key, locationOptions)}
                    </Text>
                    {key === locationFilter && (
                      <Ionicons name="checkmark" size={18} color={colors.primary} />
                    )}
                  </Pressable>
                ))}
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      <Modal
        visible={showNewChatModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowNewChatModal(false)}
      >
        <TouchableWithoutFeedback onPress={() => setShowNewChatModal(false)}>
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback>
              <View style={styles.modalCard}>
                <Text style={styles.modalTitle}>Start a new chat</Text>
                <Text style={styles.modalSubtitle}>Choose Owner/Guest, location, and phone number</Text>

                <View style={styles.typeRow}>
                  <Pressable
                    onPress={() => setNewContactType('owner')}
                    style={({ pressed }) => [
                      styles.typePill,
                      newContactType === 'owner' && styles.typePillActive,
                      pressed && styles.typePillPressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="Add owner"
                  >
                    <Text
                      style={[
                        styles.typePillText,
                        newContactType === 'owner' && styles.typePillTextActive,
                      ]}
                    >
                      Owner
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setNewContactType('guest')}
                    style={({ pressed }) => [
                      styles.typePill,
                      newContactType === 'guest' && styles.typePillActive,
                      pressed && styles.typePillPressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="Add guest"
                  >
                    <Text
                      style={[
                        styles.typePillText,
                        newContactType === 'guest' && styles.typePillTextActive,
                      ]}
                    >
                      Guest
                    </Text>
                  </Pressable>
                </View>

                <View style={styles.modalFieldFull}>
                  <Text style={styles.modalLabel}>Name (optional)</Text>
                  <TextInput
                    style={styles.modalInput}
                    value={newContactName}
                    onChangeText={setNewContactName}
                    placeholder={newContactType === 'guest' ? 'Guest name' : 'Owner name'}
                    placeholderTextColor={colors.textMuted}
                    autoCorrect={false}
                    autoCapitalize="words"
                  />
                </View>

                <View style={styles.locationRow}>
                  <Text style={styles.modalLabel}>Location</Text>
                  <View style={styles.locationChips}>
                    {locationOptions.map((loc) => {
                      const locKey = normalizeLocationKey(loc);
                      return (
                        <Pressable
                          key={locKey}
                          onPress={() => setNewContactLocation(locKey)}
                          style={({ pressed }) => [
                            styles.locationChip,
                            newContactLocation === locKey && styles.locationChipActive,
                            pressed && styles.locationChipPressed,
                          ]}
                          accessibilityRole="button"
                          accessibilityLabel={`Set location ${loc}`}
                        >
                          <Ionicons name="location-outline" size={14} color={colors.textSecondary} />
                          <Text
                            style={[
                              styles.locationChipText,
                              newContactLocation === locKey && styles.locationChipTextActive,
                            ]}
                          >
                            {loc}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>

                <View style={styles.modalRow}>
                  <View style={styles.modalFieldSmall}>
                    <Text style={styles.modalLabel}>Country</Text>
                    <TextInput
                      style={styles.modalInput}
                      value={countryCode}
                      onChangeText={(v) => setCountryCode(v.startsWith('+') ? v : `+${v}`)}
                      placeholder="+1"
                      placeholderTextColor={colors.textMuted}
                      keyboardType="phone-pad"
                      autoCorrect={false}
                      autoCapitalize="none"
                    />
                  </View>
                  <View style={styles.modalField}>
                    <Text style={styles.modalLabel}>Phone</Text>
                    <TextInput
                      style={styles.modalInput}
                      value={phoneNumber}
                      onChangeText={setPhoneNumber}
                      placeholder="Phone number"
                      placeholderTextColor={colors.textMuted}
                      keyboardType="phone-pad"
                      autoCorrect={false}
                      autoCapitalize="none"
                    />
                  </View>
                </View>

                {newChatError && <Text style={styles.modalError}>{newChatError}</Text>}

                <View style={styles.modalActions}>
                  <TouchableOpacity
                    style={[styles.modalBtn, styles.modalBtnSecondary]}
                    onPress={() => setShowNewChatModal(false)}
                  >
                    <Text style={styles.modalBtnSecondaryText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.modalBtn, styles.modalBtnPrimary]} onPress={startChatWithNumber}>
                    <Text style={styles.modalBtnPrimaryText}>Continue</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      <SafeAreaView edges={['top']} style={styles.selectionSafeArea}>
        {isSelectionMode && (
          <View style={styles.selectionBar}>
            <TouchableOpacity
              style={styles.selectionBackBtn}
              hitSlop={8}
              onPress={clearSelection}
            >
              <Ionicons name="close" size={22} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.selectionTitle}>{selectedIds.length}</Text>
            <View style={styles.selectionActions}>
              <TouchableOpacity
                style={styles.selectionIconBtn}
                hitSlop={8}
                onPress={toggleFavoriteForSelection}
              >
                <Ionicons name="star" size={22} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.selectionIconBtn}
                hitSlop={8}
                onPress={archiveSelection}
              >
                <Ionicons name="archive-outline" size={22} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.selectionIconBtn} hitSlop={8}>
                <Ionicons name="ellipsis-vertical" size={20} color="#fff" />
              </TouchableOpacity>
            </View>
          </View>
        )}
      </SafeAreaView>

      <View style={styles.content}>
        {loading && (
          <View style={styles.center}>
            <ActivityIndicator size="small" color={colors.primary} />
          </View>
        )}
        {error && !loading && <Text style={styles.error}>{error}</Text>}
        {!loading && !error && (
          <>
            {listHeader}
            {searchQuery.trim() ? (
              <>
                {searchLoading && (
                  <View style={styles.center}>
                    <ActivityIndicator size="small" color={colors.primary} />
                  </View>
                )}
                {searchError && !searchLoading && (
                  <Text style={styles.error}>{searchError}</Text>
                )}
                {!searchLoading && !searchError && (
                  <>
                    {searchResults.length === 0 ? (
                      <Text style={styles.empty}>No results</Text>
                    ) : (
                      <FlatList
                        data={searchResults}
                        keyExtractor={(item, index) =>
                          item.id ? `${item.id}` : `search-${index}`
                        }
                        renderItem={({ item }) => (
                          <TouchableOpacity
                            style={styles.row}
                            activeOpacity={0.7}
                            onPress={() => {
                              navigation.navigate('ConversationDetail', {
                                conversationId: item.id,
                                area: resolveArea(item),
                                conversationName: item.name,
                                participantPhone: item.phone,
                                highlightMessageId: item.messageId,
                                highlightTimestamp: item.messageTimestamp,
                                templateOnly: (item as Conversation).templateOnly,
                                windowExpiresAt: (item as Conversation).windowExpiresAt,
                              });
                            }}
                          >
                            <View style={styles.avatar}>
                              {item.participantProfilePic ? (
                                <Image source={{ uri: item.participantProfilePic }} style={styles.avatarImage} />
                              ) : (
                                <Text style={styles.avatarText} numberOfLines={1}>
                                  {getInitials(item.name)}
                                </Text>
                              )}
                            </View>
                            <View style={styles.rowCenter}>
                              <View style={styles.rowTop}>
                                <View style={styles.rowTopLeft}>
                                  <Text style={styles.name} numberOfLines={1}>
                                    {item.name}
                                  </Text>
                                  <GuestOutboundStatsBadges
                                    conversation={item as Conversation}
                                    variant="inline"
                                  />
                                </View>
                                <Text style={styles.date}>
                                  {formatListDate(item.lastMessageAt)}
                                </Text>
                              </View>
                              <View style={styles.rowBottom}>
                                {renderHighlightedSnippet(item.snippet ?? item.lastMessage, searchQuery)}
                                {(item.unreadCount ?? 0) > 0 && (
                                  <View style={styles.unreadBadge}>
                                    <Text style={styles.unreadText}>
                                      {item.unreadCount > 99 ? '99+' : item.unreadCount}
                                    </Text>
                                  </View>
                                )}
                              </View>
                              <View style={styles.metaRow}>
                                {!!item.conversationType && (
                                  <View
                                    style={[
                                      styles.typeBadgeInline,
                                      item.conversationType === 'guest'
                                        ? styles.typeBadgeInlineGuest
                                        : styles.typeBadgeInlineOwner,
                                    ]}
                                  >
                                    <Text style={styles.typeBadgeInlineText}>
                                      {item.conversationType === 'guest' ? 'G' : 'O'}
                                    </Text>
                                  </View>
                                )}
                                <View
                                  style={[
                                    styles.pill,
                                    item.participantLocationKey ? styles.pillLocation : styles.pillNoLocation,
                                  ]}
                                >
                                  <Ionicons
                                    name="location-outline"
                                    size={12}
                                    color={item.participantLocationKey ? colors.textSecondary : '#B45309'}
                                  />
                                  <Text
                                    style={[
                                      styles.pillText,
                                      item.participantLocationKey ? styles.pillTextMuted : styles.pillTextWarn,
                                    ]}
                                  >
                                    {item.participantLocationKey
                                      ? formatLocationLabel(item.participantLocationKey, locationOptions)
                                      : 'No location'}
                                  </Text>
                                </View>
                              </View>
                            </View>
                          </TouchableOpacity>
                        )}
                      />
                    )}
                  </>
                )}
              </>
            ) : (
              <>
                {filteredConversations.length === 0 ? (
                  <Text style={styles.empty}>No conversations yet</Text>
                ) : (
                  <FlatList
                    data={filteredConversations}
                    keyExtractor={(item, index) =>
                      (item.id ? `${item.id}` : `conv-${index}`) + `-${index}`
                    }
                    renderItem={renderRow}
                    onEndReached={loadMore}
                    onEndReachedThreshold={0.3}
                    ListFooterComponent={renderFooter}
                    maintainVisibleContentPosition={{
                      minIndexForVisible: 0,
                      autoscrollToTopThreshold: 20,
                    }}
                    keyboardShouldPersistTaps="handled"
                  />
                )}
              </>
            )}
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  selectionSafeArea: {
    backgroundColor: HEADER_GREEN,
  },
  header: {
    backgroundColor: HEADER_GREEN,
  },
  headerSafe: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
  },
  headerIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
  },
  headerIconBtn: {
    padding: 4,
  },
  content: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: 16,
  },
  titleRow: {
    paddingTop: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.text,
  },
  titleIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconBtn: {
    padding: 4,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 10,
    paddingHorizontal: 12,
    marginBottom: 12,
    minHeight: 40,
  },
  searchIcon: {
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: colors.text,
    paddingVertical: 8,
  },
  tabsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 4,
    justifyContent: 'space-between',
  },
  tabsLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flex: 1,
    minWidth: 0,
  },
  locationFilterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.backgroundSecondary,
    maxWidth: 190,
  },
  locationFilterBtnPressed: {
    opacity: 0.85,
  },
  locationFilterText: {
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  tabActive: {
    backgroundColor: colors.backgroundSecondary,
  },
  tabText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  tabTextActive: {
    color: colors.text,
    fontWeight: '600',
  },
  tabChevron: {
    marginLeft: 2,
  },
  adminQueueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    gap: 12,
    backgroundColor: colors.backgroundSecondary,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  adminQueueRowActive: {
    backgroundColor: '#128C7E',
  },
  adminQueueText: {
    fontSize: 14,
    color: colors.textSecondary,
    flex: 1,
  },
  adminQueueTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  adminQueueBadge: {
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  adminQueueBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  archivedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    gap: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  archivedText: {
    fontSize: 16,
    color: colors.text,
    flex: 1,
  },
  archivedCount: {
    backgroundColor: colors.backgroundSecondary,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  archivedCountText: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  selectionBar: {
    backgroundColor: HEADER_GREEN,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  selectionBackBtn: {
    padding: 4,
  },
  selectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
  },
  selectionActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  selectionIconBtn: {
    paddingHorizontal: 8,
  },
  center: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  error: {
    fontSize: 14,
    color: colors.error,
    marginTop: 8,
  },
  empty: {
    fontSize: 16,
    color: colors.textSecondary,
    marginTop: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowSelected: {
    backgroundColor: 'rgba(7, 94, 84, 0.08)',
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.backgroundSecondary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
    overflow: 'hidden',
  },
  avatarImage: {
    width: 52,
    height: 52,
    borderRadius: 26,
    resizeMode: 'cover',
  },
  avatarText: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  avatarSelectionBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: HEADER_GREEN,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarFavoriteBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  typeBadgeInline: {
    height: 22,
    minWidth: 22,
    paddingHorizontal: 6,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  typeBadgeInlineOwner: {
    backgroundColor: 'rgba(7, 94, 84, 0.10)',
    borderColor: 'rgba(7, 94, 84, 0.24)',
  },
  typeBadgeInlineGuest: {
    backgroundColor: 'rgba(37, 211, 102, 0.12)',
    borderColor: 'rgba(37, 211, 102, 0.26)',
  },
  typeBadgeInlineText: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.textSecondary,
  },
  rowCenter: {
    flex: 1,
    minWidth: 0,
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
    gap: 8,
  },
  rowTopLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
  },
  name: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.text,
    flexShrink: 1,
    minWidth: 0,
  },
  date: {
    fontSize: 13,
    color: colors.textMuted,
    marginLeft: 8,
  },
  rowBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
    flexWrap: 'wrap',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  pillLocation: {
    backgroundColor: colors.backgroundSecondary,
    borderColor: colors.border,
  },
  pillNoLocation: {
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    borderColor: 'rgba(245, 158, 11, 0.22)',
  },
  pillText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  pillTextMuted: {
    color: colors.textSecondary,
  },
  pillTextWarn: {
    color: '#B45309',
  },
  lastMessage: {
    fontSize: 15,
    color: colors.textSecondary,
    flex: 1,
  },
  highlightText: {
    fontWeight: '600',
    color: colors.primary,
  },
  unreadBadge: {
    backgroundColor: colors.primary,
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
    paddingHorizontal: 6,
  },
  unreadText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#fff',
  },
  footerLoader: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  pickerCard: {
    backgroundColor: colors.background,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pickerTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.text,
    marginBottom: 8,
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 10,
  },
  pickerRowActive: {
    backgroundColor: 'rgba(7, 94, 84, 0.08)',
  },
  pickerRowPressed: {
    opacity: 0.85,
  },
  pickerRowText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  avatarPreviewOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  avatarPreviewCard: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  avatarPreviewClose: {
    position: 'absolute',
    top: 10,
    right: 10,
    zIndex: 2,
    height: 40,
    width: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarPreviewImage: {
    width: '100%',
    aspectRatio: 1,
    maxHeight: 420,
    resizeMode: 'cover',
  },
  modalCard: {
    backgroundColor: colors.background,
    borderRadius: 16,
    padding: 16,
  },
  typeRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
    marginBottom: 10,
  },
  typePill: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.backgroundSecondary,
    minHeight: 44,
  },
  typePillActive: {
    backgroundColor: 'rgba(7, 94, 84, 0.10)',
    borderColor: 'rgba(7, 94, 84, 0.24)',
  },
  typePillPressed: {
    opacity: 0.85,
  },
  typePillText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  typePillTextActive: {
    color: colors.text,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  modalSubtitle: {
    marginTop: 4,
    fontSize: 14,
    color: colors.textSecondary,
  },
  modalRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 14,
  },
  modalFieldSmall: {
    width: 110,
  },
  modalField: {
    flex: 1,
  },
  modalFieldFull: {
    marginTop: 10,
  },
  modalLabel: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: 6,
  },
  locationRow: {
    marginTop: 12,
  },
  locationChips: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  locationChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.backgroundSecondary,
    minHeight: 36,
  },
  locationChipActive: {
    backgroundColor: 'rgba(7, 94, 84, 0.10)',
    borderColor: 'rgba(7, 94, 84, 0.24)',
  },
  locationChipPressed: {
    opacity: 0.85,
  },
  locationChipText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  locationChipTextActive: {
    color: colors.text,
  },
  modalInput: {
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.text,
  },
  modalError: {
    marginTop: 10,
    color: colors.error,
    fontSize: 13,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 16,
  },
  modalBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  modalBtnSecondary: {
    backgroundColor: colors.backgroundSecondary,
  },
  modalBtnPrimary: {
    backgroundColor: HEADER_GREEN,
  },
  modalBtnSecondaryText: {
    color: colors.text,
    fontWeight: '600',
  },
  modalBtnPrimaryText: {
    color: '#fff',
    fontWeight: '700',
  },
});
