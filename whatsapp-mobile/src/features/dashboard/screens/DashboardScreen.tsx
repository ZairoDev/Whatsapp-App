import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  ScrollView,
  Platform,
} from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { useAuthStore } from '../../../features/auth/auth.store';
import { employeeLogout } from '../../../features/auth/services/auth.api';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../../core/navigation/RootNavigator';
import type { AppColors } from '../../../theme/palettes';
import { useTheme } from '../../../theme/ThemeContext';
import { ThemeToggleButton } from '../../../theme/ThemeToggleButton';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  getUserScopedLocationKeys,
  hasFullLocationAccess,
  isSuperAdminRole,
} from '../../chat/utils/locations';
import { NotificationStatusCard } from '../components/NotificationStatusCard';

type DashboardNav = NativeStackNavigationProp<RootStackParamList, 'Main'>;

export function DashboardScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const tokenData = useAuthStore((s) => s.tokenData);
  const clearToken = useAuthStore((s) => s.clearToken);
  const [loggingOut, setLoggingOut] = useState(false);
  const navigation = useNavigation<DashboardNav>();
  const insets = useSafeAreaInsets();
  const { hasWhatsAppAccess, whatsAppInitialArea } = useMemo(() => {
    const role = tokenData?.role ?? '';
    const allottedKeys = getUserScopedLocationKeys(tokenData?.allotedArea);
    const hasAccess =
      isSuperAdminRole(role) ||
      hasFullLocationAccess(role) ||
      allottedKeys.length > 0;

    return {
      hasWhatsAppAccess: hasAccess,
      whatsAppInitialArea: allottedKeys[0] ?? 'athens',
    };
  }, [tokenData?.role, tokenData?.allotedArea]);

  const displayName = (tokenData?.name ?? '').trim() || 'there';
  const roleLabel = (tokenData?.role ?? '').toString().trim();

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

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: Math.max(insets.top, 12), paddingBottom: Math.max(insets.bottom, 16) },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerRow}>
          <View style={styles.headerText}>
            <Text style={styles.kicker}>Dashboard</Text>
            <View style={styles.titleRow}>
              <Text style={styles.title}>Hi, {displayName}</Text>
              {!!roleLabel && (
                <View style={styles.rolePill} accessibilityLabel={`Role ${roleLabel}`}>
                  <Text style={styles.rolePillText}>{roleLabel}</Text>
                </View>
              )}
            </View>
            <Text style={styles.subtitle}>
              {hasWhatsAppAccess
                ? 'Open WhatsApp to manage your conversations.'
                : 'No workspaces assigned yet.'}
            </Text>
          </View>

          <View style={styles.headerActions}>
            <ThemeToggleButton compact />
            <Pressable
              onPress={handleLogout}
              disabled={loggingOut}
              accessibilityRole="button"
              accessibilityLabel="Log out"
              hitSlop={12}
              style={({ pressed }) => [
                styles.iconButton,
                pressed && !loggingOut ? styles.pressed : null,
                loggingOut ? styles.disabled : null,
              ]}
            >
              {loggingOut ? (
                <ActivityIndicator size="small" color={colors.textSecondary} />
              ) : (
                <FontAwesome name="sign-out" size={18} color={colors.textSecondary} />
              )}
            </Pressable>
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Your workspaces</Text>
            <Text style={styles.sectionMeta}>Tap to open</Text>
          </View>

          <View style={styles.cardsGrid}>
            {hasWhatsAppAccess ? (
              <WorkspaceCard
                styles={styles}
                colors={colors}
                title="WhatsApp"
                subtitle="Chats and conversations"
                onPress={() =>
                  navigation.navigate('ChatApp', { initialArea: whatsAppInitialArea })
                }
              />
            ) : (
              <View style={styles.emptyCard} accessibilityLabel="No workspaces available">
                <View style={styles.emptyIcon}>
                  <FontAwesome name="lock" size={16} color={colors.textMuted} />
                </View>
                <Text style={styles.emptyTitle}>No access yet</Text>
                <Text style={styles.emptySubtitle}>
                  Ask an admin to assign you an area to start managing chats.
                </Text>
              </View>
            )}

            <ComingSoonCard styles={styles} colors={colors} />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Device</Text>
          <NotificationStatusCard />
        </View>
      </ScrollView>
    </View>
  );
}

function WorkspaceCard({
  styles,
  colors,
  title,
  subtitle,
  onPress,
}: {
  styles: ReturnType<typeof createStyles>;
  colors: AppColors;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open ${title} workspace`}
      android_ripple={{ color: colors.overlay }}
      style={({ pressed }) => [styles.card, pressed && Platform.OS === 'ios' ? styles.cardPressed : null]}
    >
      <View style={styles.cardTop}>
        <View style={styles.cardIcon}>
          <FontAwesome name="whatsapp" size={18} color={colors.primary} />
        </View>
        <FontAwesome name="chevron-right" size={14} color={colors.textMuted} />
      </View>

      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.cardSubtitle}>{subtitle}</Text>
    </Pressable>
  );
}

function ComingSoonCard({
  styles,
  colors,
}: {
  styles: ReturnType<typeof createStyles>;
  colors: AppColors;
}) {
  return (
    <View style={[styles.card, styles.cardDisabled]} accessibilityRole="text" accessibilityLabel="Coming soon">
      <View style={styles.cardTop}>
        <View style={[styles.cardIcon, styles.cardIconMuted]}>
          <FontAwesome name="clock-o" size={18} color={colors.textMuted} />
        </View>
      </View>

      <Text style={[styles.cardTitle, styles.cardTitleMuted]}>Coming soon</Text>
      <Text style={styles.cardSubtitle}>More tools on the way</Text>
    </View>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: colors.backgroundSecondary,
    },
    content: {
      paddingHorizontal: 18,
      gap: 18,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 12,
    },
    headerText: {
      flex: 1,
      gap: 6,
    },
    headerActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    kicker: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.textMuted,
      letterSpacing: 0.7,
      textTransform: 'uppercase',
    },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      flexWrap: 'wrap',
    },
    title: {
      fontSize: 28,
      fontWeight: '800',
      color: colors.text,
      letterSpacing: -0.3,
    },
    rolePill: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      backgroundColor: colors.primaryLight,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: 'rgba(18, 140, 126, 0.14)',
    },
    rolePillText: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.primaryDark,
      textTransform: 'capitalize',
    },
    subtitle: {
      fontSize: 14,
      color: colors.textSecondary,
      lineHeight: 20,
    },
    iconButton: {
      height: 44,
      width: 44,
      borderRadius: 14,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      ...Platform.select({
        ios: {
          shadowColor: colors.shadow,
          shadowOpacity: 0.06,
          shadowRadius: 14,
          shadowOffset: { width: 0, height: 6 },
        },
        android: { elevation: 2 },
      }),
    },
    pressed: {
      opacity: 0.78,
    },
    disabled: {
      opacity: 0.65,
    },
    section: {
      gap: 12,
    },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      gap: 10,
    },
    sectionTitle: {
      fontSize: 16,
      fontWeight: '800',
      color: colors.text,
      letterSpacing: -0.1,
    },
    sectionMeta: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.textMuted,
    },
    cardsGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 12,
    },
    card: {
      width: '48%',
      minWidth: 160,
      padding: 14,
      backgroundColor: colors.surface,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      ...Platform.select({
        ios: {
          shadowColor: colors.shadow,
          shadowOpacity: 0.06,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 10 },
        },
        android: { elevation: 2 },
      }),
    },
    cardPressed: {
      transform: [{ scale: 0.99 }],
      opacity: 0.92,
    },
    cardDisabled: {
      opacity: 0.72,
      backgroundColor: colors.backgroundSecondary,
    },
    cardIconMuted: {
      backgroundColor: colors.backgroundSecondary,
      borderColor: colors.border,
    },
    cardTitleMuted: {
      color: colors.textSecondary,
    },
    cardTop: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 10,
    },
    cardIcon: {
      height: 36,
      width: 36,
      borderRadius: 12,
      backgroundColor: 'rgba(37, 211, 102, 0.12)',
      borderWidth: 1,
      borderColor: 'rgba(37, 211, 102, 0.18)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    cardTitle: {
      fontSize: 16,
      fontWeight: '800',
      color: colors.text,
      letterSpacing: -0.1,
      marginBottom: 4,
    },
    cardSubtitle: {
      fontSize: 13,
      color: colors.textSecondary,
      lineHeight: 18,
    },
    emptyCard: {
      width: '100%',
      padding: 16,
      backgroundColor: colors.surface,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      gap: 8,
      ...Platform.select({
        ios: {
          shadowColor: colors.shadow,
          shadowOpacity: 0.05,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 10 },
        },
        android: { elevation: 1 },
      }),
    },
    emptyIcon: {
      height: 40,
      width: 40,
      borderRadius: 14,
      backgroundColor: colors.backgroundSecondary,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
    },
    emptyTitle: {
      fontSize: 15,
      fontWeight: '800',
      color: colors.text,
    },
    emptySubtitle: {
      fontSize: 13,
      color: colors.textSecondary,
      lineHeight: 18,
    },
  });
}
