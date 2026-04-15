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
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ResizeMode, Video } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  fetchConversationMessages,
  fetchConversationReaders,
  markConversationRead,
  searchConversations,
  sendMessage,
  sendReaction,
} from '../services';
import type { ConversationReader } from '../services';
import { MessageComposer } from '../components';
import type { Conversation, Message } from '../types';
import type { ChatAppStackParamList } from '../../../core/navigation/ChatAppStack';
import { colors } from '../../../theme/colors';
import { useChatStore } from '../chat.store';
import { joinConversationRoom, leaveConversationRoom } from '../../../services/socket';

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

/** Same semantics as MessageComposer — remaining time until template-only. */
function formatCountdown(ms: number): string {
  if (ms <= 0) return '0m';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
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

// Module-level stable reference so selectors that fallback to an empty array
// always return the SAME object, preventing Zustand snapshot infinite loops.
const EMPTY_MESSAGES: Message[] = [];

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
    windowExpiresAt,
    isDraft = false,
  } = route.params;

  // Self-chat ("You") always sends directly — never template-only.
  const templateOnly = isSelf ? false : templateOnlyParam;
  const conversationStarted = Boolean(windowExpiresAt);

  // Stable empty-array sentinel so the selector never returns a new reference when
  // the conversation key is missing — avoids Zustand snapshot infinite-loop error.
  const messagesFromStore = useChatStore((s) => s.messages[conversationId]);
  const messages = messagesFromStore ?? EMPTY_MESSAGES;
  const setMessagesInStore = useChatStore((s) => s.setMessages);
  const updateMessageStatus = useChatStore((s) => s.updateMessageStatus);
  const setActiveConversation = useChatStore((s) => s.setActiveConversation);
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
  const [replyTarget, setReplyTarget] = useState<Message | null>(null);
  const [forwardTarget, setForwardTarget] = useState<Message | null>(null);
  const [forwardQuery, setForwardQuery] = useState('');
  const [forwardSending, setForwardSending] = useState(false);
  const [forwardError, setForwardError] = useState<string | null>(null);
  const [remainingMs, setRemainingMs] = useState(() =>
    windowExpiresAt ? Math.max(0, windowExpiresAt - Date.now()) : 0
  );

  useEffect(() => {
    if (!windowExpiresAt) {
      setRemainingMs(0);
      return;
    }
    const tick = () => {
      setRemainingMs(Math.max(0, windowExpiresAt - Date.now()));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [windowExpiresAt]);

  // Must match MessageComposer so header badge and footer stay in sync.
  const canSendFreeText =
    isSelf ||
    (conversationStarted && !templateOnly && remainingMs > 0);
  const headerShowCountdown =
    !isSelf && conversationStarted && canSendFreeText && remainingMs > 0;
  const headerShowTemplateOnly = !isSelf && !canSendFreeText;

  const countdownAccent =
    remainingMs > 6 * 3600 * 1000
      ? { bg: '#E6F8ED', fg: '#128C7E' }
      : remainingMs > 2 * 3600 * 1000
        ? { bg: '#FFF4E5', fg: '#c2410c' }
        : { bg: '#FDE6E6', fg: '#D93025' };

  // Mark conversation as read when screen opens
  useEffect(() => {
    if (!conversationId || isDraft) return;
    setActiveConversation(conversationId);
    (async () => {
      try {
        await markConversationRead(conversationId);
      } catch {
        // non-blocking
      }
    })();
    return () => {
      setActiveConversation(null);
    };
  }, [conversationId, isDraft, setActiveConversation]);

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
        if (isDraft) {
          setMessagesInStore(conversationId, []);
          setNextCursor(null);
          setHasMore(false);
          return;
        }
        const result = await fetchConversationMessages(conversationId, area, 20);
        if (!cancelled) {
          // setMessages(result.messages);
          const apiMessages = result.messages ?? [];
          // Store messages newest-first so with inverted FlatList the latest appears at the bottom.
          const newestFirst = [...apiMessages].reverse();
          setMessagesInStore(conversationId, newestFirst);
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
  }, [conversationId, area, isDraft]);

  // Join conversation-specific room for typing/read events and scoped updates.
  useEffect(() => {
    if (!conversationId || isDraft) return;
    joinConversationRoom(conversationId);
    return () => {
      leaveConversationRoom(conversationId);
    };
  }, [conversationId, isDraft]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (isDraft) {
          setReaders([]);
          return;
        }
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
  }, [conversationId, isDraft]);

  const handleDraftMessageSent = useCallback(async () => {
    if (!isDraft || !participantPhone?.trim()) return;
    try {
      const results = await searchConversations(area, participantPhone);
      if (!results.length) return;
      const hit = results[0];
      navigation.replace('ConversationDetail', {
        conversationId: hit.id,
        area,
        conversationName: hit.name,
        participantPhone: hit.phone,
        templateOnly: false,
        isDraft: false,
      });
    } catch {
      // non-blocking
    }
  }, [isDraft, participantPhone, area, navigation]);

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
      const olderChunk = result.messages ?? [];
      const olderNewestFirst = [...olderChunk].reverse();
      // Read current messages from store at call-time to avoid stale closure and
      // to avoid adding `messages` to deps (which would recreate cb on every render).
      const current = useChatStore.getState().messages[conversationId] ?? [];
      setMessagesInStore(conversationId, [...current, ...olderNewestFirst]);
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

  const allConversations = useChatStore((s) => s.conversations) as Conversation[];
  const forwardCandidates = useMemo(() => {
    const q = forwardQuery.trim().toLowerCase();
    const list = (allConversations ?? []).filter((c) => c.id && c.id !== conversationId);
    if (!q) return list;
    return list.filter((c) => {
      const name = (c.name ?? '').toLowerCase();
      const phone = (c.phone ?? '').toLowerCase();
      return name.includes(q) || phone.includes(q);
    });
  }, [allConversations, forwardQuery, conversationId]);

  const replyPreview = useMemo(() => {
    if (!replyTarget) return null;
    const base = (replyTarget.displayText || replyTarget.content || '').trim();
    const oneLine = base.replace(/\s+/g, ' ');
    if (oneLine) return oneLine.slice(0, 140);
    if (replyTarget.type === 'image') return 'Image';
    if (replyTarget.type === 'video') return 'Video';
    if (replyTarget.type === 'audio') return 'Audio';
    return 'Message';
  }, [replyTarget]);

  const handleForwardTo = useCallback(
    async (target: Conversation) => {
      if (!forwardTarget) return;
      if (!target?.id) return;
      const raw =
        forwardTarget.type === 'text'
          ? (forwardTarget.content || forwardTarget.displayText || '').trim()
          : '';
      if (!raw) {
        setForwardError('Forwarding is currently supported for text messages only.');
        return;
      }
      setForwardError(null);
      setForwardSending(true);
      try {
        await sendMessage(target.id, target.phone ?? '', raw, 'text', area);
        setForwardTarget(null);
        setForwardQuery('');
      } catch (e) {
        setForwardError(e instanceof Error ? e.message : 'Failed to forward message');
      } finally {
        setForwardSending(false);
      }
    },
    [forwardTarget]
  );

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
      // Read current messages from store at call-time (not from closure) to avoid
      // adding `messages` to deps which would recreate this cb on every new message.
      const current = useChatStore.getState().messages[conversationId] ?? [];
      setMessagesInStore(conversationId, [optimistic, ...current]);
      return tempId;
    },
    [conversationId, setMessagesInStore]
  );

  // After API resolves, flip the temp bubble's status (sent → refresh; failed → keep bubble red)
  const handleOptimisticSetStatus = useCallback(
    (tempId: string, status: 'sent' | 'failed') => {
      updateMessageStatus(conversationId, tempId, status);
    },
    [conversationId, updateMessageStatus]
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
            {headerShowCountdown && (
              <View
                style={[
                  styles.templatePill,
                  { backgroundColor: countdownAccent.bg },
                ]}
              >
                <Text style={[styles.templatePillText, { color: countdownAccent.fg }]}>
                  {formatCountdown(remainingMs)}
                </Text>
              </View>
            )}
            {headerShowTemplateOnly && (
              <View style={styles.templatePill}>
                <Text style={styles.templatePillText}>Template only</Text>
              </View>
            )}
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
        area={area}
        replyTo={
          replyTarget && replyPreview
            ? { id: replyTarget.id, preview: replyPreview }
            : null
        }
        onCancelReply={() => setReplyTarget(null)}
        templateOnly={templateOnly}
        windowExpiresAt={isSelf ? undefined : windowExpiresAt}
        isSelf={isSelf}
        onOptimisticAdd={handleOptimisticAdd}
        onOptimisticSetStatus={handleOptimisticSetStatus}
        onMessageSent={() => {
          if (isDraft) {
            handleDraftMessageSent();
            return;
          }
          // After a successful send, refresh to replace the optimistic bubble
          // with the real one from the server (which has the real id + status).
          (async () => {
            try {
              const result = await fetchConversationMessages(conversationId, area, 20);
              const apiMessages = result.messages ?? [];
              const newestFirst = [...apiMessages].reverse();
              setMessagesInStore(conversationId, newestFirst);
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
                          const currentMsgs = useChatStore.getState().messages[conversationId] ?? [];
                          setMessagesInStore(
                            conversationId,
                            currentMsgs.map((m) => {
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

                <View style={styles.messageActionsRow}>
                  <TouchableOpacity
                    style={styles.messageActionBtn}
                    onPress={() => {
                      if (!reactionTarget) return;
                      setReplyTarget(reactionTarget);
                      setReactionTarget(null);
                    }}
                    disabled={reactionSending}
                  >
                    <Ionicons name="return-up-back-outline" size={18} color={colors.text} />
                    <Text style={styles.messageActionText}>Reply</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.messageActionBtn}
                    onPress={() => {
                      if (!reactionTarget) return;
                      setForwardTarget(reactionTarget);
                      setForwardError(null);
                      setForwardQuery('');
                      setReactionTarget(null);
                    }}
                    disabled={reactionSending}
                  >
                    <Ionicons name="arrow-redo-outline" size={18} color={colors.text} />
                    <Text style={styles.messageActionText}>Forward</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      <Modal
        visible={!!forwardTarget}
        transparent
        animationType="slide"
        onRequestClose={() => setForwardTarget(null)}
      >
        <TouchableWithoutFeedback onPress={() => setForwardTarget(null)}>
          <View style={styles.forwardOverlay}>
            <TouchableWithoutFeedback>
              <View style={styles.forwardSheet}>
                <View style={styles.forwardHeader}>
                  <Text style={styles.forwardTitle}>Forward to…</Text>
                  <TouchableOpacity
                    onPress={() => setForwardTarget(null)}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Ionicons name="close" size={22} color={colors.textMuted} />
                  </TouchableOpacity>
                </View>

                <View style={styles.forwardSearchWrapInput}>
                  <Ionicons name="search" size={16} color={colors.textMuted} />
                  <TextInput
                    value={forwardQuery}
                    onChangeText={setForwardQuery}
                    placeholder="Search chats"
                    placeholderTextColor={colors.textMuted}
                    style={styles.forwardSearchTextInput}
                    autoCorrect={false}
                  />
                </View>

                {forwardError && <Text style={styles.forwardError}>{forwardError}</Text>}

                <FlatList
                  data={forwardCandidates}
                  keyExtractor={(c) => c.id}
                  keyboardShouldPersistTaps="handled"
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={styles.forwardRow}
                      activeOpacity={0.8}
                      disabled={forwardSending}
                      onPress={() => handleForwardTo(item)}
                    >
                      <View style={styles.forwardAvatar}>
                        <Text style={styles.forwardAvatarText}>
                          {getInitials(item.name || item.phone || 'Chat')}
                        </Text>
                      </View>
                      <View style={styles.forwardRowText}>
                        <Text style={styles.forwardRowTitle} numberOfLines={1}>
                          {item.name || item.phone || 'Chat'}
                        </Text>
                        {!!item.phone && (
                          <Text style={styles.forwardRowSubtitle} numberOfLines={1}>
                            {item.phone}
                          </Text>
                        )}
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                    </TouchableOpacity>
                  )}
                  ListEmptyComponent={
                    <View style={styles.forwardEmpty}>
                      <Text style={styles.forwardEmptyText}>No chats found</Text>
                    </View>
                  }
                />

                {forwardSending && (
                  <View style={styles.forwardSendingRow}>
                    <ActivityIndicator size="small" color={colors.primary} />
                    <Text style={styles.forwardSendingText}>Forwarding…</Text>
                  </View>
                )}
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
  messageActionsRow: {
    marginTop: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  messageActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: colors.backgroundSecondary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    gap: 8,
  },
  messageActionText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  forwardOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  forwardSheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 14,
    maxHeight: '78%',
  },
  forwardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    paddingBottom: 10,
  },
  forwardTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
  },
  forwardSearchWrapInput: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    marginBottom: 10,
  },
  forwardSearchTextInput: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    paddingVertical: 0,
  },
  forwardError: {
    fontSize: 13,
    color: colors.error,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  forwardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: 10,
  },
  forwardAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.backgroundSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  forwardAvatarText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  forwardRowText: {
    flex: 1,
  },
  forwardRowTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  forwardRowSubtitle: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  forwardEmpty: {
    paddingVertical: 18,
    alignItems: 'center',
  },
  forwardEmptyText: {
    color: colors.textMuted,
    fontSize: 13,
  },
  forwardSendingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingTop: 10,
  },
  forwardSendingText: {
    fontSize: 13,
    color: colors.textMuted,
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
