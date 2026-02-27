import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useChatStore } from '../chat.store';
import { fetchConversations, searchConversations } from '../services';
import type { ChatAppStackParamList } from '../../../core/navigation/ChatAppStack';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { colors } from '../../../theme/colors';
import type { Conversation } from '../types';
import type { ConversationSearchResult } from '../services';

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
  const { conversations, setConversations, appendConversations } = useChatStore();
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
  const loadedAreaRef = useRef<string | null>(null);
  const onEndReachedCalled = useRef(false);

  const initialArea = route.params?.initialArea ?? 'athens';
  const area = initialArea as 'athens' | 'thessaloniki';

  useEffect(() => {
    if (loadedAreaRef.current === area && conversations.length > 0) {
      return;
    }
    loadedAreaRef.current = area;
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        setNextCursor(null);
        setHasMore(false);
        const result = await fetchConversations(area);
        if (!cancelled) {
          setConversations(result.conversations);
          setNextCursor(result.nextCursor);
          setHasMore(result.hasMore);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load conversations');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [area, setConversations]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || !nextCursor) return;
    if (onEndReachedCalled.current) return;
    onEndReachedCalled.current = true;
    try {
      setLoadingMore(true);
      const result = await fetchConversations(area, nextCursor);
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
    return list;
  }, [conversations, searchQuery, activeFilter]);

  const archivedCount = 0; // Placeholder; could come from API later

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
        style={styles.row}
        onPress={() => {
          navigation.navigate('ConversationDetail', {
            conversationId: item.id,
            area,
            conversationName: item.name,
          });
        }}
        activeOpacity={0.7}
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
    [navigation, area]
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
          <TouchableOpacity style={styles.iconBtn} hitSlop={8}>
            <Ionicons name="cellular-outline" size={22} color={colors.primary} />
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
                                highlightMessageId: item.messageId,
                                highlightTimestamp: item.messageTimestamp,
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
});
