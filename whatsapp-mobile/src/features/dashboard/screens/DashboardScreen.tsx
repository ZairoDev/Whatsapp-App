import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  ScrollView,
  RefreshControl,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../../../features/auth/auth.store';
import { employeeLogout } from '../../../features/auth/services/auth.api';
import type { RootStackParamList } from '../../../core/navigation/RootNavigator';
import type { AppColors } from '../../../theme/palettes';
import { useTheme } from '../../../theme/ThemeContext';
import { ThemeToggleButton } from '../../../theme/ThemeToggleButton';
import {
  formatLocationLabel,
  getUserScopedLocationKeys,
  hasFullLocationAccess,
  isSuperAdminRole,
  resolveConversationArea,
  resolveDefaultLocationKey,
} from '../../chat/utils/locations';
import {
  fetchConversationCounts,
  fetchConversations,
  type ConversationCounts,
} from '../../chat/services';
import type { Conversation } from '../../chat/types';

type HomeNav = NativeStackNavigationProp<RootStackParamList, 'Main'>;

type HomeSnapshot = ConversationCounts & {
  unreadCount: number;
};

const EMPTY_SNAPSHOT: HomeSnapshot = {
  totalCount: 0,
  ownerCount: 0,
  guestCount: 0,
  archivedCount: 0,
  unreadCount: 0,
};

type HomeAlertId = 'admin-queue' | 'template-only';

type HomeAlert = {
  id: HomeAlertId;
  title: string;
  subtitle: string;
  actionLabel: string;
  icon: keyof typeof Ionicons.glyphMap;
  tone: 'warning' | 'info';
  onPress: () => void;
};

type HomeAlertSnapshot = {
  adminQueueCount: number;
  adminQueueHasMore: boolean;
  templateOnlyCount: number;
};

const EMPTY_ALERT_SNAPSHOT: HomeAlertSnapshot = {
  adminQueueCount: 0,
  adminQueueHasMore: false,
  templateOnlyCount: 0,
};

const MAX_UNREAD_PREVIEW = 3;
const SCREEN_PADDING = 20;
const ROW_DIVIDER_INSET = 72;

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
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }
  if (diffDays === 1) return 'Yesterday';
  const isThisYear = d.getFullYear() === now.getFullYear();
  if (isThisYear) {
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' });
}

function getTimeGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function sortByRecent(a: Conversation, b: Conversation): number {
  return (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0);
}

function pickUnreadConversations(conversations: Conversation[]): Conversation[] {
  return [...conversations]
    .filter((c) => (c.unreadCount ?? 0) > 0)
    .sort(sortByRecent)
    .slice(0, MAX_UNREAD_PREVIEW);
}

function formatCount(value: number): string {
  if (value > 999) return '999+';
  return String(value);
}

export function DashboardScreen() {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);
  const tokenData = useAuthStore((s) => s.tokenData);
  const clearToken = useAuthStore((s) => s.clearToken);
  const [loggingOut, setLoggingOut] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [snapshot, setSnapshot] = useState<HomeSnapshot | null>(null);
  const [unreadConversations, setUnreadConversations] = useState<Conversation[]>([]);
  const [alertSnapshot, setAlertSnapshot] = useState<HomeAlertSnapshot>(EMPTY_ALERT_SNAPSHOT);
  const navigation = useNavigation<HomeNav>();
  const insets = useSafeAreaInsets();

  const { hasWhatsAppAccess, whatsAppInitialArea, locationLabel, canSeeAdminQueue } = useMemo(() => {
    const role = tokenData?.role ?? '';
    const allottedKeys = getUserScopedLocationKeys(tokenData?.allotedArea);
    const hasAccess =
      isSuperAdminRole(role) ||
      hasFullLocationAccess(role) ||
      allottedKeys.length > 0;
    const areaKey =
      resolveDefaultLocationKey({
        role: tokenData?.role,
        allotedArea: tokenData?.allotedArea,
      }) ||
      allottedKeys[0] ||
      'athens';

    return {
      hasWhatsAppAccess: hasAccess,
      whatsAppInitialArea: areaKey,
      locationLabel: formatLocationLabel(areaKey),
      canSeeAdminQueue: isSuperAdminRole(role) || hasFullLocationAccess(role),
    };
  }, [tokenData?.role, tokenData?.allotedArea]);

  const displayName = (tokenData?.name ?? '').trim() || 'there';
  const firstName = displayName.split(/\s+/)[0] ?? displayName;
  const profilePhotoUri = useMemo(() => {
    if (!tokenData) return null;
    const raw =
      tokenData.profilePic ??
      tokenData.profilePhoto ??
      tokenData.avatar ??
      tokenData.photo;
    return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
  }, [tokenData]);

  const loadHomeData = useCallback(async () => {
    if (!hasWhatsAppAccess) {
      setSnapshot(null);
      setUnreadConversations([]);
      setAlertSnapshot(EMPTY_ALERT_SNAPSHOT);
      setLoading(false);
      return;
    }

    try {
      const [counts, conversationsResult, adminQueueResult] = await Promise.all([
        fetchConversationCounts(),
        fetchConversations({ locationFilter: 'all' }),
        canSeeAdminQueue
          ? fetchConversations({ adminQueue: true })
          : Promise.resolve({ conversations: [], hasMore: false, nextCursor: null }),
      ]);

      const conversations = conversationsResult.conversations;
      const unreadCount = conversations.reduce((sum, c) => sum + (c.unreadCount ?? 0), 0);
      const templateOnlyCount = conversations.filter((c) => c.templateOnly && !c.isSelf).length;
      const unreadPreview = pickUnreadConversations(conversations);

      setSnapshot({
        totalCount: counts.totalCount,
        ownerCount: counts.ownerCount,
        guestCount: counts.guestCount,
        archivedCount: counts.archivedCount ?? 0,
        unreadCount,
      });
      setUnreadConversations(unreadPreview);
      setAlertSnapshot({
        adminQueueCount: adminQueueResult.conversations.length,
        adminQueueHasMore: adminQueueResult.hasMore,
        templateOnlyCount,
      });
    } catch {
      setSnapshot((prev) => prev ?? EMPTY_SNAPSHOT);
      setUnreadConversations([]);
      setAlertSnapshot(EMPTY_ALERT_SNAPSHOT);
    } finally {
      setLoading(false);
    }
  }, [hasWhatsAppAccess, canSeeAdminQueue]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void loadHomeData();
    }, [loadHomeData]),
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadHomeData();
    setRefreshing(false);
  }, [loadHomeData]);

  const openInbox = useCallback(() => {
    if (!hasWhatsAppAccess) return;
    navigation.navigate('ChatApp', { screen: 'ConversationList', params: { initialArea: whatsAppInitialArea } });
  }, [hasWhatsAppAccess, navigation, whatsAppInitialArea]);

  const openAdminQueue = useCallback(() => {
    if (!hasWhatsAppAccess || !canSeeAdminQueue) return;
    navigation.navigate('ChatApp', {
      screen: 'ConversationList',
      params: { initialArea: whatsAppInitialArea, initialAdminQueue: true },
    });
  }, [canSeeAdminQueue, hasWhatsAppAccess, navigation, whatsAppInitialArea]);

  const openArchive = useCallback(() => {
    if (!hasWhatsAppAccess) return;
    navigation.navigate('ChatApp', {
      screen: 'ArchiveList',
      params: { defaultArea: whatsAppInitialArea },
    });
  }, [hasWhatsAppAccess, navigation, whatsAppInitialArea]);

  const visibleAlerts = useMemo((): HomeAlert[] => {
    const alerts: HomeAlert[] = [];

    if (canSeeAdminQueue && alertSnapshot.adminQueueCount > 0) {
      const countLabel = alertSnapshot.adminQueueHasMore
        ? `${alertSnapshot.adminQueueCount}+`
        : String(alertSnapshot.adminQueueCount);
      alerts.push({
        id: 'admin-queue',
        title: 'Unassigned conversations',
        subtitle: `${countLabel} waiting in the admin queue`,
        actionLabel: 'Review queue',
        icon: 'people-outline',
        tone: 'warning',
        onPress: openAdminQueue,
      });
    }

    if (alertSnapshot.templateOnlyCount > 0) {
      alerts.push({
        id: 'template-only',
        title: 'Window expired',
        subtitle: `${alertSnapshot.templateOnlyCount} chat${alertSnapshot.templateOnlyCount === 1 ? '' : 's'} need a template to reply`,
        actionLabel: 'View chats',
        icon: 'document-text-outline',
        tone: 'info',
        onPress: openInbox,
      });
    }

    return alerts;
  }, [alertSnapshot, canSeeAdminQueue, openAdminQueue, openInbox]);

  const openConversation = useCallback(
    (conversation: Conversation) => {
      navigation.navigate('ChatApp', {
        screen: 'ConversationDetail',
        params: {
          conversationId: conversation.id,
          area: resolveConversationArea(conversation, whatsAppInitialArea),
          conversationName: conversation.name,
          participantPhone: conversation.phone,
          isSelf: conversation.isSelf,
          templateOnly: conversation.templateOnly,
          windowExpiresAt: conversation.windowExpiresAt,
        },
      });
    },
    [navigation, whatsAppInitialArea],
  );

  const handleLogout = async () => {
    const token = tokenData?.token;
    if (!token) {
      await clearToken();
      return;
    }
    setLoggingOut(true);
    try {
      await employeeLogout(token);
    } catch {
      // Clear local session even if server request fails (e.g. offline)
    } finally {
      await clearToken();
      setLoggingOut(false);
    }
  };

  const unreadCount = snapshot?.unreadCount ?? 0;
  const archivedCount = snapshot?.archivedCount ?? 0;
  const greeting = getTimeGreeting();

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: Math.max(insets.top, 16), paddingBottom: Math.max(insets.bottom, 24) },
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          hasWhatsAppAccess ? (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void handleRefresh()}
              tintColor={colors.primary}
            />
          ) : undefined
        }
      >
        {/* Identity — human, not admin */}
        <View style={styles.header}>
          <View style={styles.headerMain}>
            <View style={styles.avatar}>
              {profilePhotoUri ? (
                <Image source={{ uri: profilePhotoUri }} style={styles.avatarImage} />
              ) : (
                <Text style={styles.avatarText}>{getInitials(displayName)}</Text>
              )}
            </View>
            <View style={styles.headerCopy}>
              <Text style={styles.greeting}>{greeting},</Text>
              <Text style={styles.displayName} numberOfLines={1}>
                {firstName}
              </Text>
              {hasWhatsAppAccess ? (
                <Text style={styles.locationContext} numberOfLines={1}>
                  {locationLabel}
                </Text>
              ) : (
                <Text style={styles.locationContext} numberOfLines={2}>
                  No inbox assigned yet
                </Text>
              )}
            </View>
          </View>
          <View style={styles.headerActions}>
            <ThemeToggleButton compact ghost />
            <Pressable
              onPress={handleLogout}
              disabled={loggingOut}
              accessibilityRole="button"
              accessibilityLabel="Log out"
              hitSlop={8}
              style={({ pressed }) => [
                styles.iconButton,
                pressed && !loggingOut ? styles.pressed : null,
                loggingOut ? styles.disabled : null,
              ]}
            >
              {loggingOut ? (
                <ActivityIndicator size="small" color={colors.textMuted} />
              ) : (
                <Ionicons name="log-out-outline" size={20} color={colors.textMuted} />
              )}
            </Pressable>
          </View>
        </View>

        {/* Primary action — inbox entry */}
        <Pressable
          onPress={openInbox}
          disabled={!hasWhatsAppAccess}
          accessibilityRole="button"
          accessibilityLabel={
            hasWhatsAppAccess
              ? `Open messages${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`
              : 'No inbox access assigned'
          }
          style={({ pressed }) => [
            styles.inboxEntry,
            !hasWhatsAppAccess && styles.inboxEntryDisabled,
            pressed && hasWhatsAppAccess ? styles.pressed : null,
          ]}
        >
          <View style={styles.inboxEntryIcon}>
            <Ionicons
              name={hasWhatsAppAccess ? 'chatbubbles-outline' : 'lock-closed-outline'}
              size={22}
              color={hasWhatsAppAccess ? colors.primary : colors.textMuted}
            />
          </View>
          <View style={styles.inboxEntryBody}>
            <Text style={styles.inboxEntryTitle}>Messages</Text>
            <Text style={styles.inboxEntrySubtitle} numberOfLines={1}>
              {hasWhatsAppAccess
                ? loading
                  ? 'Loading your inbox…'
                  : unreadCount > 0
                    ? `${formatCount(unreadCount)} waiting for you`
                    : 'All caught up'
                : 'Ask an admin to assign your area'}
            </Text>
          </View>
          {hasWhatsAppAccess && unreadCount > 0 && !loading ? (
            <View style={styles.inboxUnreadPill}>
              <Text style={styles.inboxUnreadPillText}>{formatCount(unreadCount)}</Text>
            </View>
          ) : null}
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </Pressable>

        {/* Operational alerts — actions, not stats */}
        {hasWhatsAppAccess && visibleAlerts.length > 0 ? (
          <View style={styles.alertStack}>
            {visibleAlerts.map((alert) => (
              <HomeAlertCard key={alert.id} alert={alert} styles={styles} colors={colors} />
            ))}
          </View>
        ) : null}

        {/* Secondary shortcuts — only when meaningful */}
        {hasWhatsAppAccess && !loading && archivedCount > 0 ? (
          <Pressable
            onPress={openArchive}
            accessibilityRole="button"
            accessibilityLabel={`Open archived conversations, ${archivedCount} archived`}
            style={({ pressed }) => [styles.shortcutRow, pressed && styles.pressed]}
          >
            <Ionicons name="archive-outline" size={18} color={colors.textSecondary} />
            <Text style={styles.shortcutLabel}>Archived</Text>
            <Text style={styles.shortcutMeta}>{formatCount(archivedCount)}</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </Pressable>
        ) : null}

        {/* Waiting on you — unread-first */}
        {hasWhatsAppAccess && (loading || unreadConversations.length > 0) ? (
          <View style={styles.section}>
            <SectionHeader
              title="Waiting on you"
              actionLabel={unreadCount > MAX_UNREAD_PREVIEW ? 'See all' : undefined}
              onAction={unreadCount > MAX_UNREAD_PREVIEW ? openInbox : undefined}
              styles={styles}
              colors={colors}
            />
            <View style={styles.conversationList}>
              {loading
                ? [0, 1].map((i) => <ConversationSkeleton key={i} styles={styles} isLast={i === 1} />)
                : unreadConversations.map((conversation, index) => (
                    <ConversationRow
                      key={conversation.id}
                      conversation={conversation}
                      styles={styles}
                      colors={colors}
                      isLast={index === unreadConversations.length - 1}
                      emphasizeUnread
                      onPress={() => openConversation(conversation)}
                    />
                  ))}
            </View>
          </View>
        ) : null}

        {!hasWhatsAppAccess ? (
          <View style={styles.noAccessBlock}>
            <Ionicons name="chatbubble-ellipses-outline" size={32} color={colors.textMuted} />
            <Text style={styles.noAccessTitle}>Your inbox isn&apos;t ready</Text>
            <Text style={styles.noAccessBody}>
              Once an admin assigns your area, conversations will appear here.
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function SectionHeader({
  title,
  actionLabel,
  onAction,
  styles,
  colors,
}: {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  styles: ReturnType<typeof createStyles>;
  colors: AppColors;
}) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          style={({ pressed }) => [styles.sectionAction, pressed && styles.pressed]}
        >
          <Text style={styles.sectionActionText}>{actionLabel}</Text>
          <Ionicons name="chevron-forward" size={14} color={colors.primary} />
        </Pressable>
      ) : null}
    </View>
  );
}

function HomeAlertCard({
  alert,
  styles,
  colors,
}: {
  alert: HomeAlert;
  styles: ReturnType<typeof createStyles>;
  colors: AppColors;
}) {
  const tint = alert.tone === 'warning' ? colors.warning : colors.info;
  const bg = alert.tone === 'warning' ? `${colors.warning}18` : `${colors.info}14`;

  return (
    <Pressable
      onPress={alert.onPress}
      accessibilityRole="button"
      accessibilityLabel={`${alert.title}. ${alert.subtitle}. ${alert.actionLabel}`}
      style={({ pressed }) => [styles.alertCard, { backgroundColor: bg }, pressed && styles.pressed]}
    >
      <View style={[styles.alertIconWrap, { backgroundColor: `${tint}22` }]}>
        <Ionicons name={alert.icon} size={18} color={tint} />
      </View>
      <View style={styles.alertCopy}>
        <Text style={styles.alertTitle}>{alert.title}</Text>
        <Text style={styles.alertSubtitle} numberOfLines={2}>
          {alert.subtitle}
        </Text>
      </View>
      <View style={styles.alertCta}>
        <Text style={[styles.alertCtaText, { color: colors.primary }]}>{alert.actionLabel}</Text>
        <Ionicons name="arrow-forward" size={14} color={colors.primary} />
      </View>
    </Pressable>
  );
}

function ConversationSkeleton({
  styles,
  isLast,
}: {
  styles: ReturnType<typeof createStyles>;
  isLast: boolean;
}) {
  return (
    <View>
      <View style={styles.conversationRow}>
        <View style={styles.skeletonAvatar} />
        <View style={styles.skeletonBody}>
          <View style={[styles.skeletonLine, { width: '38%' }]} />
          <View style={[styles.skeletonLine, { width: '72%', marginTop: 10 }]} />
        </View>
      </View>
      {!isLast ? <View style={styles.rowDivider} /> : null}
    </View>
  );
}

function ConversationRow({
  conversation,
  styles,
  colors,
  isLast,
  emphasizeUnread = false,
  onPress,
}: {
  conversation: Conversation;
  styles: ReturnType<typeof createStyles>;
  colors: AppColors;
  isLast: boolean;
  emphasizeUnread?: boolean;
  onPress: () => void;
}) {
  const avatarUri = conversation.participantProfilePic ?? conversation.avatar;
  const unread = conversation.unreadCount ?? 0;
  const showUnread = unread > 0 || emphasizeUnread;

  return (
    <View>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`Open conversation with ${conversation.name}${unread > 0 ? `, ${unread} unread` : ''}`}
        style={({ pressed }) => [styles.conversationRow, pressed && styles.pressed]}
      >
        <View style={styles.conversationAvatar}>
          {avatarUri ? (
            <Image source={{ uri: avatarUri }} style={styles.conversationAvatarImage} />
          ) : (
            <Text style={styles.conversationAvatarText}>{getInitials(conversation.name)}</Text>
          )}
          {showUnread && unread > 0 ? <View style={styles.unreadDot} /> : null}
        </View>

        <View style={styles.conversationBody}>
          <View style={styles.conversationTop}>
            <Text
              style={[styles.conversationName, showUnread && styles.conversationNameUnread]}
              numberOfLines={1}
            >
              {conversation.name}
            </Text>
            <Text style={styles.conversationDate}>{formatListDate(conversation.lastMessageAt)}</Text>
          </View>
          <View style={styles.conversationBottom}>
            <Text
              style={[styles.conversationPreview, showUnread && styles.conversationPreviewUnread]}
              numberOfLines={1}
            >
              {conversation.lastMessage?.trim() || 'No messages yet'}
            </Text>
            {unread > 0 ? (
              <View style={styles.unreadBadge}>
                <Text style={styles.unreadBadgeText}>{unread > 99 ? '99+' : unread}</Text>
              </View>
            ) : null}
          </View>
        </View>
      </Pressable>
      {!isLast ? <View style={styles.rowDivider} /> : null}
    </View>
  );
}

function createStyles(colors: AppColors, isDark: boolean) {
  const pressTint = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)';
  const skeleton = isDark ? 'rgba(255,255,255,0.06)' : '#ECEEF0';
  const avatarFill = isDark ? 'rgba(255,255,255,0.08)' : '#ECEEF0';
  const inboxSurface = isDark ? colors.surface : colors.backgroundSecondary;

  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      paddingHorizontal: SCREEN_PADDING,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      marginBottom: 28,
      gap: 12,
    },
    headerMain: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      minWidth: 0,
    },
    avatar: {
      width: 52,
      height: 52,
      borderRadius: 26,
      backgroundColor: avatarFill,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    avatarImage: {
      width: 52,
      height: 52,
    },
    avatarText: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.textSecondary,
      letterSpacing: 0.2,
    },
    headerCopy: {
      flex: 1,
      minWidth: 0,
      gap: 1,
    },
    greeting: {
      fontSize: 15,
      fontWeight: '400',
      color: colors.textMuted,
      lineHeight: 20,
    },
    displayName: {
      fontSize: 26,
      fontWeight: '700',
      color: colors.text,
      letterSpacing: -0.6,
      lineHeight: 32,
    },
    locationContext: {
      fontSize: 14,
      fontWeight: '400',
      color: colors.textSecondary,
      lineHeight: 20,
      marginTop: 2,
    },
    headerActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
      marginTop: 4,
    },
    iconButton: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pressed: {
      backgroundColor: pressTint,
    },
    disabled: {
      opacity: 0.5,
    },
    inboxEntry: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      minHeight: 72,
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderRadius: 16,
      backgroundColor: inboxSurface,
      marginBottom: 20,
    },
    inboxEntryDisabled: {
      opacity: 0.55,
    },
    inboxEntryIcon: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: isDark ? 'rgba(37,211,102,0.12)' : colors.primaryLight,
      alignItems: 'center',
      justifyContent: 'center',
    },
    inboxEntryBody: {
      flex: 1,
      minWidth: 0,
      gap: 2,
    },
    inboxEntryTitle: {
      fontSize: 17,
      fontWeight: '600',
      color: colors.text,
      letterSpacing: -0.2,
      lineHeight: 22,
    },
    inboxEntrySubtitle: {
      fontSize: 14,
      fontWeight: '400',
      color: colors.textSecondary,
      lineHeight: 20,
    },
    inboxUnreadPill: {
      backgroundColor: colors.primary,
      minWidth: 28,
      height: 28,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 8,
    },
    inboxUnreadPillText: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.onPrimary,
      fontVariant: ['tabular-nums'],
    },
    alertStack: {
      gap: 10,
      marginBottom: 20,
    },
    alertCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 14,
      paddingVertical: 14,
      borderRadius: 14,
    },
    alertIconWrap: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    alertCopy: {
      flex: 1,
      minWidth: 0,
      gap: 2,
    },
    alertTitle: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.text,
      lineHeight: 20,
    },
    alertSubtitle: {
      fontSize: 13,
      fontWeight: '400',
      color: colors.textSecondary,
      lineHeight: 18,
    },
    alertCta: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
      flexShrink: 0,
    },
    alertCtaText: {
      fontSize: 13,
      fontWeight: '600',
      lineHeight: 18,
    },
    shortcutRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      minHeight: 48,
      paddingVertical: 10,
      marginBottom: 8,
      borderRadius: 10,
    },
    shortcutLabel: {
      flex: 1,
      fontSize: 15,
      fontWeight: '500',
      color: colors.text,
      lineHeight: 20,
    },
    shortcutMeta: {
      fontSize: 14,
      fontWeight: '500',
      color: colors.textMuted,
      fontVariant: ['tabular-nums'],
    },
    section: {
      marginTop: 8,
      marginBottom: 12,
    },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      minHeight: 36,
      marginBottom: 4,
      gap: 12,
    },
    sectionTitle: {
      flex: 1,
      fontSize: 13,
      fontWeight: '600',
      color: colors.textMuted,
      letterSpacing: 0.6,
      textTransform: 'uppercase',
      lineHeight: 18,
    },
    sectionAction: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
      minHeight: 44,
      justifyContent: 'center',
    },
    sectionActionText: {
      fontSize: 14,
      fontWeight: '500',
      lineHeight: 20,
      color: colors.primary,
    },
    conversationList: {},
    conversationRow: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 72,
      paddingVertical: 12,
      borderRadius: 12,
    },
    rowDivider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
      marginLeft: ROW_DIVIDER_INSET,
    },
    conversationAvatar: {
      width: 52,
      height: 52,
      borderRadius: 26,
      backgroundColor: colors.backgroundSecondary,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 14,
      overflow: 'visible',
    },
    conversationAvatarImage: {
      width: 52,
      height: 52,
      borderRadius: 26,
      resizeMode: 'cover',
    },
    conversationAvatarText: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    unreadDot: {
      position: 'absolute',
      top: 0,
      right: 0,
      width: 12,
      height: 12,
      borderRadius: 6,
      backgroundColor: colors.primary,
      borderWidth: 2,
      borderColor: colors.background,
    },
    conversationBody: {
      flex: 1,
      minWidth: 0,
    },
    conversationTop: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 3,
      gap: 8,
    },
    conversationName: {
      flex: 1,
      fontSize: 17,
      fontWeight: '500',
      color: colors.text,
      letterSpacing: -0.2,
      lineHeight: 22,
      minWidth: 0,
    },
    conversationNameUnread: {
      fontWeight: '600',
    },
    conversationDate: {
      fontSize: 12,
      fontWeight: '400',
      color: colors.textMuted,
      lineHeight: 16,
    },
    conversationBottom: {
      flexDirection: 'row',
      alignItems: 'center',
      minWidth: 0,
    },
    conversationPreview: {
      flex: 1,
      fontSize: 15,
      fontWeight: '400',
      color: colors.textSecondary,
      lineHeight: 20,
      minWidth: 0,
    },
    conversationPreviewUnread: {
      color: colors.text,
      fontWeight: '500',
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
    unreadBadgeText: {
      fontSize: 12,
      fontWeight: '700',
      lineHeight: 16,
      color: colors.onPrimary,
      fontVariant: ['tabular-nums'],
    },
    skeletonAvatar: {
      width: 52,
      height: 52,
      borderRadius: 26,
      backgroundColor: skeleton,
      marginRight: 14,
    },
    skeletonBody: {
      flex: 1,
    },
    skeletonLine: {
      height: 10,
      borderRadius: 5,
      backgroundColor: skeleton,
    },
    noAccessBlock: {
      alignItems: 'center',
      paddingVertical: 48,
      paddingHorizontal: 16,
      gap: 10,
    },
    noAccessTitle: {
      fontSize: 18,
      fontWeight: '600',
      color: colors.text,
      textAlign: 'center',
      lineHeight: 24,
    },
    noAccessBody: {
      fontSize: 15,
      lineHeight: 22,
      color: colors.textSecondary,
      textAlign: 'center',
    },
  });
}
