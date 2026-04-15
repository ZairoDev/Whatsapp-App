import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useChatStore } from '../chat.store';
import {
  fetchConversations,
  fetchPhoneConfigs,
  getPhoneIdForArea,
  searchConversations,
} from '../services';
import type { ChatAppStackParamList } from '../../../core/navigation/ChatAppStack';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
  import { useFocusEffect } from '@react-navigation/native';
import { colors } from '../../../theme/colors';
import type { Conversation } from '../types';
import type { ConversationSearchResult } from '../services';
import { joinWhatsAppPhone, leaveWhatsAppPhone } from '../../../services/socket';

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
  const { conversations, setConversations, appendConversations, phoneConfigs, setPhoneConfigs } = useChatStore();
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
  const [newChatError, setNewChatError] = useState<string | null>(null);
  /** Tracks which area the in-memory list was last loaded for (not persisted). */
  const lastFetchedAreaRef = useRef<string | null>(null);
  const onEndReachedCalled = useRef(false);

  const initialArea = route.params?.initialArea ?? 'athens';
  const area = initialArea as 'athens' | 'thessaloniki';

  // Join the phone-specific Socket.IO room for the selected area so incoming messages stream in real-time.
  useEffect(() => {
    const configs = useChatStore.getState().phoneConfigs ?? [];
    const phoneId = getPhoneIdForArea(area, configs);
    if (phoneId) joinWhatsAppPhone(phoneId);
    return () => {
      if (phoneId) leaveWhatsAppPhone(phoneId);
    };
  }, [area]);

  // Refetch whenever this screen is focused. The old useEffect skipped loading when the
  // Zustand store already had rows for this area — but React Navigation often keeps this
  // screen mounted under the detail screen, so returning from a chat never re-ran the
  // effect and the list stayed stale vs the website (fresh GET each visit).
  //
  // We also call /api/whatsapp/phone-configs first (exactly like the website) so the
  // phoneId is always resolved from Meta — not from hardcoded .env values which were
  // pointing to the wrong phone number for Thessaloniki.
  useFocusEffect(
    useCallback(() => {
      const areaChanged = lastFetchedAreaRef.current !== area;
      lastFetchedAreaRef.current = area;
      const hadList = useChatStore.getState().conversations.length > 0;
      const showFullScreenLoader = !hadList || areaChanged;

      let cancelled = false;
      (async () => {
        try {
          if (showFullScreenLoader) {
            setLoading(true);
          }
          setError(null);
          setNextCursor(null);
          setHasMore(false);

          // Resolve phone configs from backend (Meta-validated) on first load or if missing.
          // This is the same call the website makes before fetching conversations.
          let configs = useChatStore.getState().phoneConfigs;
          if (!configs) {
            configs = await fetchPhoneConfigs();
            if (!cancelled) setPhoneConfigs(configs);
          }

          const phoneId = getPhoneIdForArea(area, configs);
          const result = await fetchConversations(area, null, phoneId);
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
    }, [area, setConversations, setPhoneConfigs])
  );

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || !nextCursor) return;
    if (onEndReachedCalled.current) return;
    onEndReachedCalled.current = true;
    try {
      setLoadingMore(true);
      const configs = useChatStore.getState().phoneConfigs ?? [];
      const phoneId = getPhoneIdForArea(area, configs);
      const result = await fetchConversations(area, nextCursor, phoneId);
      appendConversations(result.conversations);
      setNextCursor(result.nextCursor);
      setHasMore(result.hasMore);
    } catch {
      // non-blocking
    } finally {
      setLoadingMore(false);
      onEndReachedCalled.current = false;
    }
  }, [area, hasMore, nextCursor, loadingMore, appendConversations]);

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
        const results = await searchConversations(area, q);
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
  }, [area, searchQuery]);

  const filteredConversations = useMemo(() => {
    let list = conversations;
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
  }, [conversations, searchQuery, activeFilter]);

  const archivedCount = 0; // Placeholder; could come from API later

  const isSelectionMode = selectedIds.length > 0;

  const openNewChat = useCallback(() => {
    setNewChatError(null);
    setPhoneNumber('');
    setShowNewChatModal(true);
  }, []);

  const startChatWithNumber = useCallback(() => {
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
    setShowNewChatModal(false);
    setNewChatError(null);
    navigation.navigate('ConversationDetail', {
      conversationId: `draft:${to}`,
      area,
      conversationName: `+${to}`,
      participantPhone: to,
      templateOnly: true,
      isDraft: true,
    });
  }, [countryCode, phoneNumber, navigation, area]);

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

  const archiveSelection = useCallback(() => {
    // Placeholder: wire to real archive endpoint when available.
    clearSelection();
  }, [clearSelection]);

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
              area,
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
        <View style={styles.avatar}>
          <Text style={styles.avatarText} numberOfLines={1}>
            {getInitials(item.name)}
          </Text>
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
        </View>
        <View style={styles.rowCenter}>
          <View style={styles.rowTop}>
            <Text style={styles.name} numberOfLines={1}>
              {item.name}
            </Text>
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
        </View>
      </TouchableOpacity>
    ),
    [navigation, area, isSelectionMode, selectedIds, toggleSelected]
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
              <Ionicons name="chevron-down" size={14} color={colors.textMuted} style={styles.tabChevron} />
            )}
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity
        style={styles.archivedRow}
        activeOpacity={0.7}
        onPress={() => navigation.navigate('ArchiveList')}
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
                <Text style={styles.modalSubtitle}>Enter country code and phone number</Text>

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
                                area,
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
                              <Text style={styles.avatarText} numberOfLines={1}>
                                {getInitials(item.name)}
                              </Text>
                            </View>
                            <View style={styles.rowCenter}>
                              <View style={styles.rowTop}>
                                <Text style={styles.name} numberOfLines={1}>
                                  {item.name}
                                </Text>
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
  rowCenter: {
    flex: 1,
    minWidth: 0,
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  name: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.text,
    flex: 1,
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
  modalCard: {
    backgroundColor: colors.background,
    borderRadius: 16,
    padding: 16,
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
  modalLabel: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: 6,
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
