import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuthStore } from '../../features/auth/auth.store';
import { LoginScreen, VerifyOtpScreen } from '../../features/auth/screens';
import { DashboardScreen } from '../../features/dashboard/screens/DashboardScreen';
import { ChatAppStack } from './ChatAppStack';
import { colors } from '../../theme/colors';
import api from '../../services/api';

export type AuthStackParamList = {
  Login: undefined;
  VerifyOtp: { email: string };
};

export type RootStackParamList = {
  Main: undefined;
  ChatApp: { initialArea?: 'athens' | 'thessaloniki' } | undefined;
};

const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const MainStack = createNativeStackNavigator<RootStackParamList>();

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

/**
 * Verify the stored token is still accepted by the server.
 *
 * Rules:
 *  - Pure network error (no internet)  → return true  (offline ≠ invalid token)
 *  - Any HTTP error (4xx / 5xx)        → mark session expired + return false
 *    NOTE: We call markSessionExpired() HERE, not relying on the interceptor,
 *    because the interceptor may already do it for 401/5xx but we want a
 *    guarantee regardless of what status code the server sends.
 *  - Successful response               → return true
 *
 * Endpoint: GET /whatsapp/templates requires auth and no extra parameters,
 * so a missing-parameter 500 can never be confused with an auth failure.
 */
async function validateStoredToken(): Promise<boolean> {
  try {
    await api.get('/whatsapp/templates');
    return true;
  } catch (err: any) {
    // No internet — keep the user logged in.
    if (err?.isNetworkError) return true;

    // Any HTTP error: the interceptor may already have called markSessionExpired()
    // (for 401 / 5xx), but we call it here unconditionally to be certain.
    // This is safe to call multiple times — it is idempotent.
    await useAuthStore.getState().markSessionExpired();
    return false;
  }
}

export function RootNavigator() {
  const tokenData    = useAuthStore((s) => s.tokenData);
  const isHydrated   = useAuthStore((s) => s.isHydrated);
  const hydrate      = useAuthStore((s) => s.hydrate);
  const [isValidating, setIsValidating] = useState(false);

  // Load stored token from AsyncStorage once on mount.
  useEffect(() => {
    if (!isHydrated) hydrate();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Once hydrated, if a token exists validate it against the server before
  // showing any protected screen.  The user sees a loading spinner during this.
  useEffect(() => {
    if (!isHydrated) return;
    if (!tokenData?.token) return; // nothing to validate

    let cancelled = false;
    (async () => {
      setIsValidating(true);
      await validateStoredToken();
      // validateStoredToken already called markSessionExpired() on failure,
      // so tokenData will be null → isAuthenticated becomes false automatically.
      if (!cancelled) setIsValidating(false);
    })();

    return () => { cancelled = true; };
  }, [isHydrated]); // intentionally only on first hydration

  const isAuthenticated = !!tokenData?.token;

  // Keep spinner up while reading AsyncStorage or validating with the server.
  if (!isHydrated || isValidating) {
    return <LoadingScreen />;
  }

  return (
    <NavigationContainer>
      {isAuthenticated ? (
        <MainStack.Navigator screenOptions={{ headerShown: false }}>
          <MainStack.Screen name="Main" component={DashboardScreen} />
          <MainStack.Screen name="ChatApp" component={ChatAppStack} />
        </MainStack.Navigator>
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
