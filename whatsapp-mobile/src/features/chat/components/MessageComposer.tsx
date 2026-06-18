import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
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
import { colors } from '../../../theme/colors';

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
}: MessageComposerProps) {
  const insets = useSafeAreaInsets();
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

  return (
    <>
      {showTemplateInfoBar && (
        <View style={styles.infoBar}>
          <View style={styles.infoBarLeft}>
            <View style={styles.infoIconWrap}>
              <Ionicons
                name={conversationStarted ? 'lock-closed-outline' : 'chatbubbles-outline'}
                size={18}
                color={colors.textMuted}
              />
            </View>
            <View style={styles.infoTextBlock}>
              <Text style={styles.infoTitle}>
                {conversationStarted ? '24-hour window closed' : 'Start with a template'}
              </Text>
              <Text style={styles.infoSubtitle}>
                {conversationStarted
                  ? 'You can only send template messages'
                  : "This chat hasn't started — send a template so the customer can reply"}
              </Text>
            </View>
          </View>
          <TouchableOpacity style={styles.infoButton} onPress={openTemplateModal}>
            <Ionicons name="documents-outline" size={16} color="#fff" />
            <Text style={styles.infoButtonText}>Send Template</Text>
          </TouchableOpacity>
        </View>
      )}

      {showCountdownInfoBar && (
        <View style={styles.infoBar}>
          <View style={styles.infoBarLeft}>
            <View style={styles.infoIconWrap}>
              <Ionicons name="time-outline" size={18} color={countdownColor} />
            </View>
            <View style={styles.infoTextBlock}>
              <Text style={styles.infoTitle}>Messaging window</Text>
              <Text style={styles.infoSubtitle}>
                Free messages close in{' '}
                <Text style={[styles.countdownValue, { color: countdownColor }]}>
                  {formatCountdown(remainingMs)}
                </Text>
                {' — then only templates'}
              </Text>
            </View>
          </View>
        </View>
      )}

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

      <View style={[styles.inputBar, { paddingBottom: Math.max(8, insets.bottom) }]}>
        <TouchableOpacity
          style={styles.inputIconBtn}
          onPress={handleAttachmentPress}
          disabled={!canSendFreeText}
        >
          <Ionicons name="add" size={24} color={canSendFreeText ? colors.textMuted : 'rgba(0,0,0,0.25)'} />
        </TouchableOpacity>
        {composerTemplateMode ? (
          <TouchableOpacity
            style={styles.inputBox}
            onPress={openTemplateModal}
            activeOpacity={0.7}
          >
            <Text style={styles.inputPlaceholder}>
              Send a template message...
            </Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.inputBox}>
            <TextInput
              style={styles.input}
              placeholder="Message"
              placeholderTextColor={colors.textMuted}
              value={text}
              onChangeText={setText}
              multiline
              maxLength={4096}
            />
          </View>
        )}
        {!composerTemplateMode && text.trim().length > 0 ? (
          <TouchableOpacity
            style={styles.sendBtn}
            onPress={handleSendText}
          >
            <Ionicons name="send" size={20} color="#fff" />
          </TouchableOpacity>
        ) : pendingVoiceUri ? (
          <View style={styles.voicePreviewActions}>
            <TouchableOpacity
              style={styles.voiceDeleteBtn}
              onPress={handleDeletePendingVoice}
              disabled={voiceBusy}
            >
              <Ionicons name="trash-outline" size={20} color={colors.textMuted} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.sendBtn, voiceBusy && styles.sendBtnDisabled]}
              onPress={handleSendPendingVoice}
              disabled={voiceBusy}
            >
              {voiceBusy ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Ionicons name="send" size={20} color="#fff" />
              )}
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.inputIconBtn}
            onPress={handleToggleVoiceRecord}
            disabled={!canRecordVoiceNote}
          >
            {recording ? (
              <View style={styles.recordingInline}>
                <View style={styles.recordingDot} />
                <Text style={styles.recordingInlineText}>{recordingLabel(recordingMs)}</Text>
                <Ionicons name="stop-circle-outline" size={22} color={colors.textMuted} />
              </View>
            ) : (
              <Ionicons
                name="mic-outline"
                size={22}
                color={canRecordVoiceNote ? colors.textMuted : 'rgba(0,0,0,0.25)'}
              />
            )}
          </TouchableOpacity>
        )}
      </View>

      <Modal
        visible={showTemplateModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowTemplateModal(false)}
      >
        <TouchableWithoutFeedback onPress={() => setShowTemplateModal(false)}>
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback>
              <View style={styles.modalSheet}>
                <View style={styles.modalHeader}>
                  <TouchableOpacity
                    onPress={
                      selectedTemplate ? goBackToTemplateList : () => setShowTemplateModal(false)
                    }
                    style={styles.modalBackBtn}
                  >
                    <Ionicons name="arrow-back" size={24} color={colors.text} />
                  </TouchableOpacity>
                  <Text style={styles.modalTitle}>
                    {selectedTemplate ? selectedTemplate.name : 'Choose template'}
                  </Text>
                  <TouchableOpacity
                    onPress={() => setShowTemplateModal(false)}
                    style={styles.modalCloseBtn}
                  >
                    <Ionicons name="close" size={24} color={colors.textMuted} />
                  </TouchableOpacity>
                </View>

                {templatesLoading && (
                  <View style={styles.modalCenter}>
                    <ActivityIndicator size="small" color={colors.primary} />
                  </View>
                )}
                {templatesError && !templatesLoading && (
                  <View style={styles.modalCenter}>
                    <Text style={styles.modalError}>{templatesError}</Text>
                  </View>
                )}
                {!templatesLoading && !templatesError && !selectedTemplate && templates.length === 0 && (
                  <View style={styles.modalCenter}>
                    <Text style={styles.modalEmpty}>No templates available</Text>
                  </View>
                )}

                {!templatesLoading && !selectedTemplate && templates.length > 0 && (
                  <FlatList
                    data={templates}
                    keyExtractor={(item) => item.name + (item.language ?? '')}
                    renderItem={({ item }) => (
                      <TouchableOpacity
                        style={styles.templateItem}
                        onPress={() => onSelectTemplate(item)}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.templateItemName} numberOfLines={1}>
                          {item.name}
                        </Text>
                        {item.language && (
                          <Text style={styles.templateItemLang}>{item.language}</Text>
                        )}
                      </TouchableOpacity>
                    )}
                    style={styles.templateList}
                  />
                )}

                {selectedTemplate && (
                  <ScrollView
                    style={styles.templateForm}
                    contentContainerStyle={styles.templateFormContent}
                    keyboardShouldPersistTaps="handled"
                  >
                    <View style={styles.previewSection}>
                      <Text style={styles.previewLabel}>Preview</Text>
                      <View style={styles.previewBubble}>
                        {(preview?.header || preview?.body || preview?.footer) ? (
                          <>
                            {preview.header && (
                              <Text style={styles.previewHeader}>{preview.header}</Text>
                            )}
                            {preview.body && (
                              <Text style={styles.previewBody}>{preview.body}</Text>
                            )}
                            {preview.footer && (
                              <Text style={styles.previewFooter}>{preview.footer}</Text>
                            )}
                          </>
                        ) : (
                          <Text style={styles.previewPlaceholder}>
                            Fill in the fields below to see the message preview
                          </Text>
                        )}
                      </View>
                    </View>

                    <Text style={styles.fieldsSectionLabel}>Template fields</Text>
                    {variables.length === 0 ? (
                      <Text style={styles.templateNoVars}>
                        This template has no variables. Tap Send to use it.
                      </Text>
                    ) : (
                      variables.map((label, i) => (
                        <View key={label} style={styles.fieldWrap}>
                          <Text style={styles.fieldLabel}>{label}</Text>
                          <TextInput
                            style={styles.fieldInput}
                            placeholder={`Enter value for ${label}`}
                            placeholderTextColor={colors.textMuted}
                            value={templateFieldValues[i] ?? ''}
                            onChangeText={(val) => {
                              const next = [...templateFieldValues];
                              next[i] = val;
                              setTemplateFieldValues(next);
                            }}
                          />
                        </View>
                      ))
                    )}
                    {sendError && (
                      <Text style={styles.sendError}>{sendError}</Text>
                    )}
                    <TouchableOpacity
                      style={[styles.sendTemplateBtn, sending && styles.sendTemplateBtnDisabled]}
                      onPress={handleSendTemplate}
                      disabled={sending}
                    >
                      {sending ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <>
                          <Ionicons name="send" size={18} color="#fff" />
                          <Text style={styles.sendTemplateBtnText}>Send</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </ScrollView>
                )}
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  countdownValue: {
    fontWeight: '700',
    fontSize: 12,
  },
  infoBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: colors.backgroundSecondary,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  infoBarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  infoIconWrap: {
    marginRight: 10,
  },
  infoTextBlock: {
    flex: 1,
  },
  infoTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  infoSubtitle: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  infoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  infoButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#fff',
    marginLeft: 4,
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.backgroundSecondary,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  replyBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 6,
    backgroundColor: colors.backgroundSecondary,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
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
  inputIconBtn: {
    paddingHorizontal: 6,
    paddingBottom: 6,
  },
  recordingInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  recordingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#FF3B30',
  },
  recordingInlineText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
  },
  inputBox: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginHorizontal: 8,
    minHeight: 40,
    maxHeight: 100,
    justifyContent: 'center',
  },
  input: {
    fontSize: 16,
    color: colors.text,
    paddingVertical: 0,
    maxHeight: 80,
  },
  inputPlaceholder: {
    fontSize: 16,
    color: colors.textMuted,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: {
    opacity: 0.7,
  },
  voicePreviewActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingBottom: 2,
  },
  voiceDeleteBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.background,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    height: '92%',
    maxHeight: '92%',
    minHeight: 400,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  modalBackBtn: {
    padding: 4,
    marginRight: 8,
  },
  modalTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  modalCloseBtn: {
    padding: 4,
  },
  modalCenter: {
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalError: {
    fontSize: 14,
    color: colors.error,
  },
  modalEmpty: {
    fontSize: 14,
    color: colors.textMuted,
  },
  templateList: {
    flex: 1,
  },
  templateItem: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  templateItemName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  templateItemLang: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  templateForm: {
    flex: 1,
  },
  templateFormContent: {
    padding: 16,
    paddingBottom: 32,
  },
  previewSection: {
    marginBottom: 20,
  },
  previewLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  previewBubble: {
    backgroundColor: colors.chatBubbleOut,
    borderRadius: 12,
    borderBottomRightRadius: 4,
    padding: 14,
    maxWidth: '100%',
  },
  previewHeader: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 6,
  },
  previewBody: {
    fontSize: 15,
    color: colors.text,
    lineHeight: 22,
  },
  previewFooter: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 8,
  },
  previewPlaceholder: {
    fontSize: 14,
    color: colors.textMuted,
    fontStyle: 'italic',
  },
  fieldsSectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  templateNoVars: {
    fontSize: 14,
    color: colors.textMuted,
    marginBottom: 16,
  },
  fieldWrap: {
    marginBottom: 16,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 6,
  },
  fieldInput: {
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sendError: {
    fontSize: 13,
    color: colors.error,
    marginBottom: 12,
  },
  sendTemplateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  sendTemplateBtnDisabled: {
    opacity: 0.7,
  },
  sendTemplateBtnText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
});
