import React, { useEffect } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuthStore } from '../../features/auth/auth.store';
import { LoginScreen, VerifyOtpScreen } from '../../features/auth/screens';
import { DashboardScreen } from '../../features/dashboard/screens/DashboardScreen';
import { ChatAppStack } from './ChatAppStack';
import { colors } from '../../theme/colors';

export type AuthStackParamList = {
  Login: undefined;
  VerifyOtp: { email: string };
};

export type RootStackParamList = {
  Main: undefined; // Dashboard
  ChatApp: { initialArea?: 'athens' | 'thessaloniki' } | undefined; // Tabs: Chats + Thread
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

export function RootNavigator() {
  const tokenData = useAuthStore((s) => s.tokenData);
  const isHydrated = useAuthStore((s) => s.isHydrated);
  const hydrate = useAuthStore((s) => s.hydrate);

  useEffect(() => {
    // Only hydrate once on mount, never again
    if (!isHydrated) {
      hydrate();
    }
  }, []); // ← empty deps, runs only once

  const isAuthenticated = !!tokenData?.token;

  if (!isHydrated) {
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