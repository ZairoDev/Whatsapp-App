import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, AppStateStatus, StyleSheet, Text, View, ActivityIndicator } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuthStore } from '../../features/auth/auth.store';
import { LoginScreen, VerifyOtpScreen } from '../../features/auth/screens';
import { DashboardScreen } from '../../features/dashboard/screens/DashboardScreen';
import { ChatAppStack } from './ChatAppStack';
import { colors } from '../../theme/colors';
import api from '../../services/api';
import { connectSocket, disconnectSocket } from '../../services';
import * as TokenManager from '../../notifications/TokenManager';
import { navigationRef } from './navigationRef';
import {
  initNotificationHandlers,
  handleLastNotificationResponse,
  onNavigationReady,
} from '../../notifications/notificationHandler';
import { useInAppBannerStore } from '../../notifications/inAppBannerStore';
import { useIncomingWhatsAppCall } from '../../features/chat/hooks/useIncomingWhatsAppCall';
import { IncomingCallOverlay } from '../../features/chat/components/IncomingCallOverlay';

// ── Types ─────────────────────────────────────────────────────────────────────

export type AuthStackParamList = {
  Login: undefined;
  VerifyOtp: { email: string };
};

export type RootStackParamList = {
  Main: undefined;
  ChatApp: { initialArea?: string } | undefined;
};

const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const MainStack = createNativeStackNavigator<RootStackParamList>();

// ── Sub-components ────────────────────────────────────────────────────────────

function AuthNavigator() {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="Login" component={LoginScreen} />
      <AuthStack.Screen name="VerifyOtp" component={VerifyOtpScreen} />
    </AuthStack.Navigator>
  );
}

function LoadingScreen() {
  return (
    <View style={styles.loading}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={styles.loadingText}>Loading...</Text>
    </View>
  );
}

async function validateStoredToken(): Promise<boolean> {
  try {
    // Phone configs is a lightweight auth probe that does not require channel/Meta context.
    // Templates without conversationId now return 200 + empty list (not an auth signal).
    await api.get('/whatsapp/phone-configs');
    return true;
  } catch (err: any) {
    if (err?.isNetworkError) return true;
    const status: number | undefined = err?.response?.status;
    const msg: string =
      err?.response?.data?.error ?? err?.response?.data?.message ?? err?.message ?? '';
    const lower = (msg || '').toLowerCase();
    const looksLikeJwtAuthFailure =
      (status === 401 || status === 403) &&
      (lower.includes('jwt') ||
        lower.includes('token expired') ||
        lower.includes('invalid token') ||
        lower.includes('unauthorized') ||
        lower.includes('not authorized') ||
        lower.includes('session expired'));
    if (looksLikeJwtAuthFailure) {
      await useAuthStore.getState().markSessionExpired();
      return false;
    }
    return true;
  }
}

function IncomingCallGate() {
  const { phase, incomingCall, error, acceptCall, declineCall, endCall } =
    useIncomingWhatsAppCall();
  return (
    <IncomingCallOverlay
      visible={phase !== 'idle'}
      phase={phase}
      callerNumber={incomingCall?.from}
      error={error}
      onAccept={() => { void acceptCall(); }}
      onDecline={() => { void declineCall(); }}
      onEndCall={() => { void endCall(); }}
    />
  );
}

// ── Push registration helper ──────────────────────────────────────────────────

/** Avoid showing the same push alert on every foreground resume. */
let _pushConfigAlertShown = false;
let _pushServerErrorAlertShown = false;

/**
 * Run TokenManager.initialize() and surface meaningful feedback to the user.
 *
 * Called:
 *  (a) On every authenticated login/resume.
 *  (b) Whenever the app returns to the foreground AND the last attempt was
 *      not successful — this is the critical retry path for users who grant
 *      permission from the device Settings screen and then return to the app.
 */
async function runTokenRegistration(): Promise<void> {
  const result = await TokenManager.initialize();

  if (result.status === 'ok') return;

  if (result.status === 'unavailable') {
    // Emulator/simulator — silently skip, no user feedback needed
    return;
  }

  if (result.status === 'denied') {
    Alert.alert(
      'Notifications are disabled',
      result.message + '\n\nGo to Settings → select this app → Notifications → Allow.',
      [{ text: 'OK' }],
      { cancelable: true },
    );
    return;
  }

  // 'error' — show the specific error message so the problem is visible
  if (result.status === 'error') {
    console.warn('[Push] Registration error:', result.message);
    const isConfigError =
      result.message.includes('EAS project') ||
      result.message.includes('push token') ||
      result.message.includes('Push setup') ||
      result.message.includes('not configured for this build') ||
      result.message.includes('FirebaseApp');
    const isServerError = result.message.includes('could not be saved to server');

    if (isConfigError && !_pushConfigAlertShown) {
      _pushConfigAlertShown = true;
      Alert.alert('Push notification setup error', result.message, [{ text: 'OK' }], {
        cancelable: true,
      });
    } else if (isServerError && !_pushServerErrorAlertShown) {
      _pushServerErrorAlertShown = true;
      Alert.alert(
        'Notifications not linked',
        'Your device could not register for push notifications with the server. ' +
          'Check your connection and reopen the app.\n\n' +
          result.message,
        [{ text: 'OK' }],
        { cancelable: true },
      );
    }
  }
}

// ── Root Navigator ────────────────────────────────────────────────────────────

export function RootNavigator() {
  const tokenData  = useAuthStore((s) => s.tokenData);
  const isHydrated = useAuthStore((s) => s.isHydrated);
  const hydrate    = useAuthStore((s) => s.hydrate);
  const showBanner = useInAppBannerStore((s) => s.show);

  const [isValidating, setIsValidating] = useState(false);

  // Keep a stable ref for the banner callback — prevents the notification
  // handler effect from re-registering listeners on every render cycle.
  const showBannerRef = useRef(showBanner);
  useEffect(() => { showBannerRef.current = showBanner; }, [showBanner]);

  // Whether we are authenticated — memoised in a ref for use inside AppState handler.
  const isAuthenticatedRef = useRef(false);

  // ── Hydration ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isHydrated) hydrate();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Token validation on first hydration ────────────────────────────────────
  useEffect(() => {
    if (!isHydrated) return;
    if (!tokenData?.token) return;
    let cancelled = false;
    (async () => {
      setIsValidating(true);
      await validateStoredToken();
      if (!cancelled) setIsValidating(false);
    })();
    return () => { cancelled = true; };
  }, [isHydrated]);

  const isAuthenticated = !!tokenData?.token;

  // Keep the ref in sync so the AppState handler can read it without deps.
  useEffect(() => {
    isAuthenticatedRef.current = isAuthenticated;
  }, [isAuthenticated]);

  // ── Socket lifecycle ────────────────────────────────────────────────────────
  useEffect(() => {
    if (isAuthenticated) {
      connectSocket(tokenData?.token);
      return;
    }
    disconnectSocket();
  }, [isAuthenticated, tokenData?.token]);

  // ── Push registration — initial + foreground retry ─────────────────────────
  //
  // WHY TWO PLACES?
  //
  // 1. On login/auth change → run once immediately.
  //
  // 2. On app-foreground return (AppState active) → retry IF the last attempt
  //    was not successful.  This is the KEY fix for:
  //    "I granted permission in Settings but still get no notifications."
  //    Without this, the token is never registered after a manual permission
  //    grant because there is no trigger to re-run the flow.
  //
  useEffect(() => {
    if (!isAuthenticated) {
      TokenManager.teardown();
      return;
    }
    void runTokenRegistration();
  }, [isAuthenticated]);

  useEffect(() => {
    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (nextState !== 'active') return;
      if (!isAuthenticatedRef.current) return;
      // Only retry if the previous attempt was not a clean success.
      if (!TokenManager.shouldRetryOnForeground()) return;
      void runTokenRegistration();
    };

    const sub = AppState.addEventListener('change', handleAppStateChange);
    return () => sub.remove();
  }, []); // mount-only — reads auth state via ref

  // ── Notification listeners (foreground + background tap) ───────────────────
  // Registered ONCE on mount. Banner callback is accessed via stable ref so
  // this effect never re-runs (prevents the double-registration race condition).
  useEffect(() => {
    const cleanup = initNotificationHandlers({
      onForegroundNotification: (data) => {
        if (!data.conversationId) return;
        showBannerRef.current({
          conversationId: data.conversationId,
          businessPhoneId: data.businessPhoneId,
          title: data.title,
          body: data.body,
          timestamp: data.timestamp,
        });
      },
    });
    return cleanup;
  }, []);

  // ── Killed-app / cold-start notification tap ───────────────────────────────
  // Called once when NavigationContainer is fully ready. This is the ONLY
  // correct way to handle "user tapped notification while app was killed":
  // addNotificationResponseReceivedListener does NOT fire in that scenario.
  const handleNavigationReady = useCallback(() => {
    onNavigationReady();
    void handleLastNotificationResponse();
  }, []);

  // ── Spinner ────────────────────────────────────────────────────────────────
  if (!isHydrated || isValidating) {
    return <LoadingScreen />;
  }

  return (
    <NavigationContainer ref={navigationRef} onReady={handleNavigationReady}>
      {isAuthenticated ? (
        <>
          <MainStack.Navigator screenOptions={{ headerShown: false }}>
            <MainStack.Screen name="Main" component={DashboardScreen} />
            <MainStack.Screen name="ChatApp" component={ChatAppStack} />
          </MainStack.Navigator>
          <IncomingCallGate />
        </>
      ) : (
        <AuthNavigator />
      )}
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.backgroundSecondary,
    gap: 12,
  },
  loadingText: {
    fontSize: 16,
    color: colors.text,
  },
});
