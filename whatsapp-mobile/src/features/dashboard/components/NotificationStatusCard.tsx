import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Platform } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import * as TokenManager from '../../../notifications/TokenManager';
import api from '../../../services/api';
import { useTheme } from '../../../theme/ThemeContext';
import type { AppColors } from '../../../theme/palettes';

type TestState = 'idle' | 'sending' | 'sent' | 'error';

/**
 * Live push-notification diagnostics.
 *
 * Surfaces the exact registration state on-device so push issues are never a
 * guessing game: shows whether a token registered, lets the user retry, and
 * sends a real test notification through the backend (`POST /push/test`).
 */
export function NotificationStatusCard() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [info, setInfo] = useState<TokenManager.PushDebugInfo>(() => TokenManager.getDebugInfo());
  const [busy, setBusy] = useState(false);
  const [testState, setTestState] = useState<TestState>('idle');
  const [testMessage, setTestMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      await TokenManager.initialize();
    } finally {
      setInfo(TokenManager.getDebugInfo());
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleRetry = useCallback(async () => {
    setBusy(true);
    setTestState('idle');
    setTestMessage(null);
    try {
      await TokenManager.reregister();
    } finally {
      setInfo(TokenManager.getDebugInfo());
      setBusy(false);
    }
  }, []);

  const handleSendTest = useCallback(async () => {
    setTestState('sending');
    setTestMessage(null);
    try {
      const res = await api.post('/push/test');
      const data = res.data ?? {};
      if (data.success) {
        setTestState('sent');
        setTestMessage(
          data.message ?? 'Test sent — you should receive a notification within a few seconds.',
        );
      } else {
        setTestState('error');
        setTestMessage(data.message ?? data.error ?? 'Test could not be delivered.');
      }
    } catch (e: any) {
      setTestState('error');
      const status = e?.response?.status;
      const data = e?.response?.data;
      const serverMsg = data?.message ?? data?.error;
      // A deployed endpoint returns 404 with a body (e.g. NO_DEVICE_TOKENS);
      // a missing route returns 404 with no JSON body.
      setTestMessage(
        status === 404 && !data
          ? 'Test endpoint not available on the server yet (deploy /api/push/test).'
          : serverMsg ?? e?.message ?? 'Could not reach the server.',
      );
    }
  }, []);

  const view = describe(info, busy, colors);

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <View style={[styles.iconWrap, { backgroundColor: view.tint }]}>
          <FontAwesome name={view.icon as any} size={16} color={view.color} />
        </View>
        <View style={styles.headerText}>
          <Text style={styles.title}>Notifications</Text>
          <Text style={[styles.status, { color: view.color }]}>{view.label}</Text>
        </View>
        <Pressable
          onPress={handleRetry}
          disabled={busy}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Retry notification setup"
          style={({ pressed }) => [styles.retryBtn, pressed && !busy ? styles.pressed : null]}
        >
          {busy ? (
            <ActivityIndicator size="small" color={colors.textSecondary} />
          ) : (
            <FontAwesome name="refresh" size={14} color={colors.textSecondary} />
          )}
        </Pressable>
      </View>

      <Text style={styles.detail}>{view.detail}</Text>

      {info.status === 'ok' && (
        <Pressable
          onPress={handleSendTest}
          disabled={testState === 'sending'}
          accessibilityRole="button"
          accessibilityLabel="Send a test notification"
          style={({ pressed }) => [
            styles.testBtn,
            pressed && testState !== 'sending' ? styles.pressed : null,
          ]}
        >
          {testState === 'sending' ? (
            <ActivityIndicator size="small" color={colors.primaryDark} />
          ) : (
            <FontAwesome name="paper-plane" size={13} color={colors.primaryDark} />
          )}
          <Text style={styles.testBtnText}>
            {testState === 'sending' ? 'Sending…' : 'Send test notification'}
          </Text>
        </Pressable>
      )}

      {!!testMessage && (
        <Text
          style={[
            styles.testMessage,
            { color: testState === 'error' ? colors.error : colors.primaryDark },
          ]}
        >
          {testMessage}
        </Text>
      )}
    </View>
  );
}

function describe(info: TokenManager.PushDebugInfo, busy: boolean, colors: AppColors) {
  if (busy && info.status == null) {
    return {
      icon: 'circle-o-notch',
      color: colors.textSecondary,
      tint: colors.backgroundSecondary,
      label: 'Checking…',
      detail: 'Verifying notification setup for this device.',
    };
  }

  if (!info.isPhysicalDevice) {
    return {
      icon: 'exclamation-triangle',
      color: colors.warning,
      tint: 'rgba(251,188,5,0.12)',
      label: 'Not available on emulator',
      detail:
        'Push notifications only work on a real phone. Install the app on a physical device, log in, and allow notifications.',
    };
  }

  switch (info.status) {
    case 'ok':
      return {
        icon: 'check-circle',
        color: colors.success,
        tint: 'rgba(37,211,102,0.12)',
        label: 'Active',
        detail: 'This device is registered to receive notifications.',
      };
    case 'denied':
      return {
        icon: 'bell-slash',
        color: colors.error,
        tint: 'rgba(234,67,53,0.10)',
        label: 'Permission off',
        detail: 'Enable notifications in Settings → this app → Notifications, then tap retry.',
      };
    case 'error':
      return {
        icon: 'times-circle',
        color: colors.error,
        tint: 'rgba(234,67,53,0.10)',
        label: 'Setup error',
        detail: 'Could not register for notifications. Tap retry, or reinstall the latest build.',
      };
    case 'unavailable':
      return {
        icon: 'exclamation-triangle',
        color: colors.warning,
        tint: 'rgba(251,188,5,0.12)',
        label: 'Not available',
        detail: 'Push notifications require a physical device.',
      };
    default:
      return {
        icon: 'bell',
        color: colors.textSecondary,
        tint: colors.backgroundSecondary,
        label: 'Not set up yet',
        detail: 'Tap retry to register this device for notifications.',
      };
  }
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
  card: {
    width: '100%',
    padding: 14,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 10,
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconWrap: {
    height: 36,
    width: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.text,
  },
  status: {
    fontSize: 13,
    fontWeight: '700',
  },
  retryBtn: {
    height: 36,
    width: 36,
    borderRadius: 12,
    backgroundColor: colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
  detail: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  testBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: colors.primaryLight,
    borderWidth: 1,
    borderColor: 'rgba(18,140,126,0.18)',
  },
  testBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.primaryDark,
  },
  testMessage: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
  },
  });
}
