import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';

import api from '../services/api';

export type PushRegistrationResult =
  | { status: 'ok'; expoPushToken: string }
  | { status: 'denied'; message: string }
  | { status: 'unavailable'; message: string }
  | { status: 'error'; message: string };

function getProjectId(): string | null {
  const expoConfig = (Constants as any).expoConfig ?? (Constants as any).manifest;
  const id = expoConfig?.extra?.eas?.projectId;
  return typeof id === 'string' && id ? id : null;
}

async function ensureAndroidChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name: 'default',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#FF231F7C',
    sound: 'default',
  });
}

export async function registerForPushNotificationsAsync(): Promise<PushRegistrationResult> {
  if (!Device.isDevice) {
    return {
      status: 'unavailable',
      message: 'Push notifications require a physical device.',
    };
  }

  try {
    await ensureAndroidChannel();

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const req = await Notifications.requestPermissionsAsync();
      finalStatus = req.status;
    }

    if (finalStatus !== 'granted') {
      return {
        status: 'denied',
        message:
          'Notifications are disabled. Enable them in Settings to get alerts for new WhatsApp messages.',
      };
    }

    const projectId = getProjectId();
    if (!projectId) {
      return {
        status: 'error',
        message: 'Missing EAS projectId (app.json extra.eas.projectId).',
      };
    }

    const tokenRes = await Notifications.getExpoPushTokenAsync({ projectId });
    const expoPushToken = tokenRes.data;

    // Register token with backend (authenticated).
    await api.post('/push/register', {
      expoPushToken,
      platform: Platform.OS,
      deviceName: Device.deviceName ?? undefined,
      deviceId: (Device as any).osInternalBuildId ?? undefined,
      projectId,
    });

    return { status: 'ok', expoPushToken };
  } catch (e: any) {
    return {
      status: 'error',
      message: typeof e?.message === 'string' ? e.message : 'Failed to register for notifications.',
    };
  }
}

