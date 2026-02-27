import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { useAuthStore } from '../../../features/auth/auth.store';
import { employeeLogout } from '../../../features/auth/services/auth.api';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../../core/navigation/RootNavigator';
import { colors } from '../../../theme/colors';

type DashboardNav = NativeStackNavigationProp<RootStackParamList, 'Main'>;

export function DashboardScreen() {
  const tokenData = useAuthStore((s) => s.tokenData);
  const clearToken = useAuthStore((s) => s.clearToken);
  const [loggingOut, setLoggingOut] = useState(false);
  const navigation = useNavigation<DashboardNav>();
  const { canSeeAthens, canSeeThessaloniki } = useMemo(() => {
    const role = tokenData?.role ?? '';
    const areas = tokenData?.allotedArea ?? [];
    const lowerAreas = areas.map((a) => a.toLowerCase());
    const isSuperAdmin = role.toLowerCase().includes('super');

    return {
      canSeeAthens: isSuperAdmin || lowerAreas.includes('athens'),
      canSeeThessaloniki: isSuperAdmin || lowerAreas.includes('thessaloniki'),
    };
  }, [tokenData?.role, tokenData?.allotedArea]);

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
    <View style={styles.container}>
      <Text style={styles.title}>Dashboard</Text>

      <View style={styles.appsRow}>
        {canSeeAthens && (
          <TouchableOpacity
            style={styles.appCard}
            activeOpacity={0.9}
            onPress={() => navigation.navigate('ChatApp', { initialArea: 'athens' })}
          >
            <View style={styles.appHeader}>
              <FontAwesome name="whatsapp" size={24} color={colors.primary} />
              <Text style={styles.appTitle}>WhatsApp Athens</Text>
            </View>
            <Text style={styles.appSubtitle}>Manage Athens chats and routes</Text>
          </TouchableOpacity>
        )}

        {canSeeThessaloniki && (
          <TouchableOpacity
            style={styles.appCard}
            activeOpacity={0.9}
            onPress={() => navigation.navigate('ChatApp', { initialArea: 'thessaloniki' })}
          >
            <View style={styles.appHeader}>
              <FontAwesome name="whatsapp" size={24} color={colors.primary} />
              <Text style={styles.appTitle}>WhatsApp Thessaloniki</Text>
            </View>
            <Text style={styles.appSubtitle}>Manage Thessaloniki chats and routes</Text>
          </TouchableOpacity>
        )}
      </View>

      <TouchableOpacity
        style={[styles.logoutButton, loggingOut && styles.logoutButtonDisabled]}
        onPress={handleLogout}
        disabled={loggingOut}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel="Log out"
      >
        {loggingOut ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Text style={styles.logoutText}>Log out</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
    gap: 32,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.text,
  },
  appsRow: {
    flexDirection: 'row',
    gap: 16,
    paddingHorizontal: 24,
  },
  appCard: {
    flex: 1,
    minWidth: 150,
    maxWidth: 200,
    paddingVertical: 16,
    paddingHorizontal: 14,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  appHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  appTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 4,
  },
  appSubtitle: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  logoutButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: colors.error,
    borderRadius: 10,
    minWidth: 120,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoutButtonDisabled: {
    opacity: 0.7,
  },
  logoutText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
});