import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
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
import { useTheme } from '../../../theme/ThemeContext';
import type { AppColors } from '../../../theme/palettes';
import type { Conversation } from '../types';
import type { ConversationSearchResult } from '../services';
import { joinWhatsAppPhone, leaveWhatsAppPhone, joinWhatsAppChannel, leaveWhatsAppChannel } from '../../../services/socket';
import { GuestOutboundStatsBadges } from '../components/GuestOutboundStatsBadges';

type Props = NativeStackScreenProps<ChatAppStackParamList, 'ConversationList'>;

const FILTER_TABS = ['All', 'Unread', 'Favourites'] as const;

type FilterTab = (typeof FILTER_TABS)[number];

import { getInitials, formatListDate, escapeRegExp } from './conversationListScreen.utils';

export function ConversationListScreen({ route, navigation }: Props) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const newChatSheetMaxHeight = Math.min(windowHeight * 0.9, 640);
  const styles = useMemo(
    () => createStyles(colors, insets.top, insets.bottom, isDark, newChatSheetMaxHeight),
    [colors, insets.top, insets.bottom, isDark, newChatSheetMaxHeight],
  );
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
  const [adminQueue, setAdminQueue] = useState(() => Boolean(route.params?.initialAdminQueue));
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

  const locationChipActive = adminQueue || locationFilter !== 'all';
  const locationChipLabel = adminQueue
    ? 'Admin queue'
    : locationFilter === 'all'
      ? 'Locations'
      : formatLocationLabel(locationFilter, locationOptions);

  const listScrollHeader = (
    <>
      <View style={styles.searchWrap}>
        <Ionicons name="search" size={18} color={styles.searchIconColor.color} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search by name, phone or message"
          placeholderTextColor={styles.searchPlaceholderColor.color}
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipsScroll}
        keyboardShouldPersistTaps="handled"
        style={styles.chipsRow}
      >
        {FILTER_TABS.map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[styles.chip, activeFilter === tab && styles.chipActive]}
            onPress={() => setActiveFilter(tab)}
            activeOpacity={0.7}
          >
            <Text style={[styles.chipText, activeFilter === tab && styles.chipTextActive]}>
              {tab}
            </Text>
          </TouchableOpacity>
        ))}

        <Pressable
          onPress={() => setShowLocationFilterModal(true)}
          accessibilityRole="button"
          accessibilityLabel="Filter by location"
          style={({ pressed }) => [
            styles.chip,
            styles.locationFilterChip,
            locationChipActive && styles.chipActive,
            pressed && styles.chipPressed,
          ]}
        >
          <Ionicons
            name="location-outline"
            size={14}
            color={locationChipActive ? styles.chipTextActive.color : styles.chipText.color}
          />
          <Text
            style={[styles.chipText, locationChipActive && styles.chipTextActive]}
            numberOfLines={1}
          >
            {locationChipLabel}
          </Text>
          <Ionicons
            name="chevron-down"
            size={14}
            color={locationChipActive ? styles.chipTextActive.color : styles.chipText.color}
          />
        </Pressable>

        {hasFullLocationAccess(tokenData?.role) && (
          <TouchableOpacity
            style={[styles.chip, adminQueue && styles.chipActive]}
            activeOpacity={0.7}
            onPress={() => {
              setAdminQueue((prev) => !prev);
              setLocationFilter('all');
            }}
          >
            <Text style={[styles.chipText, adminQueue && styles.chipTextActive]}>Admin queue</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      <TouchableOpacity
        style={styles.archivedRow}
        activeOpacity={0.7}
        onPress={() => navigation.navigate('ArchiveList', { defaultArea })}
      >
        <Ionicons name="archive-outline" size={20} color={colors.textMuted} />
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
        animationType="slide"
        onRequestClose={() => setShowNewChatModal(false)}
      >
        <View style={styles.newChatOverlay}>
          <Pressable
            style={styles.newChatBackdrop}
            onPress={() => setShowNewChatModal(false)}
            accessibilityRole="button"
            accessibilityLabel="Close new chat"
          />
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.newChatSheetWrap}
          >
            <View style={styles.newChatSheet}>
              <View style={styles.newChatHandle} />

              <View style={styles.newChatHeader}>
                <Pressable
                  onPress={() => setShowNewChatModal(false)}
                  style={({ pressed }) => [styles.newChatHeaderBtn, pressed && styles.chipPressed]}
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                  hitSlop={8}
                >
                  <Ionicons name="close" size={24} color={styles.headerIconColor.color} />
                </Pressable>
                <Text style={styles.newChatHeaderTitle}>New chat</Text>
                <View style={styles.newChatHeaderBtn} />
              </View>

              <ScrollView
                style={styles.newChatBody}
                contentContainerStyle={styles.newChatBodyContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                bounces={false}
              >
                <Text style={[styles.newChatSectionLabel, styles.newChatSectionLabelFirst]}>Contact type</Text>
                <View style={styles.newChatTypeRow}>
                  {(['owner', 'guest'] as const).map((type) => (
                    <Pressable
                      key={type}
                      onPress={() => setNewContactType(type)}
                      style={({ pressed }) => [
                        styles.chip,
                        newContactType === type && styles.chipActive,
                        pressed && styles.chipPressed,
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={type === 'owner' ? 'Add owner' : 'Add guest'}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          newContactType === type && styles.chipTextActive,
                        ]}
                      >
                        {type === 'owner' ? 'Owner' : 'Guest'}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <Text style={styles.newChatSectionLabel}>Name</Text>
                <View style={styles.newChatFieldGroup}>
                  <TextInput
                    style={styles.newChatFieldInput}
                    value={newContactName}
                    onChangeText={setNewContactName}
                    placeholder={newContactType === 'guest' ? 'Guest name (optional)' : 'Owner name (optional)'}
                    placeholderTextColor={styles.searchPlaceholderColor.color}
                    autoCorrect={false}
                    autoCapitalize="words"
                  />
                </View>

                <Text style={styles.newChatSectionLabel}>Location</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  nestedScrollEnabled
                  contentContainerStyle={styles.newChatLocationScroll}
                  keyboardShouldPersistTaps="handled"
                >
                  {locationOptions.map((loc) => {
                    const locKey = normalizeLocationKey(loc);
                    const selected = newContactLocation === locKey;
                    return (
                      <Pressable
                        key={locKey}
                        onPress={() => setNewContactLocation(locKey)}
                        style={({ pressed }) => [
                          styles.chip,
                          styles.newChatLocationChip,
                          selected && styles.chipActive,
                          pressed && styles.chipPressed,
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel={`Set location ${loc}`}
                      >
                        <Ionicons
                          name="location-outline"
                          size={14}
                          color={selected ? styles.chipTextActive.color : styles.chipText.color}
                        />
                        <Text
                          style={[styles.chipText, selected && styles.chipTextActive]}
                          numberOfLines={1}
                        >
                          {loc}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>

                <Text style={styles.newChatSectionLabel}>Phone number</Text>
                <View style={styles.newChatFieldGroup}>
                  <View style={styles.newChatPhoneRow}>
                    <TextInput
                      style={styles.newChatCountryInput}
                      value={countryCode}
                      onChangeText={(v) => setCountryCode(v.startsWith('+') ? v : `+${v}`)}
                      placeholder="+30"
                      placeholderTextColor={styles.searchPlaceholderColor.color}
                      keyboardType="phone-pad"
                      autoCorrect={false}
                      autoCapitalize="none"
                    />
                    <View style={styles.newChatPhoneDivider} />
                    <TextInput
                      style={styles.newChatPhoneInput}
                      value={phoneNumber}
                      onChangeText={setPhoneNumber}
                      placeholder="Phone number"
                      placeholderTextColor={styles.searchPlaceholderColor.color}
                      keyboardType="phone-pad"
                      autoCorrect={false}
                      autoCapitalize="none"
                    />
                  </View>
                </View>

                {newChatError ? <Text style={styles.newChatError}>{newChatError}</Text> : null}

                <Text style={styles.newChatHint}>
                  Enter a WhatsApp number to start messaging. Templates are available if the 24-hour window has expired.
                </Text>
              </ScrollView>

              <View style={styles.newChatFooter}>
                <Pressable
                  onPress={startChatWithNumber}
                  style={({ pressed }) => [
                    styles.newChatContinueBtn,
                    pressed && styles.newChatContinueBtnPressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Continue to chat"
                >
                  <Text style={styles.newChatContinueText}>Continue</Text>
                </Pressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {isSelectionMode && (
        <SafeAreaView edges={['top']} style={styles.selectionSafeArea}>
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
        </SafeAreaView>
      )}

      <View style={styles.content}>
        {!isSelectionMode && (
          <View style={styles.titleRow}>
            <Text style={styles.title}>Adminstro</Text>
            <View style={styles.titleIcons}>
              <TouchableOpacity style={styles.iconBtn} hitSlop={8}>
                <Ionicons name="camera-outline" size={24} color={styles.headerIconColor.color} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.iconBtn} hitSlop={8}>
                <Ionicons name="ellipsis-vertical" size={22} color={styles.headerIconColor.color} />
              </TouchableOpacity>
            </View>
          </View>
        )}
        {loading && (
          <View style={styles.center}>
            <ActivityIndicator size="small" color={colors.primary} />
          </View>
        )}
        {error && !loading && <Text style={styles.error}>{error}</Text>}
        {!loading && !error && (
          <>
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
                  <FlatList
                    style={styles.list}
                    data={searchResults}
                    keyExtractor={(item, index) =>
                      item.id ? `${item.id}` : `search-${index}`
                    }
                    ListHeaderComponent={listScrollHeader}
                    ListEmptyComponent={<Text style={styles.empty}>No results</Text>}
                    keyboardShouldPersistTaps="handled"
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
            ) : (
              <FlatList
                style={styles.list}
                data={filteredConversations}
                keyExtractor={(item, index) =>
                  (item.id ? `${item.id}` : `conv-${index}`) + `-${index}`
                }
                renderItem={renderRow}
                ListHeaderComponent={listScrollHeader}
                ListEmptyComponent={<Text style={styles.empty}>No conversations yet</Text>}
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
      </View>

      {!isSelectionMode && !loading && (
        <TouchableOpacity
          style={styles.newChatFab}
          onPress={openNewChat}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Start a new chat"
        >
          <MaterialCommunityIcons
            name={isDark ? 'message-plus' : 'message-plus-outline'}
            size={28}
            color={isDark ? '#111B21' : '#fff'}
          />
        </TouchableOpacity>
      )}
    </View>
  );
}

/* v8 ignore start -- style factory; validated visually, not unit-tested */
function createStyles(
  colors: AppColors,
  safeAreaTop: number,
  safeAreaBottom: number,
  isDark: boolean,
  newChatSheetMaxHeight: number,
) {
  return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  list: {
    flex: 1,
  },
  selectionSafeArea: {
    backgroundColor: colors.chatHeader,
  },
  header: {
    backgroundColor: colors.chatHeader,
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
    paddingTop: safeAreaTop + 5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 10,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    letterSpacing: -0.5,
    color: isDark ? '#FFFFFF' : '#1DAA61',
  },
  titleIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
  },
  headerIconColor: {
    color: isDark ? colors.text : '#111B21',
  },
  iconBtn: {
    padding: 2,
  },
  newChatFab: {
    position: 'absolute',
    right: 16,
    bottom: Math.max(safeAreaBottom, 12) + 12,
    width: 56,
    height: 56,
    borderRadius: 14,
    backgroundColor: isDark ? '#FFFFFF' : colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 4,
      },
      android: {
        elevation: 6,
      },
    }),
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: isDark ? colors.surface : '#F0F2F5',
    borderRadius: 22,
    paddingHorizontal: 14,
    marginTop: 2,
    marginBottom: 10,
    minHeight: 38,
  },
  searchIcon: {
    marginRight: 10,
  },
  searchIconColor: {
    color: isDark ? colors.textMuted : '#8696A0',
  },
  searchPlaceholderColor: {
    color: isDark ? colors.textMuted : '#8696A0',
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: colors.text,
    paddingVertical: Platform.OS === 'ios' ? 9 : 7,
  },
  chipsRow: {
    marginBottom: 8,
  },
  chipsScroll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingRight: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: isDark ? 'rgba(255,255,255,0.12)' : '#E9EDEF',
    backgroundColor: isDark ? colors.surface : '#FFFFFF',
  },
  chipActive: {
    backgroundColor: isDark ? 'rgba(37, 211, 102, 0.14)' : '#E7FCE8',
    borderColor: isDark ? colors.primary : '#25D366',
  },
  chipPressed: {
    opacity: 0.85,
  },
  locationFilterChip: {
    gap: 5,
    maxWidth: 180,
  },
  chipText: {
    fontSize: 14,
    fontWeight: '500',
    color: isDark ? colors.textSecondary : '#3B4A54',
  },
  chipTextActive: {
    color: isDark ? colors.primary : '#008069',
    fontWeight: '600',
  },
  archivedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 12,
    marginBottom: 2,
  },
  archivedText: {
    fontSize: 15,
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
    backgroundColor: colors.chatHeader,
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
    fontSize: 15,
    color: colors.textSecondary,
    marginTop: 12,
    marginBottom: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
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
    backgroundColor: colors.chatHeader,
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
  newChatOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  newChatBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  newChatSheetWrap: {
    maxHeight: newChatSheetMaxHeight,
  },
  newChatSheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: newChatSheetMaxHeight,
    paddingBottom: Math.max(safeAreaBottom, 12),
    overflow: 'hidden',
    flexShrink: 1,
  },
  newChatHandle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: isDark ? 'rgba(255,255,255,0.18)' : '#D1D7DB',
    marginTop: 8,
    marginBottom: 4,
  },
  newChatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  newChatHeaderBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  newChatHeaderTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  newChatBody: {
    flexGrow: 0,
    flexShrink: 1,
  },
  newChatBodyContent: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 12,
  },
  newChatSectionLabel: {
    marginTop: 14,
    marginBottom: 8,
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  newChatSectionLabelFirst: {
    marginTop: 6,
  },
  newChatTypeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  newChatFieldGroup: {
    borderRadius: 12,
    backgroundColor: isDark ? colors.surface : '#F0F2F5',
    overflow: 'hidden',
  },
  newChatFieldInput: {
    minHeight: 48,
    paddingHorizontal: 14,
    fontSize: 16,
    color: colors.text,
    paddingVertical: Platform.OS === 'ios' ? 12 : 10,
  },
  newChatLocationScroll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingRight: 8,
  },
  newChatLocationChip: {
    gap: 5,
    maxWidth: 160,
  },
  newChatPhoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
  },
  newChatCountryInput: {
    width: 72,
    paddingHorizontal: 14,
    fontSize: 16,
    color: colors.text,
    paddingVertical: Platform.OS === 'ios' ? 12 : 10,
    textAlign: 'center',
  },
  newChatPhoneDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    backgroundColor: colors.border,
    marginVertical: 10,
  },
  newChatPhoneInput: {
    flex: 1,
    paddingHorizontal: 14,
    fontSize: 16,
    color: colors.text,
    paddingVertical: Platform.OS === 'ios' ? 12 : 10,
  },
  newChatError: {
    marginTop: 12,
    color: colors.error,
    fontSize: 13,
    lineHeight: 18,
  },
  newChatHint: {
    marginTop: 14,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textMuted,
  },
  newChatFooter: {
    paddingHorizontal: 16,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  newChatContinueBtn: {
    minHeight: 48,
    borderRadius: 24,
    backgroundColor: isDark ? colors.primary : '#1DAA61',
    alignItems: 'center',
    justifyContent: 'center',
  },
  newChatContinueBtnPressed: {
    opacity: 0.88,
  },
  newChatContinueText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  });
}
/* v8 ignore end */
