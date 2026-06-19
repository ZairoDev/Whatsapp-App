import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Animated,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import {
  ensurePhoneId,
  fetchWhatsAppTemplates,
  getTemplatePreview,
  getTemplateVariables,
  sendMessage,
  sendTemplate,
  sendMediaMessage,
  uploadWhatsAppMedia,
  uploadToBunny,
} from '../services';
import type { WhatsAppTemplate } from '../services';
import { useTheme } from '../../../theme/ThemeContext';
import type { AppColors } from '../../../theme/palettes';
import { EmojiKeyboard } from './EmojiKeyboard';
import { TemplatePickerSheet } from './TemplatePickerSheet';
import {
  getComposerBottomPadding,
  getDefaultAccessoryHeight,
  getKeyboardLayoutInset,
} from '../utils/accessoryHeight';

/** Format milliseconds remaining into "Xh Ym" or "Ym Zs" */
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

interface MessageComposerProps {
  conversationId?: string;
  /** Participant phone (E.164) for sending templates - required when templateOnly */
  participantPhone?: string;
  /** Current area (athens/thessaloniki) so backend sends from correct number */
  area?: string;
  /** Frozen business line for this thread — used for channel-scoped template fetch */
  businessPhoneId?: string;
  /**
   * Optional reply target. `whatsappMessageId` is the wamid sent to the backend
   * for native WhatsApp threaded replies; `preview` is shown in the UI bar.
   */
  replyTo?: {
    id: string;
    /** wamid of the message being replied to — passed to send-message API */
    whatsappMessageId?: string;
    preview: string;
  } | null;
  onCancelReply?: () => void;
  /** When false: normal WhatsApp input. When true: template-only (24h window closed) */
  templateOnly?: boolean;
  /**
   * Unix ms timestamp when the 24-hour messaging window closes.
   * Derived from last customer message + 24h. Absent = conversation not started yet.
   */
  windowExpiresAt?: number;
  /** Self / "You" chat — always free-text, no window bar */
  isSelf?: boolean;
  onMessageSent?: () => void;
  /**
   * Called immediately when user hits send so the parent can show an optimistic
   * bubble with status='sending'. Returns a temp id the parent assigned.
   * Optional type + mediaUrl let the caller pre-fill media bubbles (e.g. voice notes).
   */
  onOptimisticAdd?: (content: string, type?: import('../types').Message['type'], mediaUrl?: string) => string;
  /**
   * Called once the API resolves. Pass status='failed' on error so the parent
   * can update the bubble's icon. On success, the parent re-fetches.
   */
  onOptimisticSetStatus?: (tempId: string, status: 'sent' | 'failed') => void;
  /** Last measured system keyboard height — used to size the emoji panel identically. */
  lastKeyboardHeight?: number;
  /** Last system keyboard animation duration in ms (iOS). */
  lastKeyboardDuration?: number;
  /** Notifies parent when emoji panel is in the layout (not for keyboard padding). */
  onEmojiPickerOpenChange?: (open: boolean) => void;
}

export function MessageComposer({
  conversationId,
  participantPhone,
  area,
  businessPhoneId,
  replyTo = null,
  onCancelReply,
  templateOnly = false,
  windowExpiresAt,
  isSelf = false,
  onMessageSent,
  onOptimisticAdd,
  onOptimisticSetStatus,
  lastKeyboardHeight = 0,
  lastKeyboardDuration = 250,
  onEmojiPickerOpenChange,
}: MessageComposerProps) {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => createComposerStyles(colors, isDark), [colors, isDark]);
  const insets = useSafeAreaInsets();
  const textInputRef = useRef<TextInput>(null);
  const pendingEmojiOpenRef = useRef(false);
  const emojiPanelAnim = useRef(new Animated.Value(0)).current;
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [emojiPanelHeight, setEmojiPanelHeight] = useState(0);
  const [text, setText] = useState('');
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [recordingMs, setRecordingMs] = useState(0);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [pendingVoiceUri, setPendingVoiceUri] = useState<string | null>(null);
  const [pendingVoiceMs, setPendingVoiceMs] = useState(0);
  const [voiceBusy, setVoiceBusy] = useState(false);

  // Live countdown whenever we know window end (conversation has started).
  const [remainingMs, setRemainingMs] = useState<number>(() =>
    windowExpiresAt ? Math.max(0, windowExpiresAt - Date.now()) : 0
  );
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const resolveEmojiPanelHeight = useCallback(() => {
    const rawHeight = lastKeyboardHeight > 0 ? lastKeyboardHeight : getDefaultAccessoryHeight();
    return getKeyboardLayoutInset(rawHeight, insets.bottom);
  }, [lastKeyboardHeight, insets.bottom]);

  const animateEmojiPanel = useCallback(
    (toValue: number, duration = lastKeyboardDuration, onEnd?: () => void) => {
      emojiPanelAnim.stopAnimation();
      Animated.timing(emojiPanelAnim, {
        toValue,
        duration: Math.max(120, duration),
        useNativeDriver: false,
      }).start(({ finished }) => {
        if (finished) onEnd?.();
      });
    },
    [emojiPanelAnim, lastKeyboardDuration],
  );

  const revealEmojiPicker = useCallback(
    (animated = true) => {
      const targetHeight = resolveEmojiPanelHeight();
      setEmojiPanelHeight(targetHeight);
      setShowEmojiPicker(true);
      onEmojiPickerOpenChange?.(true);
      if (animated) {
        emojiPanelAnim.setValue(0);
        animateEmojiPanel(targetHeight);
      } else {
        emojiPanelAnim.setValue(targetHeight);
      }
    },
    [animateEmojiPanel, emojiPanelAnim, onEmojiPickerOpenChange, resolveEmojiPanelHeight],
  );

  const closeEmojiPicker = useCallback(() => {
    pendingEmojiOpenRef.current = false;
    onEmojiPickerOpenChange?.(false);
    animateEmojiPanel(0, lastKeyboardDuration, () => {
      setShowEmojiPicker(false);
      setEmojiPanelHeight(0);
    });
  }, [animateEmojiPanel, lastKeyboardDuration, onEmojiPickerOpenChange]);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, () => {
      setKeyboardVisible(true);
      if (showEmojiPicker) {
        closeEmojiPicker();
      }
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardVisible(false);
      if (pendingEmojiOpenRef.current) {
        pendingEmojiOpenRef.current = false;
        revealEmojiPicker(false);
      }
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [closeEmojiPicker, revealEmojiPicker, showEmojiPicker]);

  const openEmojiPicker = useCallback(() => {
    if (keyboardVisible) {
      pendingEmojiOpenRef.current = true;
      Keyboard.dismiss();
      return;
    }
    revealEmojiPicker();
  }, [keyboardVisible, revealEmojiPicker]);

  const toggleEmojiPicker = useCallback(() => {
    if (showEmojiPicker) {
      closeEmojiPicker();
      textInputRef.current?.focus();
      return;
    }
    openEmojiPicker();
  }, [showEmojiPicker, closeEmojiPicker, openEmojiPicker]);

  const handleEmojiSelected = useCallback((emoji: string) => {
    setText((prev) => {
      if (prev.length >= 4096) return prev;
      return prev + emoji;
    });
  }, []);

  const handleShowKeyboardFromEmoji = useCallback(() => {
    closeEmojiPicker();
    requestAnimationFrame(() => {
      textInputRef.current?.focus();
    });
  }, [closeEmojiPicker]);

  useEffect(() => {
    return () => {
      onEmojiPickerOpenChange?.(false);
    };
  }, [onEmojiPickerOpenChange]);

  useEffect(() => {
    if (!showEmojiPicker) return;
    const targetHeight = resolveEmojiPanelHeight();
    if (targetHeight !== emojiPanelHeight) {
      setEmojiPanelHeight(targetHeight);
      animateEmojiPanel(targetHeight, 0);
    }
  }, [animateEmojiPanel, emojiPanelHeight, resolveEmojiPanelHeight, showEmojiPicker]);

  useEffect(() => {
    if (!windowExpiresAt) {
      setRemainingMs(0);
      return;
    }
    const tick = () => {
      setRemainingMs(Math.max(0, windowExpiresAt - Date.now()));
    };
    tick();
    timerRef.current = setInterval(tick, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [windowExpiresAt]);
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<WhatsAppTemplate | null>(null);
  const [templateFieldValues, setTemplateFieldValues] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const stopRecordingTimer = () => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      stopRecordingTimer();
      if (recording) {
        recording.stopAndUnloadAsync().catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openTemplateModal = useCallback(async () => {
    setShowTemplateModal(true);
    setSelectedTemplate(null);
    setTemplateFieldValues([]);
    setSendError(null);
    setTemplatesError(null);
    setTemplatesLoading(true);
    try {
      const isRealConversationId = (id?: string) => Boolean(id && /^[a-fA-F0-9]{24}$/.test(id));
      let phoneNumberId = businessPhoneId?.trim() || undefined;
      if (!isRealConversationId(conversationId) && !phoneNumberId && area) {
        phoneNumberId = await ensurePhoneId(area);
      }
      const result = await fetchWhatsAppTemplates({
        ...(isRealConversationId(conversationId) ? { conversationId } : {}),
        ...(phoneNumberId ? { phoneNumberId } : {}),
      });
      setTemplates(result.templates);
      if (result.warning && result.templates.length === 0) {
        setTemplatesError(result.warning);
      } else if (result.metaUnavailable && result.templates.length === 0) {
        setTemplatesError(
          result.warning ??
            'Templates are unavailable for this line. Check WhatsApp Channels admin for a valid access token.',
        );
      }
    } catch (e) {
      setTemplatesError(e instanceof Error ? e.message : 'Failed to load templates');
      setTemplates([]);
    } finally {
      setTemplatesLoading(false);
    }
  }, [conversationId, businessPhoneId, area]);

  const onSelectTemplate = useCallback((template: WhatsAppTemplate) => {
    setSelectedTemplate(template);
    const vars = getTemplateVariables(template);
    setTemplateFieldValues(vars.map(() => ''));
    setSendError(null);
  }, []);

  const goBackToTemplateList = useCallback(() => {
    setSelectedTemplate(null);
    setTemplateFieldValues([]);
    setSendError(null);
  }, []);

  const handleSendTemplate = useCallback(async () => {
    if (!selectedTemplate) return;
    // For new/draft chats we may not have a conversationId yet. Backend can start the chat from `to`.
    if (!conversationId && !participantPhone?.trim()) return;
    const isRealConversationId = (id?: string) => Boolean(id && /^[a-fA-F0-9]{24}$/.test(id));
    // Backend resolves recipient from conversationId when `to` is not sent
    const vars = getTemplateVariables(selectedTemplate);
    const hasEmpty = vars.some((_, i) => !(templateFieldValues[i]?.trim()));
    if (hasEmpty) {
      setSendError('Please fill in all fields');
      return;
    }
    setSending(true);
    setSendError(null);
    // Optimistic bubble so templates appear instantly in the thread (especially for drafts).
    let optimisticId: string | undefined;
    try {
      const preview = getTemplatePreview(selectedTemplate, templateFieldValues);
      const templateText = [preview.header, preview.body, preview.footer].filter(Boolean).join('\n');
      if (templateText.trim()) {
        optimisticId = onOptimisticAdd?.(templateText.trim());
      } else {
        optimisticId = onOptimisticAdd?.(`[Template] ${selectedTemplate.name}`);
      }
      await sendTemplate({
        ...(participantPhone?.trim() && { to: participantPhone }),
        ...(area ? { area } : {}),
        template: selectedTemplate,
        parameters: templateFieldValues.map((v) => v.trim()),
        ...(isRealConversationId(conversationId) ? { conversationId } : {}),
        templateText,
      });
      if (optimisticId) onOptimisticSetStatus?.(optimisticId, 'sent');
      setShowTemplateModal(false);
      setSelectedTemplate(null);
      setTemplateFieldValues([]);
      onMessageSent?.();
    } catch (e) {
      if (optimisticId) onOptimisticSetStatus?.(optimisticId, 'failed');
      setSendError(e instanceof Error ? e.message : 'Failed to send template');
    } finally {
      setSending(false);
    }
  }, [
    selectedTemplate,
    conversationId,
    participantPhone,
    area,
    templateFieldValues,
    onMessageSent,
    onOptimisticAdd,
    onOptimisticSetStatus,
  ]);

  const handleSendText = useCallback(async () => {
    const content = text.trim();
    if (!content || !conversationId) return;
    const to = participantPhone ?? '';

    // Optimistically insert the bubble immediately (show clean content, no prefix)
    const tempId = onOptimisticAdd?.(content);
    setText('');

    try {
      // Pass wamid to backend for native WhatsApp threaded replies
      await sendMessage(conversationId, to, content, 'text', replyTo?.whatsappMessageId);
      if (tempId) onOptimisticSetStatus?.(tempId, 'sent');
      onMessageSent?.();
      onCancelReply?.();
    } catch {
      // Show the message as failed instead of silently restoring text
      if (tempId) {
        onOptimisticSetStatus?.(tempId, 'failed');
      } else {
        setText(content); // fallback: restore if parent doesn't support optimistic
      }
      Alert.alert('Send failed', 'Could not send message. Check channel credentials in WhatsApp Channels admin.');
    }
  }, [text, conversationId, participantPhone, onMessageSent, onOptimisticAdd, onOptimisticSetStatus, replyTo, onCancelReply]);

  const variables = selectedTemplate ? getTemplateVariables(selectedTemplate) : [];
  const preview = selectedTemplate
    ? getTemplatePreview(selectedTemplate, templateFieldValues)
    : null;

  const conversationStarted = Boolean(windowExpiresAt);
  // Free text allowed: self-chat, or customer has messaged and 24h window still open.
  const canSendFreeText =
    isSelf ||
    (conversationStarted && !templateOnly && remainingMs > 0);
  // Template-only input: no customer thread yet, or window closed (backend or client countdown).
  const composerTemplateMode = !isSelf && !canSendFreeText;

  const showTemplateInfoBar = !isSelf && composerTemplateMode;
  const showCountdownInfoBar =
    !isSelf && conversationStarted && canSendFreeText && remainingMs > 0;

  const countdownColor =
    remainingMs > 6 * 3600 * 1000
      ? '#25D366'
      : remainingMs > 2 * 3600 * 1000
        ? '#f59e0b'
        : '#ef4444';

  const canRecordVoiceNote =
    !composerTemplateMode && Boolean(conversationId) && Boolean(participantPhone) && canSendFreeText;

  const recordingLabel = useCallback((ms: number) => {
    const totalSec = Math.floor(ms / 1000);
    const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
    const ss = String(totalSec % 60).padStart(2, '0');
    return `${mm}:${ss}`;
  }, []);

  const handleToggleVoiceRecord = useCallback(async () => {
    if (!canRecordVoiceNote || !conversationId) return;

    // Stop → move to preview (no auto-send)
    if (recording) {
      try {
        stopRecordingTimer();
        await recording.stopAndUnloadAsync();
        const uri = recording.getURI();
        setRecording(null);
        const capturedMs = recordingMs;
        setRecordingMs(0);
        if (!uri) return;
        setPendingVoiceUri(uri);
        setPendingVoiceMs(capturedMs);
      } catch {
        setRecording(null);
        setRecordingMs(0);
      }
      return;
    }

    // Start recording
    try {
      setSendError(null);
      // If there is a pending voice note, starting a new recording replaces it.
      setPendingVoiceUri(null);
      setPendingVoiceMs(0);
      await Audio.requestPermissionsAsync();
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });

      const rec = new Audio.Recording();
      await rec.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await rec.startAsync();
      setRecording(rec);
      setRecordingMs(0);

      stopRecordingTimer();
      recordingTimerRef.current = setInterval(async () => {
        try {
          const status = await rec.getStatusAsync();
          if (status.isRecording && typeof status.durationMillis === 'number') {
            setRecordingMs(status.durationMillis);
          }
        } catch {
          // ignore
        }
      }, 200);
    } catch {
      setRecording(null);
      setRecordingMs(0);
    }
  }, [
    canRecordVoiceNote,
    conversationId,
    onMessageSent,
    onOptimisticAdd,
    onOptimisticSetStatus,
    participantPhone,
    recording,
    recordingMs,
    stopRecordingTimer,
  ]);

  const handleDeletePendingVoice = useCallback(() => {
    setPendingVoiceUri(null);
    setPendingVoiceMs(0);
  }, []);

  /** Upload a media file to Bunny CDN then send via send-media */
  const handleSendMediaFile = useCallback(
    async (params: { uri: string; mimeType: string; filename: string; mediaType: 'image' | 'video' | 'document' }) => {
      if (!conversationId || !participantPhone) return;
      const { uri, mimeType, filename, mediaType } = params;
      const preview =
        mediaType === 'image' ? 'Photo' : mediaType === 'video' ? 'Video' : filename;
      const tempId = onOptimisticAdd?.(preview, mediaType as any, mediaType !== 'document' ? uri : undefined);
      try {
        const uploaded = await uploadToBunny({ uri, mimeType, filename });
        const mediaUrl = uploaded.url;
        if (!mediaUrl) throw new Error('Upload returned no URL');
        await sendMediaMessage({
          conversationId,
          to: participantPhone,
          mediaType,
          mediaUrl,
          filename: mediaType === 'document' ? filename : undefined,
        });
        if (tempId) onOptimisticSetStatus?.(tempId, 'sent');
        onMessageSent?.();
      } catch (e) {
        if (tempId) onOptimisticSetStatus?.(tempId, 'failed');
        Alert.alert('Send failed', e instanceof Error ? e.message : 'Could not send file');
      }
    },
    [conversationId, participantPhone, onOptimisticAdd, onOptimisticSetStatus, onMessageSent],
  );

  const handlePickImage = useCallback(async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Allow access to your photo library to send images.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        allowsMultipleSelection: false,
        quality: 0.85,
      });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      const isVideo = asset.type === 'video';
      const mimeType = asset.mimeType ?? (isVideo ? 'video/mp4' : 'image/jpeg');
      const ext = mimeType.split('/')[1] ?? (isVideo ? 'mp4' : 'jpg');
      const filename = asset.fileName ?? `media-${Date.now()}.${ext}`;
      await handleSendMediaFile({ uri: asset.uri, mimeType, filename, mediaType: isVideo ? 'video' : 'image' });
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Could not pick image');
    }
  }, [handleSendMediaFile]);

  const handlePickDocument = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      const mimeType = asset.mimeType ?? 'application/octet-stream';
      const filename = asset.name ?? `document-${Date.now()}`;
      await handleSendMediaFile({ uri: asset.uri, mimeType, filename, mediaType: 'document' });
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Could not pick document');
    }
  }, [handleSendMediaFile]);

  const handleAttachmentPress = useCallback(() => {
    if (!canSendFreeText) return;
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Cancel', 'Photo / Video', 'Document'],
          cancelButtonIndex: 0,
        },
        (idx) => {
          if (idx === 1) handlePickImage();
          else if (idx === 2) handlePickDocument();
        },
      );
    } else {
      Alert.alert('Attach', 'Choose attachment type', [
        { text: 'Photo / Video', onPress: handlePickImage },
        { text: 'Document', onPress: handlePickDocument },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  }, [canSendFreeText, handlePickImage, handlePickDocument]);

  const handleSendPendingVoice = useCallback(async () => {
    if (!conversationId || !participantPhone || !pendingVoiceUri || voiceBusy) return;
    setVoiceBusy(true);
    try {
      const filename = `voice-note-${Date.now()}.m4a`;
      const upload = await uploadWhatsAppMedia({
        uri: pendingVoiceUri,
        // Expo preset outputs m4a (audio/mp4) on both iOS/Android.
        mimeType: 'audio/mp4',
        filename,
      });
      const mediaId = upload.mediaId;
      const mediaUrl = upload.url;
      if (!mediaId) return;

      const to = participantPhone ?? '';
      // Pass 'audio' type + the local file URI so the optimistic bubble is
      // immediately playable from the on-device recording while the upload finishes.
      const tempId = onOptimisticAdd?.('Voice note', 'audio', pendingVoiceUri);
      try {
        await sendMediaMessage({
          conversationId,
          to,
          mediaType: 'audio',
          mediaId,
          ...(mediaUrl ? { mediaUrl } : {}),
          filename,
        });
        if (tempId) onOptimisticSetStatus?.(tempId, 'sent');
        onMessageSent?.();
        setPendingVoiceUri(null);
        setPendingVoiceMs(0);
      } catch {
        if (tempId) onOptimisticSetStatus?.(tempId, 'failed');
      }
    } finally {
      setVoiceBusy(false);
    }
  }, [
    conversationId,
    onMessageSent,
    onOptimisticAdd,
    onOptimisticSetStatus,
    participantPhone,
    pendingVoiceUri,
    voiceBusy,
  ]);

  const composerBottomPadding = getComposerBottomPadding({
    keyboardVisible,
    emojiPickerOpen: showEmojiPicker,
    safeAreaBottom: insets.bottom,
  });

  return (
    <>
      {!!replyTo && !composerTemplateMode && (
        <View style={styles.replyBar}>
          <View style={styles.replyBarLeft}>
            <View style={styles.replyAccent} />
            <View style={styles.replyTextBlock}>
              <Text style={styles.replyLabel}>Replying to</Text>
              <Text style={styles.replyPreview} numberOfLines={1}>
                {replyTo.preview}
              </Text>
            </View>
          </View>
          <TouchableOpacity
            style={styles.replyCloseBtn}
            onPress={onCancelReply}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="close" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
      )}

      <View style={[styles.composerRoot, { paddingBottom: composerBottomPadding }]}>
        {(showTemplateInfoBar || showCountdownInfoBar) && (
          <View style={styles.statusStrip}>
            {showTemplateInfoBar && (
              <View style={styles.statusChip}>
                <Ionicons
                  name={conversationStarted ? 'lock-closed' : 'document-text-outline'}
                  size={13}
                  color="#EA4335"
                />
                <Text style={styles.statusChipText} numberOfLines={1}>
                  {conversationStarted ? 'Templates only' : 'Start with a template'}
                </Text>
              </View>
            )}
            {showCountdownInfoBar && (
              <View style={[styles.statusChip, { borderColor: `${countdownColor}55` }]}>
                <Ionicons name="time-outline" size={13} color={countdownColor} />
                <Text style={[styles.statusChipTimer, { color: countdownColor }]} numberOfLines={1}>
                  {formatCountdown(remainingMs)}
                </Text>
              </View>
            )}
          </View>
        )}

        <View style={styles.inputRow}>
          <View style={styles.inputPill}>
            {!composerTemplateMode && !recording && !pendingVoiceUri && (
              <TouchableOpacity
                style={styles.pillIconBtn}
                onPress={toggleEmojiPicker}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={showEmojiPicker ? 'Show keyboard' : 'Show emojis'}
              >
                <Ionicons
                  name={showEmojiPicker ? 'keypad-outline' : 'happy-outline'}
                  size={22}
                  color={styles.pillIcon.color}
                />
              </TouchableOpacity>
            )}

            {composerTemplateMode ? (
              <Pressable style={styles.pillInputArea} onPress={openTemplateModal}>
                <Text style={styles.inputPlaceholder} numberOfLines={1}>
                  Tap to choose a template
                </Text>
              </Pressable>
            ) : recording ? (
              <View style={styles.recordingPillContent}>
                <View style={styles.recordingDot} />
                <Text style={styles.recordingPillText}>{recordingLabel(recordingMs)}</Text>
                <Text style={styles.recordingPillHint}>Tap mic to stop</Text>
              </View>
            ) : pendingVoiceUri ? (
              <View style={styles.recordingPillContent}>
                <Ionicons name="mic" size={16} color={colors.primary} />
                <Text style={styles.recordingPillText}>{recordingLabel(pendingVoiceMs)}</Text>
                <Text style={styles.recordingPillHint}>Voice note ready</Text>
              </View>
            ) : (
              <TextInput
                ref={textInputRef}
                style={styles.input}
                placeholder="Message"
                placeholderTextColor={colors.textMuted}
                value={text}
                onChangeText={setText}
                onFocus={() => {
                  if (showEmojiPicker) closeEmojiPicker();
                }}
                multiline
                maxLength={4096}
              />
            )}

            {!composerTemplateMode && !recording && (
              <View style={styles.pillTrailing}>
                {pendingVoiceUri ? (
                  <TouchableOpacity
                    style={styles.pillIconBtn}
                    onPress={handleDeletePendingVoice}
                    disabled={voiceBusy}
                    hitSlop={6}
                  >
                    <Ionicons name="trash-outline" size={22} color={styles.pillIcon.color} />
                  </TouchableOpacity>
                ) : (
                  <>
                    <TouchableOpacity
                      style={styles.pillIconBtn}
                      onPress={handleAttachmentPress}
                      disabled={!canSendFreeText}
                      hitSlop={6}
                    >
                      <Ionicons
                        name="attach"
                        size={22}
                        color={canSendFreeText ? styles.pillIcon.color : styles.pillIconDisabled.color}
                      />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.pillIconBtn}
                      onPress={handlePickImage}
                      disabled={!canSendFreeText}
                      hitSlop={6}
                    >
                      <Ionicons
                        name="camera-outline"
                        size={22}
                        color={canSendFreeText ? styles.pillIcon.color : styles.pillIconDisabled.color}
                      />
                    </TouchableOpacity>
                  </>
                )}
              </View>
            )}

            {composerTemplateMode && (
              <TouchableOpacity style={styles.pillIconBtn} onPress={openTemplateModal} hitSlop={6}>
                <Ionicons name="document-text-outline" size={22} color={styles.pillIcon.color} />
              </TouchableOpacity>
            )}
          </View>

          {composerTemplateMode ? (
            <TouchableOpacity style={styles.actionBtn} onPress={openTemplateModal} activeOpacity={0.85}>
              <Ionicons name="send" size={20} color="#111B21" />
            </TouchableOpacity>
          ) : text.trim().length > 0 ? (
            <TouchableOpacity style={styles.actionBtn} onPress={handleSendText} activeOpacity={0.85}>
              <Ionicons name="send" size={20} color="#111B21" />
            </TouchableOpacity>
          ) : pendingVoiceUri ? (
            <TouchableOpacity
              style={[styles.actionBtn, voiceBusy && styles.actionBtnDisabled]}
              onPress={handleSendPendingVoice}
              disabled={voiceBusy}
              activeOpacity={0.85}
            >
              {voiceBusy ? (
                <ActivityIndicator size="small" color="#111B21" />
              ) : (
                <Ionicons name="send" size={20} color="#111B21" />
              )}
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.actionBtn, recording && styles.actionBtnRecording]}
              onPress={handleToggleVoiceRecord}
              disabled={!canRecordVoiceNote && !recording}
              activeOpacity={0.85}
            >
              <Ionicons name={recording ? 'stop' : 'mic'} size={22} color="#111B21" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {showEmojiPicker && !composerTemplateMode && emojiPanelHeight > 0 && (
        <Animated.View style={{ height: emojiPanelAnim, overflow: 'hidden' }}>
          <EmojiKeyboard
            height={emojiPanelHeight}
            safeAreaBottom={0}
            onEmojiSelected={handleEmojiSelected}
            onKeyboardPress={handleShowKeyboardFromEmoji}
          />
        </Animated.View>
      )}

      <TemplatePickerSheet
        visible={showTemplateModal}
        onClose={() => setShowTemplateModal(false)}
        onRetry={openTemplateModal}
        templatesLoading={templatesLoading}
        templatesError={templatesError}
        templates={templates}
        selectedTemplate={selectedTemplate}
        onSelectTemplate={onSelectTemplate}
        onBackToList={goBackToTemplateList}
        variables={variables}
        templateFieldValues={templateFieldValues}
        onFieldChange={(index, value) => {
          const next = [...templateFieldValues];
          next[index] = value;
          setTemplateFieldValues(next);
        }}
        preview={preview}
        sendError={sendError}
        sending={sending}
        onSend={handleSendTemplate}
      />
    </>
  );
}

function createComposerStyles(colors: AppColors, isDark: boolean) {
  const pillBg = isDark ? '#1F2C34' : '#FFFFFF';
  const pillIconColor = isDark ? '#8696A0' : '#54656F';

  return StyleSheet.create({
  composerRoot: {
    paddingHorizontal: 8,
    paddingTop: 4,
    backgroundColor: 'transparent',
  },
  statusStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
    paddingHorizontal: 4,
  },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: isDark ? 'rgba(31,44,52,0.92)' : 'rgba(255,255,255,0.92)',
    borderWidth: 1,
    borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    maxWidth: '100%',
  },
  statusChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    flexShrink: 1,
  },
  statusChipTimer: {
    fontSize: 12,
    fontWeight: '700',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  inputPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    minHeight: 52,
    maxHeight: 124,
    borderRadius: 26,
    backgroundColor: pillBg,
    paddingLeft: 4,
    paddingRight: 6,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: isDark ? 0.28 : 0.1,
        shadowRadius: 4,
      },
      android: {
        elevation: 3,
      },
    }),
  },
  pillIconBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillIcon: {
    color: pillIconColor,
  },
  pillIconDisabled: {
    color: isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)',
  },
  pillInputArea: {
    flex: 1,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: 8,
  },
  pillTrailing: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: colors.text,
    paddingHorizontal: 8,
    paddingTop: Platform.OS === 'ios' ? 10 : 8,
    paddingBottom: Platform.OS === 'ios' ? 10 : 8,
    maxHeight: 100,
    minHeight: 40,
  },
  inputPlaceholder: {
    fontSize: 16,
    color: colors.textMuted,
  },
  actionBtn: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#25D366',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 0,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.18,
        shadowRadius: 3,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  actionBtnDisabled: {
    opacity: 0.7,
  },
  actionBtnRecording: {
    backgroundColor: '#EA4335',
  },
  recordingPillContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    minHeight: 40,
  },
  recordingPillText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  recordingPillHint: {
    fontSize: 12,
    color: colors.textMuted,
    flexShrink: 1,
  },
  recordingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#FF3B30',
  },
  replyBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 8,
    marginBottom: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: isDark ? 'rgba(31,44,52,0.9)' : 'rgba(255,255,255,0.94)',
    borderWidth: 1,
    borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.08,
        shadowRadius: 3,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  replyBarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 10,
  },
  replyAccent: {
    width: 3,
    height: 30,
    borderRadius: 2,
    backgroundColor: colors.primary,
    marginRight: 10,
  },
  replyTextBlock: {
    flex: 1,
  },
  replyLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.text,
  },
  replyPreview: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  replyCloseBtn: {
    padding: 6,
  },
  });
}
