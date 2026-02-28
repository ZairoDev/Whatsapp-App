import React, { useCallback, useState } from 'react';
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

interface MessageComposerProps {
  conversationId: string;
  /** Participant phone (E.164) for sending templates - required when templateOnly */
  participantPhone?: string;
  /** When false: normal WhatsApp input. When true: template-only (24h window closed) */
  templateOnly?: boolean;
  onMessageSent?: () => void;
}

export function MessageComposer({
  conversationId,
  participantPhone,
  templateOnly = false,
  onMessageSent,
}: MessageComposerProps) {
  const [text, setText] = useState('');
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
    if (!selectedTemplate || !conversationId) return;
    // Backend resolves recipient from conversationId when `to` is not sent
    const vars = getTemplateVariables(selectedTemplate);
    const hasEmpty = vars.some((_, i) => !(templateFieldValues[i]?.trim()));
    if (hasEmpty) {
      setSendError('Please fill in all fields');
      return;
    }
    setSending(true);
    setSendError(null);
    try {
      const preview = getTemplatePreview(selectedTemplate, templateFieldValues);
      const templateText = [preview.header, preview.body, preview.footer].filter(Boolean).join('\n');
      await sendTemplate({
        ...(participantPhone?.trim() && { to: participantPhone }),
        template: selectedTemplate,
        parameters: templateFieldValues.map((v) => v.trim()),
        conversationId,
        templateText,
      });
      setShowTemplateModal(false);
      setSelectedTemplate(null);
      setTemplateFieldValues([]);
      onMessageSent?.();
    } catch (e) {
      setSendError(e instanceof Error ? e.message : 'Failed to send template');
    } finally {
      setSending(false);
    }
  }, [selectedTemplate, conversationId, participantPhone, templateFieldValues, onMessageSent]);

  const handleSendText = useCallback(async () => {
    const content = text.trim();
    if (!content || !conversationId) return;
    setText('');
    try {
      await sendMessage(conversationId, content, 'text');
      onMessageSent?.();
    } catch {
      setText(content); // restore on failure
    }
  }, [text, conversationId, onMessageSent]);

  const variables = selectedTemplate ? getTemplateVariables(selectedTemplate) : [];
  const preview = selectedTemplate
    ? getTemplatePreview(selectedTemplate, templateFieldValues)
    : null;

  return (
    <>
      {templateOnly && (
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
          <TouchableOpacity style={styles.infoButton} onPress={openTemplateModal}>
            <Ionicons name="documents-outline" size={16} color="#fff" />
            <Text style={styles.infoButtonText}>Send Template</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.inputBar}>
        <TouchableOpacity style={styles.inputIconBtn}>
          <Ionicons name="add" size={24} color={colors.textMuted} />
        </TouchableOpacity>
        {templateOnly ? (
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
        {!templateOnly && text.trim().length > 0 ? (
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
