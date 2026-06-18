import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
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
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Audio, ResizeMode, Video } from 'expo-av';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  fetchConversationMessages,
  fetchConversationReaders,
  forwardMessages,
  markConversationRead,
  searchConversations,
  sendMessage,
  sendReaction,
} from '../services';
import { useWhatsAppCall } from '../hooks/useWhatsAppCall';
import { CallOverlay } from '../components/CallOverlay';
import type { ConversationReader } from '../services';
import { MessageComposer } from '../components';
import type { Conversation, Message } from '../types';
import type { ChatAppStackParamList } from '../../../core/navigation/ChatAppStack';
import { useTheme } from '../../../theme/ThemeContext';
import type { AppColors } from '../../../theme/palettes';
import { useChatStore } from '../chat.store';
import { joinConversationRoom, leaveConversationRoom } from '../../../services/socket';
import { translateToEnglish } from '../../../services/translate';

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

function formatMmSs(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const ss = String(totalSec % 60).padStart(2, '0');
  return `${mm}:${ss}`;
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

  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => createDetailStyles(colors), [colors]);
  const ui = useMemo(
    () => ({
      bg: colors.chatWallpaper,
      headerBg: colors.backgroundSecondary,
      headerBorder: colors.border,
      text: colors.text,
      textMuted: colors.textMuted,
      inBubble: colors.chatBubbleIn,
      outBubble: colors.chatBubbleOut,
      bubbleMeta: colors.textMuted,
      dateChipBg: isDark ? 'rgba(17,27,33,0.85)' : 'rgba(225,228,234,0.92)',
      dateChipText: colors.textSecondary,
      reactionChipBg: isDark ? colors.surface : '#FFF',
      reactionChipBorder: colors.border,
    }),
    [colors, isDark],
  );

  // Self-chat ("You") always sends directly — never template-only.
  const templateOnly = isSelf ? false : templateOnlyParam;
  const conversationStarted = Boolean(windowExpiresAt);

  // Stable empty-array sentinel so the selector never returns a new reference when
  // the conversation key is missing — avoids Zustand snapshot infinite-loop error.
  const messagesFromStore = useChatStore((s) => s.messages[conversationId]);
  const messages = messagesFromStore ?? EMPTY_MESSAGES;
  const setMessagesInStore = useChatStore((s) => s.setMessages);

  // ---- audio playback (voice notes) ----
  const soundRef = useRef<Audio.Sound | null>(null);
  const audioTrackWidthsRef = useRef<Record<string, number>>({});
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null);
  const [audioStatus, setAudioStatus] = useState<{
    isPlaying: boolean;
    positionMillis: number;
    durationMillis: number;
  }>({ isPlaying: false, positionMillis: 0, durationMillis: 0 });

  const stopAudio = useCallback(async () => {
    try {
      const s = soundRef.current;
      if (s) {
        await s.stopAsync();
        await s.unloadAsync();
      }
    } catch {
      // ignore
    } finally {
      soundRef.current = null;
      setPlayingMessageId(null);
      setAudioStatus({ isPlaying: false, positionMillis: 0, durationMillis: 0 });
    }
  }, []);

  useEffect(() => {
    return () => {
      stopAudio().catch(() => {});
    };
  }, [stopAudio]);
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
  const [showHeaderMenu, setShowHeaderMenu] = useState(false);
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

  const [translatedByKey, setTranslatedByKey] = useState<Record<string, string>>({});
  const [translatingKeys, setTranslatingKeys] = useState<Set<string>>(new Set());
  const translatingKeysRef = useRef<Set<string>>(new Set());
  const [showTranslatedKeys, setShowTranslatedKeys] = useState<Set<string>>(new Set());

  const toggleTranslateForMessage = useCallback(
    async (message: Message) => {
      const messageKey = message.whatsappMessageId ?? message.id;
      const rawText = (message.displayText || message.content || '').trim();

      if (!messageKey || !rawText) return;
      if (message.type !== 'text' || message.direction !== 'incoming') return;

      // Toggle off if currently showing translated text
      if (showTranslatedKeys.has(messageKey)) {
        setShowTranslatedKeys((prev) => {
          const next = new Set(prev);
          next.delete(messageKey);
          return next;
        });
        return;
      }

      // Toggle on: if we already have a translation, just show it.
      const existingTranslation = translatedByKey[messageKey];
      if (existingTranslation) {
        setShowTranslatedKeys((prev) => new Set(prev).add(messageKey));
        return;
      }

      // Otherwise fetch translation, then show it.
      if (translatingKeysRef.current.has(messageKey)) return;
      translatingKeysRef.current.add(messageKey);
      setTranslatingKeys((prev) => new Set(prev).add(messageKey));
      try {
        const translated = await translateToEnglish(rawText);
        setTranslatedByKey((prev) => ({ ...prev, [messageKey]: translated }));
        setShowTranslatedKeys((prev) => new Set(prev).add(messageKey));
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        Alert.alert('Translate failed', msg);
      } finally {
        translatingKeysRef.current.delete(messageKey);
        setTranslatingKeys((prev) => {
          const next = new Set(prev);
          next.delete(messageKey);
          return next;
        });
      }
    },
    [showTranslatedKeys, translatedByKey]
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
      const results = await searchConversations(participantPhone);
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

  const toggleAudioPlayback = useCallback(
    async (messageId: string, uri: string) => {
      if (!uri) return;

      // Same message: toggle play/pause
      if (playingMessageId === messageId && soundRef.current) {
        try {
          const status = await soundRef.current.getStatusAsync();
          if ('isPlaying' in status && status.isPlaying) {
            await soundRef.current.pauseAsync();
            setAudioStatus((s) => ({ ...s, isPlaying: false }));
          } else {
            await soundRef.current.playAsync();
            setAudioStatus((s) => ({ ...s, isPlaying: true }));
          }
        } catch {
          await stopAudio();
        }
        return;
      }

      // Different message: stop previous and start new
      await stopAudio();
      try {
        await Audio.setAudioModeAsync({
          playsInSilentModeIOS: true,
          staysActiveInBackground: false,
          shouldDuckAndroid: true,
          playThroughEarpieceAndroid: false,
        });

        const safeUri = encodeURI(uri);
        const { sound } = await Audio.Sound.createAsync(
          { uri: safeUri },
          { shouldPlay: true },
          (status) => {
            if (!status || !('isLoaded' in status) || !status.isLoaded) return;
            setAudioStatus({
              isPlaying: Boolean(status.isPlaying),
              positionMillis: typeof status.positionMillis === 'number' ? status.positionMillis : 0,
              durationMillis: typeof status.durationMillis === 'number' ? status.durationMillis : 0,
            });
            if (status.didJustFinish) {
              // release resources when finished
              stopAudio().catch(() => {});
            }
          }
        );
        soundRef.current = sound;
        setPlayingMessageId(messageId);
      } catch {
        await stopAudio();
      }
    },
    [playingMessageId, stopAudio]
  );

  const seekAudio = useCallback(
    async (messageId: string, ratio: number) => {
      if (playingMessageId !== messageId) return;
      const s = soundRef.current;
      if (!s) return;
      const dur = audioStatus.durationMillis;
      if (!dur || dur <= 0) return;
      const clamped = Math.max(0, Math.min(1, ratio));
      try {
        await s.setPositionAsync(Math.floor(dur * clamped));
      } catch {
        // ignore
      }
    },
    [audioStatus.durationMillis, playingMessageId]
  );

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
    const messageKey = item.whatsappMessageId ?? item.id;
    const rawText = (item.displayText || item.content || '').trim();
    const translatedText = messageKey ? translatedByKey[messageKey] : undefined;
    const isTranslating = Boolean(messageKey && translatingKeys.has(messageKey));
    const canTranslate =
      item.type === 'text' &&
      item.direction === 'incoming' &&
      Boolean(rawText) &&
      Boolean(messageKey);
    const isShowingTranslated = Boolean(messageKey && showTranslatedKeys.has(messageKey));
    const displayText =
      isShowingTranslated && translatedText
        ? translatedText
        : rawText;
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
        <Pressable
          onLongPress={() => setReactionTarget(item)}
          delayLongPress={250}
          android_ripple={{ color: 'rgba(0,0,0,0.08)' }}
          style={({ pressed }) => [
            styles.bubbleWrap,
            isOut ? styles.bubbleWrapOut : styles.bubbleWrapIn,
            pressed && styles.bubbleWrapPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Message"
        >
          <View
            style={[
              styles.bubble,
              { backgroundColor: isOut ? ui.outBubble : ui.inBubble },
              !isOut && styles.bubbleInBorder,
              isOut ? styles.bubbleOutTail : styles.bubbleInTail,
              isHighlighted && styles.bubbleHighlight,
              item.isInternal && styles.bubbleInternal,
            ]}
          >
            {/* Forwarded badge */}
            {item.isForwarded && (
              <View style={styles.forwardedBadge}>
                <Ionicons name="arrow-redo-outline" size={12} color={ui.bubbleMeta} />
                <Text style={[styles.forwardedBadgeText, { color: ui.bubbleMeta }]}>Forwarded</Text>
              </View>
            )}
            {/* Internal note badge */}
            {item.isInternal && (
              <View style={styles.internalBadge}>
                <Ionicons name="lock-closed-outline" size={11} color="#92680A" />
                <Text style={styles.internalBadgeText}>Internal note</Text>
              </View>
            )}
            {/* Reply context (quoted message) */}
            {!!item.replyContext && (
              <View style={[styles.replyContextBox, isOut ? styles.replyContextBoxOut : styles.replyContextBoxIn]}>
                <View style={styles.replyContextAccent} />
                <View style={styles.replyContextBody}>
                  {item.replyContext.content?.text ? (
                    <Text style={[styles.replyContextText, { color: ui.textMuted }]} numberOfLines={2}>
                      {item.replyContext.content.text}
                    </Text>
                  ) : item.replyContext.content?.caption ? (
                    <Text style={[styles.replyContextText, { color: ui.textMuted }]} numberOfLines={2}>
                      {item.replyContext.content.caption}
                    </Text>
                  ) : (
                    <Text style={[styles.replyContextText, { color: ui.textMuted }]}>
                      {item.replyContext.type !== 'text' ? `📎 ${item.replyContext.type}` : 'Message'}
                    </Text>
                  )}
                </View>
              </View>
            )}
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
                  <Text style={[styles.bubbleTime, { color: ui.bubbleMeta }]}>
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
            ) : item.type === 'audio' && item.mediaUrl ? (
              (() => {
                const isPlaying = playingMessageId === item.id && audioStatus.isPlaying;
                const pct =
                  playingMessageId === item.id && audioStatus.durationMillis > 0
                    ? Math.min(1, Math.max(0, audioStatus.positionMillis / audioStatus.durationMillis))
                    : 0;
                const BAR_COUNT = 30;
                const activeBars = Math.round(BAR_COUNT * pct);
                const WAVE_HEIGHTS = [4,7,11,6,9,5,13,7,10,4,12,6,9,5,13,7,10,4,11,6,9,5,12,7,10,4,8,6,11,5];
                const activeColor = isOut ? 'rgba(255,255,255,0.95)' : '#53BDEB';
                const idleColor   = isOut ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.35)';
                const curTime = playingMessageId === item.id
                  ? formatMmSs(audioStatus.positionMillis)
                  : '0:00';
                return (
                  <View style={styles.audioMsgWrap}>
                    {/* Left: avatar/mic circle */}
                    {isOut ? (
                      <View style={[styles.audioCircle, { backgroundColor: 'rgba(0,0,0,0.20)' }]}>
                        <Ionicons name="mic" size={18} color="rgba(255,255,255,0.90)" />
                      </View>
                    ) : headerAvatarUri ? (
                      <Image source={{ uri: headerAvatarUri }} style={styles.audioCircle} />
                    ) : (
                      <View style={[styles.audioCircle, { backgroundColor: '#E9C46A' }]}>
                        <Ionicons name="person" size={18} color="#fff" />
                      </View>
                    )}

                    {/* Middle: play + waveform + meta */}
                    <View style={styles.audioBody}>

                      {/* Top row: play btn + waveform */}
                      <View style={styles.audioTopRow}>
                        <TouchableOpacity
                          activeOpacity={0.75}
                          style={[styles.audioPlayCircle, { backgroundColor: isOut ? 'rgba(0,0,0,0.22)' : 'rgba(255,255,255,0.22)' }]}
                          onPress={() => toggleAudioPlayback(item.id, item.mediaUrl || '')}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          accessibilityRole="button"
                          accessibilityLabel={isPlaying ? 'Pause voice message' : 'Play voice message'}
                        >
                          <Ionicons
                            name={isPlaying ? 'pause' : 'play'}
                            size={20}
                            color="#fff"
                            style={isPlaying ? undefined : { marginLeft: 2 }}
                          />
                        </TouchableOpacity>

                        {/* Waveform scrubber */}
                        <Pressable
                          style={styles.audioWaveWrap}
                          onLayout={(e) => { audioTrackWidthsRef.current[item.id] = e.nativeEvent.layout.width; }}
                          onPress={(e) => {
                            const w = audioTrackWidthsRef.current[item.id] ?? 1;
                            seekAudio(item.id, e.nativeEvent.locationX / Math.max(1, w));
                          }}
                          accessibilityRole="adjustable"
                          accessibilityLabel="Scrub voice message"
                        >
                          {WAVE_HEIGHTS.map((h, idx) => (
                            <View
                              key={idx}
                              style={[
                                styles.audioBar,
                                {
                                  height: h,
                                  backgroundColor: idx < activeBars ? activeColor : idleColor,
                                  borderRadius: 2,
                                },
                              ]}
                            />
                          ))}
                        </Pressable>
                      </View>

                      {/* Bottom row: elapsed time  |  timestamp + tick */}
                      <View style={styles.audioMetaRow}>
                        <Text style={[styles.audioElapsed, { color: ui.textMuted }]}>{curTime}</Text>
                        <View style={styles.audioMetaRight}>
                          <Text style={[styles.audioTs, { color: ui.bubbleMeta }]}>
                            {formatTime(item.timestamp)}
                          </Text>
                          {statusIcon && (
                            <Ionicons
                              name={statusIcon.name as any}
                              size={statusIcon.isAlert ? 14 : 13}
                              color={statusIcon.color}
                              style={{ marginLeft: 3 }}
                            />
                          )}
                        </View>
                      </View>

                    </View>
                  </View>
                );
              })()
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
            ) : item.type === 'document' ? (
              <View style={styles.documentBubble}>
                <View style={styles.documentIconWrap}>
                  <Ionicons name="document-attach-outline" size={28} color={isOut ? 'rgba(255,255,255,0.9)' : colors.primary} />
                </View>
                <View style={styles.documentInfo}>
                  <Text style={[styles.documentFilename, { color: ui.text }]} numberOfLines={2}>
                    {item.filename || item.displayText || 'Document'}
                  </Text>
                  {!!item.mediaUrl && (
                    <Text style={[styles.documentDownload, { color: isOut ? 'rgba(255,255,255,0.75)' : colors.primary }]}>
                      Tap to open
                    </Text>
                  )}
                </View>
                <View style={[styles.bubbleMetaRow, { position: 'relative', right: 0, bottom: 0, marginTop: 4 }]}>
                  <Text style={[styles.bubbleTime, { color: ui.bubbleMeta }]}>{formatTime(item.timestamp)}</Text>
                  {statusIcon && (
                    <Ionicons name={statusIcon.name as any} size={statusIcon.isAlert ? 15 : 14} color={statusIcon.color} style={styles.bubbleStatusIcon} />
                  )}
                </View>
              </View>
            ) : item.type === 'location' && item.location ? (
              <View style={styles.locationBubble}>
                <View style={styles.locationIconRow}>
                  <Ionicons name="location-outline" size={20} color={isOut ? 'rgba(255,255,255,0.9)' : colors.primary} />
                  <Text style={[styles.locationTitle, { color: ui.text }]}>
                    {item.location.name || 'Location'}
                  </Text>
                </View>
                {!!item.location.address && (
                  <Text style={[styles.locationAddress, { color: ui.textMuted }]} numberOfLines={2}>
                    {item.location.address}
                  </Text>
                )}
                <Text style={[styles.locationCoords, { color: ui.textMuted }]}>
                  {item.location.latitude.toFixed(5)}, {item.location.longitude.toFixed(5)}
                </Text>
                <View style={[styles.bubbleMetaRow, { position: 'relative', right: 0, bottom: 0, marginTop: 4 }]}>
                  <Text style={[styles.bubbleTime, { color: ui.bubbleMeta }]}>{formatTime(item.timestamp)}</Text>
                  {statusIcon && (
                    <Ionicons name={statusIcon.name as any} size={statusIcon.isAlert ? 15 : 14} color={statusIcon.color} style={styles.bubbleStatusIcon} />
                  )}
                </View>
              </View>
            ) : (
              <>
                <Text style={[styles.bubbleText, { color: ui.text }]}>{displayText}</Text>
                <View style={styles.bubbleMetaRow}>
                  <Text style={[styles.bubbleTime, { color: ui.bubbleMeta }]}>
                    {formatTime(item.timestamp)}
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
                <View
                  key={r.emoji}
                  style={[
                    styles.reactionChip,
                    { backgroundColor: ui.reactionChipBg, borderColor: ui.reactionChipBorder },
                  ]}
                >
                  <Text style={styles.reactionChipText}>{r.emoji}</Text>
                  {r.count > 1 && (
                    <Text style={styles.reactionChipCount}>{r.count}</Text>
                  )}
                </View>
              ))}
            </View>
          )}
        </Pressable>
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
  const conversationFromStore = useMemo(
    () => allConversations.find((c) => c.id === conversationId),
    [allConversations, conversationId]
  );
  const headerAvatarUri = useMemo(() => {
    const uri = conversationFromStore?.participantProfilePic ?? conversationFromStore?.avatar;
    return typeof uri === 'string' && uri.trim() ? uri.trim() : '';
  }, [conversationFromStore?.participantProfilePic, conversationFromStore?.avatar]);

  const headerTitle = useMemo(() => {
    const t = (conversationName ?? conversationFromStore?.name ?? '').toString().trim();
    return t || 'Chat';
  }, [conversationName, conversationFromStore?.name]);

  const headerPhoneDigits = useMemo(() => {
    const raw =
      participantPhone ??
      conversationFromStore?.phone ??
      (headerTitle && /^\+?\d[\d\s-]+$/.test(headerTitle) ? headerTitle : '');
    const digits = (raw ?? '').replace(/[^\d]/g, '').trim();
    return digits ? `+${digits}` : '';
  }, [participantPhone, conversationFromStore?.phone, headerTitle]);

  const headerSubtitle = useMemo(() => {
    // If we have a real name, show the phone below it. If title is already the phone, no subtitle.
    const titleLooksLikePhone = /^\+?\d[\d\s-]+$/.test(headerTitle);
    if (titleLooksLikePhone) return '';
    return headerPhoneDigits;
  }, [headerTitle, headerPhoneDigits]);
  const participantWaId = useMemo(() => {
    const fromRoute = participantPhone?.replace(/[^\d]/g, '').trim();
    if (fromRoute) return fromRoute;
    const conv = allConversations.find((c) => c.id === conversationId);
    return conv?.phone?.replace(/[^\d]/g, '').trim() ?? '';
  }, [participantPhone, allConversations, conversationId]);
  const canInitiateCall = !isSelf && !isDraft && Boolean(participantWaId);

  const {
    phase: callPhase,
    error: callError,
    inCall,
    startCall,
    endCall,
  } = useWhatsAppCall({
    area,
    conversationId,
    participantWaId,
    conversationName,
    enabled: canInitiateCall,
  });

  const callBusy = callPhase !== 'idle' && callPhase !== 'error';

  const handleCallPress = useCallback(async () => {
    if (!canInitiateCall || callBusy) return;
    try {
      await startCall();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to start call';
      Alert.alert('Call failed', msg);
    }
  }, [canInitiateCall, callBusy, startCall]);
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

  const reactionCopyText = useMemo(() => {
    if (!reactionTarget) return '';
    return (reactionTarget.displayText || reactionTarget.content || '').trim();
  }, [reactionTarget]);

  const handleForwardTo = useCallback(
    async (target: Conversation) => {
      if (!forwardTarget) return;
      if (!target?.id) return;
      // Use the Mongo _id to forward via the /whatsapp/forward-message API.
      // This correctly forwards text AND media (image/video/document/audio) messages.
      const mongoId = forwardTarget.id;
      if (!mongoId || !/^[a-fA-F0-9]{24}$/.test(mongoId)) {
        setForwardError('Cannot forward this message (no server ID).');
        return;
      }
      setForwardError(null);
      setForwardSending(true);
      try {
        const result = await forwardMessages([mongoId], [target.id]);
        if (result.errors?.length && !result.results.length) {
          setForwardError(result.errors[0]?.error ?? 'Failed to forward message');
          return;
        }
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
    (content: string, type?: Message['type'], mediaUrl?: string): string => {
      const tempId = `temp-${Date.now()}-${Math.random()}`;
      const optimistic: Message = {
        id: tempId,
        conversationId,
        content,
        displayText: content,
        type: type ?? 'text',
        direction: 'outgoing',
        timestamp: Date.now(),
        status: 'sending',
        ...(mediaUrl ? { mediaUrl } : {}),
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
      style={[styles.container, { backgroundColor: ui.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      <View
        style={[
          styles.header,
          { backgroundColor: ui.headerBg, borderBottomColor: ui.headerBorder },
        ]}
      >
        <SafeAreaView
          edges={['top']}
          style={[styles.headerSafe, { paddingTop: Math.max(6, insets.top ? 4 : 6) }]}
        >
          <View style={styles.headerLeft}>
            <Pressable
              onPress={() => navigation.goBack()}
              style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}
              android_ripple={{ color: 'rgba(255,255,255,0.10)' }}
              accessibilityRole="button"
              accessibilityLabel="Back"
            >
              <Ionicons name="chevron-back" size={24} color={ui.text} />
            </Pressable>
            <View style={styles.avatar}>
              {headerAvatarUri ? (
                <Image source={{ uri: headerAvatarUri }} style={styles.avatarImage} />
              ) : (
                <Text style={[styles.avatarText, { color: ui.textMuted }]}>
                  {getInitials(headerTitle)}
                </Text>
              )}
            </View>
            <View style={styles.headerTextBlock}>
              <Text style={[styles.headerTitle, { color: ui.text }]} numberOfLines={1}>
                {headerTitle}
              </Text>
              {!!headerSubtitle && (
                <Text style={[styles.headerSubtitle, { color: ui.textMuted }]} numberOfLines={1}>
                  {headerSubtitle}
                </Text>
              )}
            </View>
          </View>
          <View style={styles.headerRight}>
            {headerShowTemplateOnly && (
              <View style={styles.templatePill}>
                <Text style={styles.templatePillText}>Template only</Text>
              </View>
            )}
            {canInitiateCall && (
              <Pressable
                onPress={handleCallPress}
                disabled={callBusy}
                style={({ pressed }) => [
                  styles.iconBtn,
                  (pressed || callBusy) && styles.iconBtnPressed,
                ]}
                android_ripple={{ color: 'rgba(255,255,255,0.10)' }}
                accessibilityRole="button"
                accessibilityLabel="Call"
              >
                {callBusy && !inCall ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Ionicons name="call-outline" size={22} color={ui.text} />
                )}
              </Pressable>
            )}
            <Pressable
              onPress={() => setShowHeaderMenu(true)}
              style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}
              android_ripple={{ color: 'rgba(255,255,255,0.10)' }}
              accessibilityRole="button"
              accessibilityLabel="More options"
            >
              <Ionicons name="ellipsis-vertical" size={20} color={ui.textMuted} />
            </Pressable>
          </View>
        </SafeAreaView>
      </View>

      <Modal
        visible={showHeaderMenu}
        transparent
        animationType="fade"
        onRequestClose={() => setShowHeaderMenu(false)}
      >
        <TouchableWithoutFeedback onPress={() => setShowHeaderMenu(false)}>
          <View style={styles.readersOverlay}>
            <TouchableWithoutFeedback>
              <View style={styles.readersPopover}>
                {!!(readers?.length > 0) && (
                  <TouchableOpacity
                    activeOpacity={0.8}
                    onPress={() => {
                      setShowHeaderMenu(false);
                      setShowReadersPopover(true);
                    }}
                    style={styles.menuRow}
                    accessibilityRole="button"
                    accessibilityLabel="Seen by"
                  >
                    <Text style={styles.menuRowText}>Seen by</Text>
                    <Text style={styles.menuRowMeta}>{readers.length}</Text>
                  </TouchableOpacity>
                )}
                {!!headerPhoneDigits && (
                  <TouchableOpacity
                    activeOpacity={0.8}
                    onPress={async () => {
                      try {
                        await Clipboard.setStringAsync(headerPhoneDigits);
                      } finally {
                        setShowHeaderMenu(false);
                      }
                    }}
                    style={styles.menuRow}
                    accessibilityRole="button"
                    accessibilityLabel="Copy phone"
                  >
                    <Text style={styles.menuRowText}>Copy phone</Text>
                  </TouchableOpacity>
                )}
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

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

      <View style={[styles.chatArea, { backgroundColor: ui.bg }]}>
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
            keyboardShouldPersistTaps="handled"
            removeClippedSubviews={Platform.OS === 'android'}
            initialNumToRender={14}
            maxToRenderPerBatch={14}
            windowSize={10}
          />
        )}
      </View>

      <MessageComposer
        conversationId={conversationId}
        participantPhone={participantPhone}
        area={area}
        businessPhoneId={conversationFromStore?.businessPhoneId}
        replyTo={
          replyTarget && replyPreview
            ? {
                id: replyTarget.id,
                // Pass wamid so backend can create a native WhatsApp threaded reply
                whatsappMessageId: replyTarget.whatsappMessageId,
                preview: replyPreview,
              }
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
                    onPress={async () => {
                      if (!reactionCopyText) return;
                      try {
                        await Clipboard.setStringAsync(reactionCopyText);
                      } finally {
                        setReactionTarget(null);
                      }
                    }}
                    disabled={reactionSending || !reactionCopyText}
                  >
                    <Ionicons name="copy-outline" size={18} color={colors.text} />
                    <Text style={styles.messageActionText}>Copy</Text>
                  </TouchableOpacity>

                  {reactionTarget &&
                    reactionTarget.type === 'text' &&
                    reactionTarget.direction === 'incoming' &&
                    Boolean((reactionTarget.displayText || reactionTarget.content || '').trim()) && (
                      <TouchableOpacity
                        style={styles.messageActionBtn}
                        onPress={async () => {
                          if (!reactionTarget) return;
                          try {
                            await toggleTranslateForMessage(reactionTarget);
                          } finally {
                            setReactionTarget(null);
                          }
                        }}
                        disabled={
                          reactionSending ||
                          Boolean(
                            (reactionTarget.whatsappMessageId ?? reactionTarget.id) &&
                              translatingKeys.has(reactionTarget.whatsappMessageId ?? reactionTarget.id)
                          )
                        }
                      >
                        <Ionicons name="language-outline" size={18} color={colors.text} />
                        <Text style={styles.messageActionText}>
                          {(() => {
                            const k = reactionTarget.whatsappMessageId ?? reactionTarget.id;
                            const isShowing = k ? showTranslatedKeys.has(k) : false;
                            const isBusy = k ? translatingKeys.has(k) : false;
                            if (isBusy) return 'Translating…';
                            return isShowing ? 'See original' : 'Translate';
                          })()}
                        </Text>
                      </TouchableOpacity>
                    )}

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

      <CallOverlay
        visible={inCall}
        phase={callPhase}
        contactName={conversationName}
        error={callError}
        onEndCall={() => {
          void endCall();
        }}
      />

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

function createDetailStyles(colors: AppColors) {
  return StyleSheet.create({
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
    minHeight: 56,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 4,
  },
  iconBtnPressed: {
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    overflow: 'hidden',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 18,
    resizeMode: 'cover',
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
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: 8,
  },
  menuRowText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
  },
  menuRowMeta: {
    fontSize: 12,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.72)',
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
  bubbleWrapPressed: {
    opacity: 0.92,
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
    paddingHorizontal: 12,
    paddingVertical: 10,
    paddingBottom: 18,
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
    paddingHorizontal: 10,
    paddingTop: 7,
    paddingBottom: 18,
    borderRadius: 18,
    flexDirection: 'column',
  },
  bubbleOutTail: {
    borderBottomRightRadius: 4,
  },
  bubbleInTail: {
    borderBottomLeftRadius: 4,
  },
  bubbleInBorder: {
    borderWidth: StyleSheet.hairlineWidth,
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
  /* ── Audio / Voice-note bubble ── */
  audioMsgWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 2,
    minWidth: 230,
    maxWidth: 280,
  },
  audioCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    flexShrink: 0,
  },
  audioBody: {
    flex: 1,
    gap: 4,
  },
  audioTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  audioPlayCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  audioWaveWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 28,
  },
  audioBar: {
    width: 3,
    borderRadius: 2,
  },
  audioMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 46, // align under waveform (past play btn)
  },
  audioElapsed: {
    fontSize: 12,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  audioMetaRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  audioTs: {
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
  bubbleText: {
    fontSize: 16,
    color: colors.text,
    flexShrink: 1,
    paddingRight: 52,
  },
  bubbleTime: {
    fontSize: 11,
    color: colors.textMuted,
  },
  bubbleMetaRow: {
    position: 'absolute',
    right: 8,
    bottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
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
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 10,
  },
  messageActionBtn: {
    flexGrow: 1,
    minWidth: '48%',
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
  // ── Reply context (quoted message) ──
  replyContextBox: {
    flexDirection: 'row',
    borderRadius: 6,
    marginBottom: 6,
    overflow: 'hidden',
  },
  replyContextBoxOut: {
    backgroundColor: 'rgba(0,0,0,0.12)',
  },
  replyContextBoxIn: {
    backgroundColor: 'rgba(0,0,0,0.07)',
  },
  replyContextAccent: {
    width: 3,
    backgroundColor: '#25D366',
  },
  replyContextBody: {
    flex: 1,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  replyContextText: {
    fontSize: 12,
    lineHeight: 16,
  },
  // ── Forwarded badge ──
  forwardedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 4,
  },
  forwardedBadgeText: {
    fontSize: 11,
    fontStyle: 'italic',
  },
  // ── Internal note ──
  bubbleInternal: {
    backgroundColor: '#FFF9C4',
    borderWidth: 1,
    borderColor: '#F0C040',
  },
  internalBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 4,
  },
  internalBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#92680A',
  },
  // ── Document bubble ──
  documentBubble: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 4,
    minWidth: 200,
    maxWidth: 280,
  },
  documentIconWrap: {
    marginRight: 10,
    paddingTop: 2,
  },
  documentInfo: {
    flex: 1,
  },
  documentFilename: {
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 18,
  },
  documentDownload: {
    fontSize: 12,
    marginTop: 2,
  },
  // ── Location bubble ──
  locationBubble: {
    padding: 4,
    minWidth: 180,
    maxWidth: 260,
  },
  locationIconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  locationTitle: {
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  locationAddress: {
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 2,
  },
  locationCoords: {
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
  });
}
