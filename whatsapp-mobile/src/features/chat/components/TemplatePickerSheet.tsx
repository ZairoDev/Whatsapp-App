import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../theme/ThemeContext';
import type { AppColors } from '../../../theme/palettes';
import type { WhatsAppTemplate } from '../services';

function getTemplateSnippet(template: WhatsAppTemplate): string {
  const bodyComp = template.components?.find((c) => c.type === 'BODY');
  const example = bodyComp?.example?.body_text?.[0];
  if (Array.isArray(example) && example.length > 0) {
    return example.join(' ').slice(0, 140);
  }
  const raw = bodyComp?.text;
  if (typeof raw === 'string' && raw.trim()) {
    return raw.replace(/\{\{\d+\}\}/g, '…').trim().slice(0, 140);
  }
  const header = template.components?.find((c) => c.type === 'HEADER' && c.format === 'TEXT')?.text;
  if (typeof header === 'string' && header.trim()) {
    return header.replace(/\{\{\d+\}\}/g, '…').trim().slice(0, 140);
  }
  return 'Approved WhatsApp message template';
}

function formatLanguageCode(code?: string): string {
  if (!code) return '';
  const base = code.split(/[-_]/)[0]?.toUpperCase() ?? code.toUpperCase();
  return base.length <= 3 ? base : code.toUpperCase();
}

function countTemplateVars(template: WhatsAppTemplate): number {
  let n = 0;
  const regex = /\{\{\d+\}\}/g;
  for (const comp of template.components ?? []) {
    if (comp.type === 'HEADER' && comp.format === 'TEXT' && comp.text) {
      n += (comp.text.match(regex) ?? []).length;
    }
    if (comp.type === 'BODY' && comp.text) {
      n += (comp.text.match(regex) ?? []).length;
    }
  }
  return n;
}

export interface TemplatePreviewParts {
  header?: string;
  body?: string;
  footer?: string;
}

export interface TemplatePickerSheetProps {
  visible: boolean;
  onClose: () => void;
  onRetry?: () => void;
  templatesLoading: boolean;
  templatesError: string | null;
  templates: WhatsAppTemplate[];
  selectedTemplate: WhatsAppTemplate | null;
  onSelectTemplate: (template: WhatsAppTemplate) => void;
  onBackToList: () => void;
  variables: string[];
  templateFieldValues: string[];
  onFieldChange: (index: number, value: string) => void;
  preview: TemplatePreviewParts | null;
  sendError: string | null;
  sending: boolean;
  onSend: () => void;
}

function TemplateListSkeleton({ styles }: { styles: ReturnType<typeof createSheetStyles> }) {
  return (
    <View style={styles.skeletonList}>
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={styles.skeletonCard}>
          <View style={styles.skeletonIcon} />
          <View style={styles.skeletonTextBlock}>
            <View style={[styles.skeletonLine, { width: '55%' }]} />
            <View style={[styles.skeletonLine, { width: '88%', marginTop: 8 }]} />
            <View style={[styles.skeletonLine, { width: '72%', marginTop: 6 }]} />
          </View>
        </View>
      ))}
    </View>
  );
}

function EmptyState({
  icon,
  title,
  message,
  actionLabel,
  onAction,
  styles,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  styles: ReturnType<typeof createSheetStyles>;
}) {
  return (
    <View style={styles.emptyState}>
      <View style={styles.emptyIconWrap}>
        <Ionicons name={icon} size={28} color={styles.emptyIconColor.color} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyMessage}>{message}</Text>
      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          style={({ pressed }) => [styles.emptyActionBtn, pressed && styles.pressed]}
          accessibilityRole="button"
        >
          <Text style={styles.emptyActionText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function TemplatePickerSheet({
  visible,
  onClose,
  onRetry,
  templatesLoading,
  templatesError,
  templates,
  selectedTemplate,
  onSelectTemplate,
  onBackToList,
  variables,
  templateFieldValues,
  onFieldChange,
  preview,
  sendError,
  sending,
  onSend,
}: TemplatePickerSheetProps) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const styles = useMemo(() => createSheetStyles(colors, isDark, insets.bottom), [colors, isDark, insets.bottom]);
  const sheetMaxHeight = Math.min(windowHeight * 0.88, windowHeight - insets.top - 24);
  const listSheetHeight = Math.min(sheetMaxHeight, Math.max(440, windowHeight * 0.72));

  const [searchQuery, setSearchQuery] = useState('');

  const filteredTemplates = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter((t) => {
      const snippet = getTemplateSnippet(t).toLowerCase();
      return t.name.toLowerCase().includes(q) || snippet.includes(q) || (t.language ?? '').toLowerCase().includes(q);
    });
  }, [searchQuery, templates]);

  const hasPreviewContent = Boolean(preview?.header || preview?.body || preview?.footer);
  const showList = !selectedTemplate && !templatesLoading && !templatesError;

  const handleClose = () => {
    setSearchQuery('');
    onClose();
  };

  const handleBack = () => {
    onBackToList();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <Pressable
          style={styles.backdrop}
          onPress={handleClose}
          accessibilityRole="button"
          accessibilityLabel="Close template picker"
        />

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={[styles.sheetWrap, { maxHeight: sheetMaxHeight }]}
        >
          <View style={[styles.sheet, { maxHeight: sheetMaxHeight, height: listSheetHeight }]}>
            <View style={styles.handle} />

            <View style={styles.header}>
              {selectedTemplate ? (
                <Pressable
                  onPress={handleBack}
                  style={({ pressed }) => [styles.headerBtn, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel="Back to templates"
                  hitSlop={8}
                >
                  <Ionicons name="chevron-back" size={26} color={colors.text} />
                </Pressable>
              ) : (
                <View style={styles.headerBtn} />
              )}

              <View style={styles.headerTitles}>
                <Text style={styles.headerTitle} numberOfLines={1}>
                  {selectedTemplate ? selectedTemplate.name : 'Choose template'}
                </Text>
                {!selectedTemplate && templates.length > 0 && !templatesLoading ? (
                  <Text style={styles.headerSubtitle}>
                    {templates.length} approved template{templates.length === 1 ? '' : 's'}
                  </Text>
                ) : selectedTemplate ? (
                  <Text style={styles.headerSubtitle}>Customize and send</Text>
                ) : null}
              </View>

              <Pressable
                onPress={handleClose}
                style={({ pressed }) => [styles.headerBtn, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="Close"
                hitSlop={8}
              >
                <Ionicons name="close" size={24} color={colors.textMuted} />
              </Pressable>
            </View>

            {!selectedTemplate && !templatesLoading && !templatesError && templates.length > 3 ? (
              <View style={styles.searchWrap}>
                <Ionicons name="search" size={18} color={colors.textMuted} />
                <TextInput
                  style={styles.searchInput}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholder="Search templates"
                  placeholderTextColor={colors.textMuted}
                  autoCorrect={false}
                  autoCapitalize="none"
                  clearButtonMode="while-editing"
                  returnKeyType="search"
                />
                {searchQuery.length > 0 ? (
                  <Pressable
                    onPress={() => setSearchQuery('')}
                    hitSlop={8}
                    style={({ pressed }) => pressed && styles.pressed}
                    accessibilityRole="button"
                    accessibilityLabel="Clear search"
                  >
                    <Ionicons name="close-circle" size={18} color={colors.textMuted} />
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            {templatesLoading ? <TemplateListSkeleton styles={styles} /> : null}

            {templatesError && !templatesLoading ? (
              <EmptyState
                icon="cloud-offline-outline"
                title="Couldn't load templates"
                message={templatesError}
                actionLabel={onRetry ? 'Try again' : undefined}
                onAction={onRetry}
                styles={styles}
              />
            ) : null}

            {!templatesLoading && !templatesError && !selectedTemplate && templates.length === 0 ? (
              <EmptyState
                icon="document-text-outline"
                title="No templates yet"
                message="Approved WhatsApp templates for this line will appear here once they're configured in WhatsApp Channels."
                styles={styles}
              />
            ) : null}

            {showList && templates.length > 0 ? (
              <FlatList
                data={filteredTemplates}
                keyExtractor={(item) => `${item.name}-${item.language ?? ''}`}
                style={styles.list}
                contentContainerStyle={styles.listContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                ListEmptyComponent={
                  <EmptyState
                    icon="search-outline"
                    title="No matches"
                    message={`Nothing found for "${searchQuery.trim()}". Try another name or keyword.`}
                    styles={styles}
                  />
                }
                renderItem={({ item }) => {
                  const varCount = countTemplateVars(item);
                  const lang = formatLanguageCode(item.language);
                  return (
                    <Pressable
                      onPress={() => onSelectTemplate(item)}
                      style={({ pressed }) => [styles.templateCard, pressed && styles.templateCardPressed]}
                      accessibilityRole="button"
                      accessibilityLabel={`Template ${item.name}`}
                    >
                      <View style={styles.templateIconWrap}>
                        <Ionicons name="chatbubble-ellipses" size={20} color={colors.primary} />
                      </View>
                      <View style={styles.templateCardBody}>
                        <View style={styles.templateCardTopRow}>
                          <Text style={styles.templateName} numberOfLines={1}>
                            {item.name.replace(/_/g, ' ')}
                          </Text>
                          {lang ? (
                            <View style={styles.langBadge}>
                              <Text style={styles.langBadgeText}>{lang}</Text>
                            </View>
                          ) : null}
                        </View>
                        <Text style={styles.templateSnippet} numberOfLines={2}>
                          {getTemplateSnippet(item)}
                        </Text>
                        {varCount > 0 ? (
                          <Text style={styles.templateMeta}>
                            {varCount} field{varCount === 1 ? '' : 's'} to fill
                          </Text>
                        ) : (
                          <Text style={styles.templateMeta}>Ready to send</Text>
                        )}
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                    </Pressable>
                  );
                }}
              />
            ) : null}

            {selectedTemplate ? (
              <>
                <ScrollView
                  style={styles.detailScroll}
                  contentContainerStyle={styles.detailContent}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                >
                  <View style={styles.previewStage}>
                    <Text style={styles.sectionEyebrow}>Message preview</Text>
                    <View style={styles.previewWallpaper}>
                      <View style={styles.previewBubble}>
                        {hasPreviewContent ? (
                          <>
                            {preview?.header ? (
                              <Text style={styles.previewHeader}>{preview.header}</Text>
                            ) : null}
                            {preview?.body ? (
                              <Text style={styles.previewBody}>{preview.body}</Text>
                            ) : null}
                            {preview?.footer ? (
                              <Text style={styles.previewFooter}>{preview.footer}</Text>
                            ) : null}
                          </>
                        ) : (
                          <Text style={styles.previewPlaceholder}>
                            Fill in the fields below to see how this message will look.
                          </Text>
                        )}
                        <View style={styles.previewTail} />
                      </View>
                    </View>
                  </View>

                  <Text style={styles.sectionEyebrow}>Template fields</Text>
                  {variables.length === 0 ? (
                    <View style={styles.noVarsCard}>
                      <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
                      <Text style={styles.noVarsText}>
                        This template has no variables. You can send it as-is.
                      </Text>
                    </View>
                  ) : (
                    variables.map((label, i) => (
                      <View key={`${label}-${i}`} style={styles.fieldGroup}>
                        <Text style={styles.fieldLabel}>{label}</Text>
                        <TextInput
                          style={styles.fieldInput}
                          placeholder={`Value for ${label}`}
                          placeholderTextColor={colors.textMuted}
                          value={templateFieldValues[i] ?? ''}
                          onChangeText={(val) => onFieldChange(i, val)}
                          autoCorrect={false}
                        />
                      </View>
                    ))
                  )}

                  {sendError ? (
                    <View style={styles.errorBanner}>
                      <Ionicons name="alert-circle" size={18} color={colors.error} />
                      <Text style={styles.errorBannerText}>{sendError}</Text>
                    </View>
                  ) : null}
                </ScrollView>

                <View style={styles.footer}>
                  <Pressable
                    onPress={onSend}
                    disabled={sending}
                    style={({ pressed }) => [
                      styles.sendBtn,
                      sending && styles.sendBtnDisabled,
                      pressed && !sending && styles.pressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="Send template"
                  >
                    {sending ? (
                      <ActivityIndicator size="small" color={colors.onPrimary} />
                    ) : (
                      <>
                        <Ionicons name="send" size={18} color={colors.onPrimary} />
                        <Text style={styles.sendBtnText}>Send template</Text>
                      </>
                    )}
                  </Pressable>
                </View>
              </>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

function createSheetStyles(colors: AppColors, isDark: boolean, safeBottom: number) {
  const cardBg = isDark ? '#1A262D' : '#FFFFFF';
  const searchBg = isDark ? '#1F2C34' : '#F0F2F5';
  const wallpaper = isDark ? '#0F171C' : colors.chatWallpaper;

  return StyleSheet.create({
    overlay: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: colors.overlay,
    },
    backdrop: {
      ...StyleSheet.absoluteFillObject,
    },
    sheetWrap: {
      width: '100%',
    },
    sheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      overflow: 'hidden',
      paddingBottom: Math.max(safeBottom, 12),
    },
    handle: {
      alignSelf: 'center',
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: isDark ? 'rgba(255,255,255,0.18)' : '#D1D7DB',
      marginTop: 8,
      marginBottom: 4,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 4,
      paddingBottom: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    headerBtn: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerTitles: {
      flex: 1,
      alignItems: 'center',
      paddingHorizontal: 4,
    },
    headerTitle: {
      fontSize: 17,
      fontWeight: '700',
      color: colors.text,
      textAlign: 'center',
    },
    headerSubtitle: {
      marginTop: 2,
      fontSize: 12,
      color: colors.textMuted,
      textAlign: 'center',
    },
    searchWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginHorizontal: 16,
      marginTop: 12,
      marginBottom: 4,
      paddingHorizontal: 12,
      height: 44,
      borderRadius: 14,
      backgroundColor: searchBg,
      borderWidth: 1,
      borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
    },
    searchInput: {
      flex: 1,
      fontSize: 16,
      color: colors.text,
      paddingVertical: 0,
    },
    list: {
      flex: 1,
    },
    listContent: {
      paddingHorizontal: 16,
      paddingTop: 10,
      paddingBottom: 8,
      gap: 10,
    },
    templateCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 14,
      paddingVertical: 14,
      borderRadius: 16,
      backgroundColor: cardBg,
      borderWidth: 1,
      borderColor: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)',
      ...Platform.select({
        ios: {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: isDark ? 0.22 : 0.06,
          shadowRadius: 4,
        },
        android: { elevation: 1 },
      }),
    },
    templateCardPressed: {
      opacity: 0.92,
      transform: [{ scale: 0.995 }],
    },
    templateIconWrap: {
      width: 42,
      height: 42,
      borderRadius: 21,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: isDark ? 'rgba(37,211,102,0.14)' : 'rgba(37,211,102,0.12)',
    },
    templateCardBody: {
      flex: 1,
      minWidth: 0,
    },
    templateCardTopRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 4,
    },
    templateName: {
      flex: 1,
      fontSize: 16,
      fontWeight: '700',
      color: colors.text,
      textTransform: 'capitalize',
    },
    langBadge: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 8,
      backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : '#E9EDEF',
    },
    langBadgeText: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.textSecondary,
      letterSpacing: 0.3,
    },
    templateSnippet: {
      fontSize: 14,
      lineHeight: 20,
      color: colors.textSecondary,
    },
    templateMeta: {
      marginTop: 6,
      fontSize: 12,
      fontWeight: '600',
      color: colors.primary,
    },
    skeletonList: {
      paddingHorizontal: 16,
      paddingTop: 12,
      gap: 10,
    },
    skeletonCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      padding: 14,
      borderRadius: 16,
      backgroundColor: cardBg,
      borderWidth: 1,
      borderColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
    },
    skeletonIcon: {
      width: 42,
      height: 42,
      borderRadius: 21,
      backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : '#E9EDEF',
    },
    skeletonTextBlock: {
      flex: 1,
    },
    skeletonLine: {
      height: 10,
      borderRadius: 5,
      backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : '#E9EDEF',
    },
    emptyState: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 28,
      paddingVertical: 40,
    },
    emptyIconWrap: {
      width: 56,
      height: 56,
      borderRadius: 28,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : '#F0F2F5',
      marginBottom: 14,
    },
    emptyIconColor: {
      color: colors.textMuted,
    },
    emptyTitle: {
      fontSize: 17,
      fontWeight: '700',
      color: colors.text,
      textAlign: 'center',
      marginBottom: 8,
    },
    emptyMessage: {
      fontSize: 14,
      lineHeight: 21,
      color: colors.textMuted,
      textAlign: 'center',
    },
    emptyActionBtn: {
      marginTop: 18,
      paddingHorizontal: 18,
      paddingVertical: 10,
      borderRadius: 20,
      backgroundColor: isDark ? 'rgba(37,211,102,0.16)' : 'rgba(37,211,102,0.12)',
    },
    emptyActionText: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.primary,
    },
    detailScroll: {
      flex: 1,
    },
    detailContent: {
      paddingHorizontal: 16,
      paddingTop: 14,
      paddingBottom: 12,
    },
    sectionEyebrow: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: 10,
    },
    previewStage: {
      marginBottom: 22,
    },
    previewWallpaper: {
      borderRadius: 16,
      padding: 16,
      backgroundColor: wallpaper,
      borderWidth: 1,
      borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
    },
    previewBubble: {
      alignSelf: 'flex-end',
      maxWidth: '92%',
      backgroundColor: colors.chatBubbleOut,
      borderRadius: 14,
      borderBottomRightRadius: 4,
      paddingHorizontal: 12,
      paddingVertical: 10,
      position: 'relative',
    },
    previewTail: {
      position: 'absolute',
      right: -4,
      bottom: 0,
      width: 10,
      height: 10,
      backgroundColor: colors.chatBubbleOut,
      borderBottomRightRadius: 10,
      transform: [{ rotate: '45deg' }],
    },
    previewHeader: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.text,
      marginBottom: 4,
    },
    previewBody: {
      fontSize: 15,
      lineHeight: 22,
      color: colors.text,
    },
    previewFooter: {
      marginTop: 8,
      fontSize: 12,
      color: colors.textMuted,
    },
    previewPlaceholder: {
      fontSize: 14,
      lineHeight: 20,
      color: colors.textMuted,
      fontStyle: 'italic',
    },
    noVarsCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      padding: 14,
      borderRadius: 14,
      backgroundColor: isDark ? 'rgba(37,211,102,0.1)' : 'rgba(37,211,102,0.08)',
      marginBottom: 8,
    },
    noVarsText: {
      flex: 1,
      fontSize: 14,
      lineHeight: 20,
      color: colors.textSecondary,
    },
    fieldGroup: {
      marginBottom: 14,
    },
    fieldLabel: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.text,
      marginBottom: 8,
    },
    fieldInput: {
      minHeight: 48,
      borderRadius: 14,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontSize: 16,
      color: colors.text,
      backgroundColor: isDark ? '#1F2C34' : '#F0F2F5',
      borderWidth: 1,
      borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
    },
    errorBanner: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
      marginTop: 4,
      padding: 12,
      borderRadius: 12,
      backgroundColor: isDark ? 'rgba(241,92,109,0.12)' : 'rgba(234,67,53,0.08)',
    },
    errorBannerText: {
      flex: 1,
      fontSize: 13,
      lineHeight: 18,
      color: colors.error,
    },
    footer: {
      paddingHorizontal: 16,
      paddingTop: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    sendBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      minHeight: 52,
      borderRadius: 26,
      backgroundColor: colors.primary,
      ...Platform.select({
        ios: {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.16,
          shadowRadius: 4,
        },
        android: { elevation: 3 },
      }),
    },
    sendBtnDisabled: {
      opacity: 0.75,
    },
    sendBtnText: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.onPrimary,
    },
    pressed: {
      opacity: 0.85,
    },
  });
}
