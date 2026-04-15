import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
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
import {
  fetchWhatsAppTemplates,
  getTemplatePreview,
  getTemplateVariables,
  sendMessage,
  sendTemplate,
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
  area?: 'athens' | 'thessaloniki';
  /** Optional reply target (UI + quoted prefix since backend doesn't support reply metadata yet). */
  replyTo?: {
    id: string;
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
   */
  onOptimisticAdd?: (content: string) => string;
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

  const openTemplateModal = useCallback(async () => {
    setShowTemplateModal(true);
    setSelectedTemplate(null);
    setTemplateFieldValues([]);
    setSendError(null);
    setTemplatesError(null);
    setTemplatesLoading(true);
    try {
      const list = await fetchWhatsAppTemplates();
      setTemplates(list);
    } catch (e) {
      setTemplatesError(e instanceof Error ? e.message : 'Failed to load templates');
      setTemplates([]);
    } finally {
      setTemplatesLoading(false);
    }
  }, []);

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

    const replyPrefix =
      replyTo?.preview?.trim()
        ? `↩︎ Replying to:\n> ${replyTo.preview.trim().replace(/\n/g, ' ')}\n\n`
        : '';
    const outgoing = `${replyPrefix}${content}`;

    // Optimistically insert the bubble immediately
    const tempId = onOptimisticAdd?.(outgoing);
    setText('');

    try {
      await sendMessage(conversationId, to, outgoing, 'text', area);
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
    }
  }, [text, conversationId, participantPhone, area, onMessageSent, onOptimisticAdd, onOptimisticSetStatus, replyTo, onCancelReply]);

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
        <TouchableOpacity style={styles.inputIconBtn}>
          <Ionicons name="add" size={24} color={colors.textMuted} />
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
        ) : (
          <TouchableOpacity style={styles.inputIconBtn}>
            <Ionicons name="mic-outline" size={22} color={colors.textMuted} />
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
