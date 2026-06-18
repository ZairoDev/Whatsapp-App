import { registerRootComponent } from 'expo';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import App from './App';

// ─────────────────────────────────────────────────────────────────────────────
// CRITICAL: setNotificationHandler MUST be called at module level — before any
// React component renders.  Calling it inside a useEffect introduces a startup
// race: if a push notification arrives while the app is booting, there is no
// handler yet, causing expo-notifications to fall back to its built-in default
// (which shows nothing on some configurations).
//
// This default shows all alerts + sound.  RootNavigator overwrites it with the
// sophisticated handler (suppress in same conversation, suppress during calls)
// once the app is fully mounted — that overwrite is instantaneous and safe.
// ─────────────────────────────────────────────────────────────────────────────
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,   // iOS 14+ banner-style alert
    shouldShowList: true,     // appears in Notification Centre
    shouldPlaySound: true,
    shouldSetBadge: false,    // we manage badge counts manually
  }),
});

// ─────────────────────────────────────────────────────────────────────────────
// Android notification channels — also bootstrapped at module level so that
// any background-delivered notification can reference the correct channel
// before the JS bundle finishes executing app logic.
// ─────────────────────────────────────────────────────────────────────────────
if (Platform.OS === 'android') {
  void (async () => {
    // Primary WhatsApp message channel — maximum importance for heads-up notification
    await Notifications.setNotificationChannelAsync('whatsapp-messages', {
      name: 'WhatsApp Messages',
      description: 'New WhatsApp messages from guests and owners',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#25D366',
      sound: 'default',
      enableVibrate: true,
      showBadge: true,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });

    // Legacy / fallback channel — kept so old tokens that reference "default" still work
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#25D366',
      sound: 'default',
      enableVibrate: true,
      showBadge: true,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });

    // Call-ring channel — different sound profile for incoming calls
    await Notifications.setNotificationChannelAsync('whatsapp-calls', {
      name: 'WhatsApp Calls',
      description: 'Incoming WhatsApp voice calls',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 500, 200, 500],
      lightColor: '#075E54',
      sound: 'default',
      enableVibrate: true,
      showBadge: false,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      bypassDnd: true,
    });
  })();
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => App).
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately.
registerRootComponent(App);
