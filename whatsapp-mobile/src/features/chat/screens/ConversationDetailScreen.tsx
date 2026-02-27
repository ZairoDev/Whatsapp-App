import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ResizeMode, Video } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { fetchConversationMessages } from '../services';
import type { Message } from '../types';
import type { ChatAppStackParamList } from '../../../core/navigation/ChatAppStack';
import { colors } from '../../../theme/colors';

type Props = NativeStackScreenProps<ChatAppStackParamList, 'ConversationDetail'>;

function formatDateChip(ts?: number): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function formatTime(ts?: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getInitials(name?: string | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase().slice(0, 2);
  }
  return (name.trim().slice(0, 2) || '?').toUpperCase();
}

// Video playback happens on a dedicated full screen; here we only show a tappable thumbnail.

export function ConversationDetailScreen({ route, navigation }: Props) {
  const {
    conversationId,
    area,
    conversationName,
    highlightMessageId,
    highlightTimestamp,
  } = route.params;
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<{ messageId: string; timestamp: string } | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [pendingHighlight, setPendingHighlight] = useState<{
    id?: string;
    ts?: number;
  } | null>(
    highlightMessageId || highlightTimestamp
      ? { id: highlightMessageId, ts: highlightTimestamp }
      : null
  );
  const onEndReachedRef = useRef(false);
  const flatListRef = useRef<FlatList<Message>>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isMedia = (m: Message) =>
    (m.type === 'image' || m.type === 'video') && (m.mediaUrl || m.thumbnailUrl);

  const mediaGalleryItems = useMemo(
    () =>
      [...messages]
        .filter(isMedia)
        .sort((a, b) => a.timestamp - b.timestamp)
        .map((m) => ({
          id: m.id,
          type: m.type === 'image' ? ('image' as const) : ('video' as const),
          uri: m.mediaUrl || m.thumbnailUrl || '',
          thumbnailUri: m.thumbnailUrl || m.mediaUrl || undefined,
        })),
    [messages]
  );

  const openMediaGalleryAt = useCallback(
    (messageId: string) => {
      if (!mediaGalleryItems.length) return;
      const idx = mediaGalleryItems.findIndex((it) => it.id === messageId);
      const initialIndex = idx >= 0 ? idx : 0;
      navigation.navigate('VideoPlayer', {
        items: mediaGalleryItems,
        initialIndex,
      });
    },
    [mediaGalleryItems, navigation]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const result = await fetchConversationMessages(conversationId, area, 20);
        if (!cancelled) {
          // setMessages(result.messages);
          const apiMessages = result.messages ?? [];
          // Store messages newest-first so with inverted FlatList the latest appears at the bottom.
          const newestFirst = [...apiMessages].reverse();
          setMessages(newestFirst);
          setNextCursor(result.nextCursor);
          setHasMore(result.hasMore);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load messages');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationId, area]);

  const loadOlder = useCallback(async () => {
    if (loadingOlder || !hasMore || !nextCursor) return;
    if (onEndReachedRef.current) return;
    onEndReachedRef.current = true;
    try {
      setLoadingOlder(true);
      const result = await fetchConversationMessages(
        conversationId,
        area,
        20,
        nextCursor.messageId,
        nextCursor.timestamp
      );
      // setMessages((prev) => [...result.messages, ...prev]);
      const olderChunk = result.messages ?? [];
      const olderNewestFirst = [...olderChunk].reverse();
      // For newest-first array, append still older messages at the end.
      setMessages((prev) => [...prev, ...olderNewestFirst]);
      setNextCursor(result.nextCursor);
      setHasMore(result.hasMore);
    } catch {
      // non-blocking
    } finally {
      setLoadingOlder(false);
      onEndReachedRef.current = false;
    }
  }, [conversationId, area, hasMore, nextCursor, loadingOlder]);

  useEffect(() => {
    if (!pendingHighlight || !messages.length) return;

    let index = -1;
    if (pendingHighlight.id) {
      index = messages.findIndex((m) => m.id === pendingHighlight.id);
    }
    if (index === -1 && pendingHighlight.ts) {
      index = messages.findIndex((m) => m.timestamp === pendingHighlight.ts);
    }

    if (index !== -1) {
      const targetId = messages[index].id;
      setHighlightedMessageId(targetId);
      flatListRef.current?.scrollToIndex({ index, animated: true });

      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current);
      }
      highlightTimerRef.current = setTimeout(() => {
        setHighlightedMessageId(null);
      }, 1000);

      setPendingHighlight(null);
      return;
    }

    // Not found in currently loaded messages – try to load older ones if available.
    if (hasMore && !loadingOlder) {
      // Fire and forget; when messages update, this effect will run again.
      (async () => {
        try {
          await loadOlder();
        } catch {
          // ignore
        }
      })();
    } else {
      // No more messages to load or already loading; give up on highlight.
      setPendingHighlight(null);
    }

    return () => {
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current);
      }
    };
  }, [messages, pendingHighlight, hasMore, loadingOlder, loadOlder]);

  const renderMessage = ({
    item,
    index,
  }: {
    item: Message;
    index: number;
  }) => {
    const isOut = item.direction === 'outgoing';
    const isHighlighted = highlightedMessageId != null && item.id === highlightedMessageId;
    const previous = index > 0 ? messages[index - 1] : undefined;
    const previousDay =
      previous && new Date(previous.timestamp).toDateString();
    const currentDay = new Date(item.timestamp).toDateString();
    const showDateChip = !previous || previousDay !== currentDay;

    // Group consecutive media messages of same direction sent close together
    let mediaGroup: Message[] | null = null;
    if (isMedia(item)) {
      const previousIsSameMediaGroup =
        index > 0 &&
        isMedia(messages[index - 1]) &&
        messages[index - 1].direction === item.direction &&
        Math.abs(messages[index - 1].timestamp - item.timestamp) < 60 * 1000;

      if (previousIsSameMediaGroup) {
        // This item will be rendered as part of a previous group's bubble
        return null;
      }

      const group: Message[] = [item];
      let j = index + 1;
      while (j < messages.length) {
        const candidate = messages[j];
        if (
          isMedia(candidate) &&
          candidate.direction === item.direction &&
          Math.abs(candidate.timestamp - item.timestamp) < 60 * 1000
        ) {
          group.push(candidate);
          j += 1;
        } else {
          break;
        }
      }
      mediaGroup = group.length >= 3 ? group : null;
    }

    return (
      <View>
        {showDateChip && (
          <View style={styles.dateChipWrap}>
            <Text style={styles.dateChipText}>
              {formatDateChip(item.timestamp) ?? ''}
            </Text>
          </View>
        )}
        <View
          style={[
            styles.bubbleWrap,
            isOut ? styles.bubbleWrapOut : styles.bubbleWrapIn,
          ]}
        >
          <View
            style={[
              styles.bubble,
              isOut ? styles.bubbleOut : styles.bubbleIn,
              isHighlighted && styles.bubbleHighlight,
            ]}
          >
            {mediaGroup ? (
              <View style={styles.bubbleMediaColumn}>
                <View style={styles.mediaGrid}>
                  {mediaGroup.slice(0, 3).map((m, idx) => {
                    const isVideo = m.type === 'video';
                    const mediaUri = m.thumbnailUrl || m.mediaUrl || '';
                    const isLastAndMore =
                      mediaGroup.length > 3 && idx === 2;
                    return (
                      <TouchableOpacity
                        key={m.id}
                        activeOpacity={0.85}
                        style={styles.mediaGridItem}
                        onPress={() => openMediaGalleryAt(m.id)}
                      >
                        {isVideo ? (
                          mediaUri ? (
                            <Image
                              source={{ uri: mediaUri }}
                              style={styles.mediaGridImage}
                              resizeMode="cover"
                            />
                          ) : (
                            <View style={styles.mediaGridImagePlaceholder}>
                              <Ionicons name="videocam" size={24} color="rgba(255,255,255,0.7)" />
                            </View>
                          )
                        ) : (
                          <Image
                            source={{ uri: mediaUri }}
                            style={styles.mediaGridImage}
                            resizeMode="cover"
                          />
                        )}
                        {isVideo && (
                          <View style={styles.mediaGridPlayOverlay} pointerEvents="none">
                            <Ionicons name="play-circle" size={32} color="rgba(255,255,255,0.95)" />
                          </View>
                        )}
                        {isLastAndMore && (
                          <View style={styles.mediaGridMoreOverlay} pointerEvents="none">
                            <Text style={styles.mediaGridMoreText}>+{mediaGroup.length - 3}</Text>
                          </View>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <Text style={styles.bubbleTime}>
                  {formatTime(mediaGroup[mediaGroup.length - 1].timestamp)}
                </Text>
              </View>
            ) : (item.type === 'image' || item.type === 'video') && (item.mediaUrl || item.thumbnailUrl) ? (
              <View style={styles.bubbleMediaColumn}>
                {item.type === 'video' ? (
                  <TouchableOpacity
                    activeOpacity={0.85}
                    style={styles.mediaWrap}
                    onPress={() => openMediaGalleryAt(item.id)}
                  >
                    {item.thumbnailUrl ? (
                      <Image
                        source={{ uri: item.thumbnailUrl }}
                        style={styles.mediaImage}
                        resizeMode="cover"
                      />
                    ) : (
                      <Video
                        source={{ uri: item.mediaUrl || '' }}
                        style={styles.mediaImage}
                        resizeMode={ResizeMode.COVER}
                        useNativeControls={false}
                        shouldPlay={false}
                        isMuted
                        isLooping={false}
                      />
                    )}
                    <View style={styles.videoPlayOverlay} pointerEvents="none">
                      <Ionicons name="play-circle" size={52} color="rgba(255,255,255,0.95)" />
                    </View>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    activeOpacity={0.85}
                    style={styles.mediaWrap}
                    onPress={() => openMediaGalleryAt(item.id)}
                  >
                    <Image
                      source={{ uri: item.mediaUrl || '' }}
                      style={styles.mediaImage}
                      resizeMode="cover"
                    />
                  </TouchableOpacity>
                )}
                {(item.displayText || item.content) ? (
                  <Text style={styles.bubbleText}>{item.displayText || item.content}</Text>
                ) : null}
                <Text style={styles.bubbleTime}>{formatTime(item.timestamp)}</Text>
              </View>
            ) : (
              <>
                <Text style={styles.bubbleText}>{item.displayText || item.content}</Text>
                <Text style={styles.bubbleTime}>{formatTime(item.timestamp)}</Text>
              </>
            )}
          </View>
        </View>
      </View>
    );
  };

  const renderHeader = () =>
    loadingOlder ? (
      <View style={styles.olderLoader}>
        <ActivityIndicator size="small" color={colors.primary} />
      </View>
    ) : null;

  const latestTimestamp = messages.length ? messages[messages.length - 1].timestamp : undefined;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <SafeAreaView edges={['top']} style={styles.headerSafe}>
          <View style={styles.headerLeft}>
            <TouchableOpacity
              onPress={() => navigation.goBack()}
              style={styles.backBtn}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Ionicons name="chevron-back" size={24} color={colors.text} />
            </TouchableOpacity>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{getInitials(conversationName)}</Text>
            </View>
            <View style={styles.headerTextBlock}>
              <Text style={styles.headerTitle} numberOfLines={1}>
                {conversationName || 'Chat'}
              </Text>
              <Text style={styles.headerSubtitle} numberOfLines={1}>
                {conversationId}
              </Text>
            </View>
          </View>
          <View style={styles.headerRight}>
            <View style={styles.templatePill}>
              <Text style={styles.templatePillText}>Template only</Text>
            </View>
            <TouchableOpacity
              style={styles.moreBtn}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Ionicons name="ellipsis-vertical" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>

      <View style={styles.chatArea}>
        {loading && (
          <View style={styles.center}>
            <ActivityIndicator size="small" color={colors.primary} />
          </View>
        )}
        {error && !loading && <Text style={styles.error}>{error}</Text>}
        {!loading && !error && (
          <FlatList
            data={messages}
            keyExtractor={(item) => item.id}
            renderItem={renderMessage}
            inverted
            onEndReached={loadOlder}
            onEndReachedThreshold={0.3}
            ListHeaderComponent={renderHeader}
            contentContainerStyle={styles.listContent}
          />
        )}
      </View>

      <View style={styles.infoBar}>
        <View style={styles.infoBarLeft}>
          <View style={styles.infoIconWrap}>
            <Ionicons name="lock-closed-outline" size={18} color={colors.textMuted} />
          </View>
          <View style={styles.infoTextBlock}>
            <Text style={styles.infoTitle}>24-hour window closed</Text>
            <Text style={styles.infoSubtitle}>
              You can only send template messages
            </Text>
          </View>
        </View>
        <TouchableOpacity style={styles.infoButton}>
          <Ionicons name="documents-outline" size={16} color="#fff" />
          <Text style={styles.infoButtonText}>Send Template</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.inputBar}>
        <TouchableOpacity style={styles.inputIconBtn}>
          <Ionicons name="add" size={24} color={colors.textMuted} />
        </TouchableOpacity>
        <View style={styles.inputBox}>
          <Text style={styles.inputPlaceholder}>
            Send a template message...
          </Text>
        </View>
        <TouchableOpacity style={styles.inputIconBtn}>
          <Ionicons name="mic-outline" size={22} color={colors.textMuted} />
        </TouchableOpacity>
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
    backgroundColor: colors.backgroundSecondary,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerSafe: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  backBtn: {
    marginRight: 8,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  avatarText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  headerTextBlock: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
  },
  headerSubtitle: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 12,
  },
  templatePill: {
    backgroundColor: '#FDE6E6',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginRight: 8,
  },
  templatePillText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#D93025',
  },
  moreBtn: {
    padding: 4,
  },
  chatArea: {
    flex: 1,
    backgroundColor: '#EFEAE2',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  error: {
    fontSize: 14,
    color: colors.error,
    padding: 16,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingBottom: 24,
  },
  bubbleWrap: {
    marginVertical: 4,
    alignItems: 'flex-start',
  },
  bubbleWrapOut: {
    alignItems: 'flex-end',
  },
  bubbleWrapIn: {
    alignItems: 'flex-start',
  },
  bubble: {
    maxWidth: '80%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  bubbleOut: {
    backgroundColor: colors.chatBubbleOut,
    borderBottomRightRadius: 4,
  },
  bubbleIn: {
    backgroundColor: colors.chatBubbleIn,
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  bubbleHighlight: {
    borderWidth: 2,
    borderColor: colors.primary,
  },
  mediaWrap: {
    width: 240,
    maxWidth: '100%',
    height: 200,
    borderRadius: 8,
    overflow: 'hidden',
    marginBottom: 4,
  },
  mediaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    width: 240,
  },
  mediaGridItem: {
    width: '48%',
    aspectRatio: 1,
    borderRadius: 8,
    overflow: 'hidden',
    marginBottom: 4,
  },
  mediaGridImage: {
    width: '100%',
    height: '100%',
  },
  mediaGridImagePlaceholder: {
    flex: 1,
    backgroundColor: '#2c2c2e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mediaGridPlayOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mediaGridMoreOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mediaGridMoreText: {
    fontSize: 22,
    fontWeight: '700',
    color: '#fff',
  },
  mediaImage: {
    width: '100%',
    height: '100%',
  },
  videoThumbnailPlaceholder: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#2c2c2e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoPlayOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bubbleMediaColumn: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    maxWidth: '100%',
  },
  bubbleText: {
    fontSize: 16,
    color: colors.text,
    flexShrink: 1,
    marginRight: 6,
  },
  bubbleTime: {
    fontSize: 11,
    color: colors.textMuted,
  },
  dateChipWrap: {
    alignSelf: 'center',
    backgroundColor: '#E1E4EA',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginVertical: 8,
  },
  dateChipText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  olderLoader: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  infoBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#FFF8E1',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  infoBarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 12,
  },
  infoIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#FDEBC8',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  infoTextBlock: {
    flex: 1,
  },
  infoTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  infoSubtitle: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
  },
  infoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  infoButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#fff',
    marginLeft: 4,
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.backgroundSecondary,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  inputIconBtn: {
    paddingHorizontal: 6,
  },
  inputBox: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginHorizontal: 8,
    justifyContent: 'center',
  },
  inputPlaceholder: {
    fontSize: 14,
    color: colors.textMuted,
  },
});
