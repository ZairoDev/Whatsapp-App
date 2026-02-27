import React, { type ReactNode } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RootNavigator } from '../navigation/RootNavigator';

interface AppProvidersProps {
  children?: ReactNode;
}

/**
 * Wraps the app with required providers for React Navigation and gestures.
 */
export function AppProviders({ children }: AppProvidersProps) {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        {children ?? <RootNavigator />}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
