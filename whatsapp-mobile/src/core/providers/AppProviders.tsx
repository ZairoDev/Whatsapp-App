import React, { type ReactNode, useEffect } from 'react';
import { Platform, StatusBar, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RootNavigator } from '../navigation/RootNavigator';
import { InAppNotificationBanner } from '../../notifications/InAppNotificationBanner';
import { ThemeProvider, useTheme } from '../../theme/ThemeContext';

interface AppProvidersProps {
  children?: ReactNode;
}

function ThemedAppShell({ children }: { children: ReactNode }) {
  const { isDark, colors } = useTheme();
  const statusBarBackground = isDark ? colors.background : '#FFFFFF';
  const barStyle = isDark ? 'light-content' : 'dark-content';

  useEffect(() => {
    StatusBar.setBarStyle(barStyle, true);
    if (Platform.OS === 'android') {
      StatusBar.setBackgroundColor(statusBarBackground, true);
    }
  }, [barStyle, statusBarBackground]);

  return (
    <View style={{ flex: 1, backgroundColor: statusBarBackground }}>
      <StatusBar
        barStyle={barStyle}
        backgroundColor={statusBarBackground}
        translucent={Platform.OS === 'android'}
      />
      {children}
    </View>
  );
}

/**
 * Wraps the app with required providers for React Navigation and gestures.
 */
export function AppProviders({ children }: AppProvidersProps) {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <ThemedAppShell>
            <InAppNotificationBanner />
            {children ?? <RootNavigator />}
          </ThemedAppShell>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
