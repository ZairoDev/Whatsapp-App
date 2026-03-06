import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ResizeMode, Video } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { fetchConversationMessages, fetchConversationReaders, markConversationRead, sendReaction } from '../services';
import type { ConversationReader } from '../services';
import { MessageComposer } from '../components';
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
    participantPhone,
    highlightMessageId,
    highlightTimestamp,
    isSelf = false,
    templateOnly: templateOnlyParam = false,
  } = route.params;

  // Self-chat ("You") always sends directly — never template-only.
  const templateOnly = isSelf ? false : templateOnlyParam;
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
  const [readers, setReaders] = useState<ConversationReader[]>([]);
  const [readersLoading, setReadersLoading] = useState(false);
  const [showReadersPopover, setShowReadersPopover] = useState(false);
  const [reactionTarget, setReactionTarget] = useState<Message | null>(null);
  const [reactionSending, setReactionSending] = useState(false);

  // Mark conversation as read when screen opens
  useEffect(() => {
    if (!conversationId) return;
    (async () => {
      try {
        await markConversationRead(conversationId);
      } catch {
        // non-blocking
      }
    })();
  }, [conversationId]);

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
          label: conversationName || 'Chat',
          timeLabel: formatTime(m.timestamp),
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setReadersLoading(true);
        const data = await fetchConversationReaders(conversationId);
        if (!cancelled) {
          setReaders(data);
        }
      } catch {
        if (!cancelled) {
          setReaders([]);
        }
      } finally {
        if (!cancelled) {
          setReadersLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

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
    if (item.type === 'reaction') {
      // Reaction messages are rendered as overlays via the original message; skip standalone bubble
      return null;
    }
    const isOut = item.direction === 'outgoing';
    const isHighlighted = highlightedMessageId != null && item.id === highlightedMessageId;
    // FlatList is inverted: index 0 = newest (bottom), higher index = older (top).
    // The date chip must sit above the oldest message of each day group, so we
    // compare against the OLDER neighbor (index + 1), not the newer one (index - 1).
    const olderNeighbor = index < messages.length - 1 ? messages[index + 1] : undefined;
    const olderDay = olderNeighbor ? new Date(olderNeighbor.timestamp).toDateString() : undefined;
    const currentDay = new Date(item.timestamp).toDateString();
    const showDateChip = !olderNeighbor || olderDay !== currentDay;

    // Compute status indicator for outgoing messages
    // failed → red alert-circle, sending → clock, sent → single tick,
    // delivered → double tick, read → double tick blue, unset → no icon
    type StatusIcon = { name: string; color: string; isAlert: boolean };
    let statusIcon: StatusIcon | null = null;
    if (isOut) {
      switch (item.status) {
        case 'failed':
          statusIcon = { name: 'alert-circle', color: '#FF3B30', isAlert: true };
          break;
        case 'sending':
          statusIcon = { name: 'time-outline', color: colors.textMuted, isAlert: false };
          break;
        case 'sent':
          statusIcon = { name: 'checkmark', color: colors.textMuted, isAlert: false };
          break;
        case 'delivered':
          statusIcon = { name: 'checkmark-done', color: colors.textMuted, isAlert: false };
          break;
        case 'read':
          statusIcon = { name: 'checkmark-done', color: '#34B7F1', isAlert: false };
          break;
        default:
          statusIcon = null;
      }
    }

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
        <TouchableOpacity
          activeOpacity={0.9}
          onLongPress={() => setReactionTarget(item)}
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
                  {mediaGroup.slice(0, Math.min(mediaGroup.length, 4)).map((m, idx) => {
                    const isVideo = m.type === 'video';
                    const mediaUri = m.thumbnailUrl || m.mediaUrl || '';
                    const isLastCell = idx === 3;
                    const hasMore = mediaGroup.length > 4;
                    const showMoreOverlay = isLastCell && hasMore;
                    const moreCount = hasMore ? mediaGroup.length - 3 : 0;
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
                        {showMoreOverlay && (
                          <View style={styles.mediaGridMoreOverlay} pointerEvents="none">
                            <Text style={styles.mediaGridMoreText}>+{moreCount}</Text>
                          </View>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <View style={styles.bubbleMetaRow}>
                  <Text style={styles.bubbleTime}>
                    {formatTime(mediaGroup[mediaGroup.length - 1].timestamp)}
                  </Text>
                  {statusIcon && (
                    <Ionicons
                      name={statusIcon.name as any}
                      size={statusIcon.isAlert ? 15 : 14}
                      color={statusIcon.color}
                      style={styles.bubbleStatusIcon}
                    />
                  )}
                </View>
              </View>
            ) : (item.type === 'image' || item.type === 'video') && (item.mediaUrl || item.thumbnailUrl) ? (
              <View style={styles.bubbleMediaColumn}>
                {/* Small label above the preview with name/number */}
                {!!conversationName && (
                  <Text style={styles.mediaTitleAbove} numberOfLines={1}>
                    {conversationName}
                  </Text>
                )}
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
                    {/* Time overlay on bottom-right of preview */}
                    <View style={styles.mediaTimestampOverlay}>
                      <Text style={styles.mediaTimestampText}>
                        {formatTime(item.timestamp)}
                      </Text>
                    </View>
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
                    <View style={styles.mediaTimestampOverlay}>
                      <Text style={styles.mediaTimestampText}>
                        {formatTime(item.timestamp)}
                      </Text>
                    </View>
                  </TouchableOpacity>
                )}
              </View>
            ) : (
              <>
                <Text style={styles.bubbleText}>{item.displayText || item.content}</Text>
                <View style={styles.bubbleMetaRow}>
                  <Text style={styles.bubbleTime}>{formatTime(item.timestamp)}</Text>
                  {statusIcon && (
                    <Ionicons
                      name={statusIcon.name as any}
                      size={statusIcon.isAlert ? 15 : 14}
                      color={statusIcon.color}
                      style={styles.bubbleStatusIcon}
                    />
                  )}
                </View>
              </>
            )}
          </View>
          {item.reactions && item.reactions.length > 0 && (
            <View
              style={[
                styles.reactionBar,
                isOut ? styles.reactionBarOut : styles.reactionBarIn,
              ]}
            >
              {item.reactions.map((r) => (
                <View key={r.emoji} style={styles.reactionChip}>
                  <Text style={styles.reactionChipText}>{r.emoji}</Text>
                  {r.count > 1 && (
                    <Text style={styles.reactionChipCount}>{r.count}</Text>
                  )}
                </View>
              ))}
            </View>
          )}
        </TouchableOpacity>
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

  // Optimistic message helpers ---------------------------------------------------
  // Add a bubble immediately with status='sending'. Returns a stable temp id.
  const handleOptimisticAdd = useCallback(
    (content: string): string => {
      const tempId = `temp-${Date.now()}-${Math.random()}`;
      const optimistic: Message = {
        id: tempId,
        conversationId,
        content,
        displayText: content,
        type: 'text',
        direction: 'outgoing',
        timestamp: Date.now(),
        status: 'sending',
      };
      // messages is newest-first; unshift puts it at the bottom of the inverted list
      setMessages((prev) => [optimistic, ...prev]);
      return tempId;
    },
    [conversationId]
  );

  // After API resolves, flip the temp bubble's status (sent → refresh; failed → keep bubble red)
  const handleOptimisticSetStatus = useCallback(
    (tempId: string, status: 'sent' | 'failed') => {
      setMessages((prev) =>
        prev.map((m) => (m.id === tempId ? { ...m, status } : m))
      );
    },
    []
  );
  // ------------------------------------------------------------------------------

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
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
            {readers.length > 0 && (
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={() => setShowReadersPopover(true)}
                style={styles.readersContainer}
              >
                <View style={styles.readersAvatarStack}>
                  {readers.slice(0, 3).map((r, idx) => {
                    const initials = getInitials(r.name);
                    return (
                      <View
                        key={r.userId ?? `${idx}`}
                        style={[
                          styles.readerAvatar,
                          idx > 0 && styles.readerAvatarOverlap,
                        ]}
                      >
                        {r.avatar ? (
                          <Image
                            source={{ uri: r.avatar }}
                            style={styles.readerAvatarImage}
                          />
                        ) : (
                          <Text style={styles.readerAvatarInitials}>
                            {initials}
                          </Text>
                        )}
                      </View>
                    );
                  })}
                </View>
                {readers.length > 3 && (
                  <Text style={styles.readersCountText}>
                    +{readers.length - 3}
                  </Text>
                )}
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.moreBtn}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Ionicons name="ellipsis-vertical" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>

      <Modal
        visible={showReadersPopover}
        transparent
        animationType="fade"
        onRequestClose={() => setShowReadersPopover(false)}
      >
        <TouchableWithoutFeedback onPress={() => setShowReadersPopover(false)}>
          <View style={styles.readersOverlay}>
            <TouchableWithoutFeedback>
              <View style={styles.readersPopover}>
                <Text style={styles.readersPopoverTitle}>Seen by:</Text>
                {readers.map((r) => {
                  const initials = getInitials(r.name);
                  return (
                    <View key={r.userId} style={styles.readersPopoverRow}>
                      <View style={styles.readersPopoverAvatar}>
                        {r.avatar ? (
                          <Image
                            source={{ uri: r.avatar }}
                            style={styles.readersPopoverAvatarImage}
                          />
                        ) : (
                          <Text style={styles.readersPopoverAvatarInitials}>
                            {initials}
                          </Text>
                        )}
                      </View>
                      <Text style={styles.readersPopoverItem} numberOfLines={1}>
                        {r.name || 'Unknown'}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

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

      <MessageComposer
        conversationId={conversationId}
        participantPhone={participantPhone}
        templateOnly={templateOnly}
        onOptimisticAdd={handleOptimisticAdd}
        onOptimisticSetStatus={handleOptimisticSetStatus}
        onMessageSent={() => {
          // After a successful send, refresh to replace the optimistic bubble
          // with the real one from the server (which has the real id + status).
          (async () => {
            try {
              const result = await fetchConversationMessages(conversationId, area, 20);
              const apiMessages = result.messages ?? [];
              const newestFirst = [...apiMessages].reverse();
              setMessages(newestFirst);
            } catch {
              // ignore; optimistic bubble stays
            }
          })();
        }}
      />

      <Modal
        visible={!!reactionTarget}
        transparent
        animationType="fade"
        onRequestClose={() => setReactionTarget(null)}
      >
        <TouchableWithoutFeedback onPress={() => setReactionTarget(null)}>
          <View style={styles.reactionOverlay}>
            <TouchableWithoutFeedback>
              <View style={styles.reactionSheet}>
                <Text style={styles.reactionTitle}>React to message</Text>
                <View style={styles.reactionRow}>
                  {['👍', '❤️', '😂', '😮', '😢', '🙏'].map((emoji) => (
                    <TouchableOpacity
                      key={emoji}
                      style={styles.reactionEmojiBtn}
                      disabled={reactionSending}
                      onPress={async () => {
                        if (!reactionTarget) return;
                        const targetKey =
                          reactionTarget.whatsappMessageId ?? reactionTarget.id;
                        const messageId = targetKey;
                        try {
                          setReactionSending(true);

                          // Optimistic local toggle: one reaction per user per message,
                          // tap again on same emoji removes it, tap different emoji switches.
                          setMessages((prev) =>
                            prev.map((m) => {
                              const key = m.whatsappMessageId ?? m.id;
                              if (key !== targetKey) return m;
                              const existing = m.reactions ?? [];
                              const next = [...existing];

                              // Find any existing self reaction
                              const selfIdx = next.findIndex((r) => r.fromSelf);
                              const selfEmoji =
                                selfIdx >= 0 ? next[selfIdx].emoji : undefined;

                              // Helper to decrement and maybe remove an entry
                              const decAt = (i: number) => {
                                const cur = next[i];
                                const newCount = (cur.count ?? 1) - 1;
                                if (newCount <= 0) {
                                  next.splice(i, 1);
                                } else {
                                  next[i] = { ...cur, count: newCount, fromSelf: false };
                                }
                              };

                              if (selfIdx >= 0) {
                                if (selfEmoji === emoji) {
                                  // Same emoji tapped again -> remove reaction
                                  decAt(selfIdx);
                                  return { ...m, reactions: next };
                                }
                                // Different emoji -> remove old self reaction first
                                decAt(selfIdx);
                              }

                              // Add / increment the new emoji for self
                              const idx = next.findIndex((r) => r.emoji === emoji);
                              if (idx >= 0) {
                                next[idx] = {
                                  ...next[idx],
                                  count: (next[idx].count ?? 0) + 1,
                                  fromSelf: true,
                                };
                              } else {
                                next.push({ emoji, count: 1, fromSelf: true });
                              }

                              return { ...m, reactions: next };
                            })
                          );

                          await sendReaction(conversationId, messageId, emoji);
                          setReactionTarget(null);
                        } catch {
                          // ignore for now; could show toast
                        } finally {
                          setReactionSending(false);
                        }
                      }}
                    >
                      <Text style={styles.reactionEmojiText}>{emoji}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  keyboardContainer: {
    flex: 1,
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
  readersContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 4,
  },
  readersAvatarStack: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  readerAvatar: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.backgroundSecondary,
  },
  readerAvatarOverlap: {
    marginLeft: -8,
  },
  readerAvatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 11,
  },
  readerAvatarInitials: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  readersCountText: {
    marginLeft: 4,
    fontSize: 11,
    color: colors.textSecondary,
  },
  readersOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
    paddingTop: 56,
    paddingRight: 12,
  },
  readersPopover: {
    minWidth: 140,
    maxWidth: 220,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: '#111',
  },
  readersPopoverTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 4,
  },
  readersPopoverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 2,
  },
  readersPopoverAvatar: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.backgroundSecondary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
  },
  readersPopoverAvatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 10,
  },
  readersPopoverAvatarInitials: {
    fontSize: 9,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  readersPopoverItem: {
    fontSize: 12,
    color: '#f5f5f5',
    flexShrink: 1,
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
    width: 260,
    maxWidth: '100%',
    height: 180,
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 2,
  },
  mediaTitleAbove: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 4,
    marginLeft: 4,
  },
  mediaTimestampOverlay: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  mediaTimestampText: {
    fontSize: 11,
    color: '#E9EDEF',
  },
  mediaOverlayTopLeft: {
    position: 'absolute',
    top: 8,
    left: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: 'rgba(0,0,0,0.65)',
    maxWidth: '80%',
  },
  mediaOverlayTitle: {
    fontSize: 11,
    fontWeight: '600',
    color: '#C8F36A',
  },
  mediaOverlayBottomRight: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  mediaOverlayTime: {
    fontSize: 10,
    fontWeight: '500',
    color: '#fff',
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
    borderRadius: 4,
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
  bubbleMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    marginTop: 2,
  },
  bubbleStatusIcon: {
    marginLeft: 4,
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
  reactionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  reactionBarOut: {
    alignSelf: 'flex-end',
    marginRight: 4,
  },
  reactionBarIn: {
    alignSelf: 'flex-start',
    marginLeft: 4,
  },
  reactionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF',
    borderRadius: 12,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginHorizontal: 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  reactionChipText: {
    fontSize: 13,
  },
  reactionChipCount: {
    fontSize: 11,
    color: colors.textMuted,
    marginLeft: 3,
  },
  reactionOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.25)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  reactionSheet: {
    backgroundColor: colors.background,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    minWidth: 220,
    alignItems: 'center',
  },
  reactionTitle: {
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: 8,
  },
  reactionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  reactionEmojiBtn: {
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  reactionEmojiText: {
    fontSize: 24,
  },
});
