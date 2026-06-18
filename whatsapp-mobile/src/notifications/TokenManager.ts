/**
 * TokenManager — Push token lifecycle management.
 *
 * Responsibilities:
 *  1. Request notification permissions (with Android 13+ runtime gate).
 *  2. Obtain the Expo push token via getExpoPushTokenAsync.
 *  3. Register the token with the backend (POST /push/register).
 *  4. Listen for token refresh events and re-register automatically.
 *  5. Tear down listeners on logout.
 *  6. Expose a retryable status so the app can re-run on foreground return
 *     (handles the case where the user grants permission in Settings and
 *     returns to the app — the most common real-device failure path).
 */

import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';

import api from '../services/api';
import { useAuthStore } from '../features/auth/auth.store';
import { setupNotificationChannels } from './ChannelManager';

// ── Types ────────────────────────────────────────────────────────────────────

export type TokenRegistrationResult =
  | { status: 'ok'; expoPushToken: string }
  | { status: 'denied'; message: string }
  | { status: 'unavailable'; message: string }
  | { status: 'error'; message: string };

// ── Internal state ────────────────────────────────────────────────────────────

/** Deduplication lock — prevents parallel registration races. */
let _registrationInFlight: Promise<TokenRegistrationResult> | null = null;

/** The refresh subscription (cleaned up on logout). */
let _tokenRefreshSub: Notifications.EventSubscription | null = null;

/** Last successfully registered token (cached to skip redundant backend calls). */
let _lastRegisteredToken: string | null = null;

/** Whether the last attempt was a success (used to decide if foreground retry is needed). */
let _lastStatus: TokenRegistrationResult['status'] | null = null;

/** Last employee id we registered this device token for (re-register on user switch). */
let _lastRegisteredEmployeeId: string | null = null;

// ── Helpers ───────────────────────────────────────────────────────────────────

function getCurrentEmployeeId(): string | null {
  const td = useAuthStore.getState().tokenData;
  const id = td?.id ?? td?.userId;
  return typeof id === 'string' && id.trim() ? id.trim() : null;
}

function getProjectId(): string | null {
  // SDK 54 / Expo 54 — prefer expoConfig, fallback to legacy manifest
  try {
    const cfg =
      (Constants as any).expoConfig ??
      (Constants as any).manifest2 ??
      (Constants as any).manifest;
    const id =
      cfg?.extra?.eas?.projectId ??
      cfg?.easConfig?.projectId ??
      (Constants as any).easConfig?.projectId;
    return typeof id === 'string' && id.trim() ? id.trim() : null;
  } catch {
    return null;
  }
}

async function requestPermissions(): Promise<{
  granted: boolean;
  canRetry: boolean;
}> {
  const { status: existing, canAskAgain } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return { granted: true, canRetry: false };

  if (!canAskAgain) {
    // User has permanently denied — they must go to Settings
    return { granted: false, canRetry: false };
  }

  // Show the system dialog
  const { status: requested } = await Notifications.requestPermissionsAsync({
    ios: {
      allowAlert: true,
      allowBadge: true,
      allowSound: true,
    },
  });

  if (requested === 'granted') return { granted: true, canRetry: false };

  // 'denied' with canAskAgain=false means "permanent deny" — needs Settings
  const { canAskAgain: canStillAsk } = await Notifications.getPermissionsAsync();
  return { granted: false, canRetry: Boolean(canStillAsk) };
}

async function sendTokenToBackend(expoPushToken: string): Promise<void> {
  const employeeId = getCurrentEmployeeId();
  if (
    expoPushToken === _lastRegisteredToken &&
    employeeId &&
    employeeId === _lastRegisteredEmployeeId
  ) {
    return; // already registered for this user + device
  }

  await api.post('/push/register', {
    expoPushToken,
    platform: Platform.OS,
    deviceName: Device.deviceName ?? undefined,
    deviceId: (Device as any).osInternalBuildId ?? undefined,
    projectId: getProjectId(),
  });

  _lastRegisteredToken = expoPushToken;
  _lastRegisteredEmployeeId = employeeId;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns whether a retry is worthwhile on the next foreground event.
 * True when the last attempt failed due to permissions (user might grant from Settings)
 * or a network/transient error (server might be available now).
 */
export function shouldRetryOnForeground(): boolean {
  return _lastStatus !== 'ok' && _lastStatus !== 'unavailable';
}

/**
 * Initialize push notifications for the current user session.
 * Safe to call on every foreground event — deduplication prevents parallel races.
 */
export function initialize(): Promise<TokenRegistrationResult> {
  if (_registrationInFlight) return _registrationInFlight;

  _registrationInFlight = _doInitialize().finally(() => {
    _registrationInFlight = null;
  });
  return _registrationInFlight;
}

async function _doInitialize(): Promise<TokenRegistrationResult> {
  if (!Device.isDevice) {
    _lastStatus = 'unavailable';
    return {
      status: 'unavailable',
      message: 'Push notifications require a physical device (not an emulator/simulator).',
    };
  }

  try {
    // Ensure Android channels exist (idempotent)
    await setupNotificationChannels();

    // Request / check permission
    const { granted, canRetry } = await requestPermissions();
    if (!granted) {
      _lastStatus = 'denied';
      return {
        status: 'denied',
        message: canRetry
          ? 'Please allow notifications when prompted.'
          : 'Notifications are disabled. Go to Settings → Notifications → enable for this app.',
      };
    }

    // Resolve EAS project ID
    const projectId = getProjectId();
    if (!projectId) {
      _lastStatus = 'error';
      return {
        status: 'error',
        message:
          'Push setup incomplete: EAS project ID is missing (app.json extra.eas.projectId). ' +
          'Please rebuild the app via EAS.',
      };
    }

    // Obtain Expo push token (routes via Expo Push Service → FCM/APNs)
    let expoPushToken: string;
    try {
      const res = await Notifications.getExpoPushTokenAsync({ projectId });
      expoPushToken = res.data;
    } catch (tokenErr: any) {
      _lastStatus = 'error';
      const msg = String(tokenErr?.message ?? tokenErr ?? 'unknown');
      console.warn('[TokenManager] getExpoPushTokenAsync failed:', msg);
      const isFirebaseInit =
        msg.includes('FirebaseApp is not initialized') ||
        msg.includes('google-services.json') ||
        msg.includes('fcm-credentials');
      return {
        status: 'error',
        message: isFirebaseInit
          ? 'Push notifications are not configured for this build. ' +
            'Add google-services.json for package com.zaidzz4.whatsappmobile in Firebase, ' +
            'then run: npx expo prebuild --platform android --clean && npm run android'
          : `Could not obtain push token: ${msg}. ` +
            'Ensure the app was built with EAS and FCM/APNs credentials are configured.',
      };
    }

    // Register with the backend
    try {
      await sendTokenToBackend(expoPushToken);
    } catch (apiErr: any) {
      _lastStatus = 'error';
      const msg = String(apiErr?.message ?? apiErr ?? 'unknown');
      console.warn('[TokenManager] backend registration failed:', msg);
      return {
        status: 'error',
        message: `Push token could not be saved to server: ${msg}`,
      };
    }

    // Attach token-refresh listener (idempotent — removes previous one first)
    _attachRefreshListener(projectId);

    _lastStatus = 'ok';
    console.log(
      '[TokenManager] Push token registered for employee',
      getCurrentEmployeeId() ?? '(unknown)',
      expoPushToken.slice(0, 28) + '…',
    );
    return { status: 'ok', expoPushToken };
  } catch (e: any) {
    _lastStatus = 'error';
    const message = typeof e?.message === 'string' ? e.message : 'Push registration failed.';
    console.warn('[TokenManager] Unexpected error:', message);
    return { status: 'error', message };
  }
}

/**
 * Subscribe to push token rotation events.
 * FCM and APNs can issue a new token at any time (typically after an app update
 * or OS reinstall). When this happens the NEW token must reach the backend
 * immediately — otherwise all subsequent push notifications fail silently.
 */
function _attachRefreshListener(projectId: string): void {
  _tokenRefreshSub?.remove();
  _tokenRefreshSub = Notifications.addPushTokenListener(async () => {
    try {
      const { data: expoPushToken } = await Notifications.getExpoPushTokenAsync({ projectId });
      // Force-invalidate the cache so sendTokenToBackend actually fires
      _lastRegisteredToken = null;
      await sendTokenToBackend(expoPushToken);
      _lastStatus = 'ok';
      console.log('[TokenManager] Token refreshed and re-registered:', expoPushToken);
    } catch (e) {
      _lastStatus = 'error';
      console.warn('[TokenManager] Token refresh registration failed:', e);
    }
  });
}

/**
 * Tear down all push-related subscriptions on logout.
 * Prevents a stale-session token from being re-registered.
 */
export function teardown(): void {
  _tokenRefreshSub?.remove();
  _tokenRefreshSub = null;
  _lastRegisteredToken = null;
  _lastRegisteredEmployeeId = null;
  _lastStatus = null;
  _registrationInFlight = null;
}

/** Force the next initialize() call to POST the token to the backend again. */
export function invalidateRegistrationCache(): void {
  _lastRegisteredToken = null;
  _lastRegisteredEmployeeId = null;
}

// ── Diagnostics ─────────────────────────────────────────────────────────────

export type PushDebugInfo = {
  /** Result of the last registration attempt (null = not attempted yet). */
  status: TokenRegistrationResult['status'] | null;
  /** The Expo push token currently registered with the backend, if any. */
  token: string | null;
  /** False on emulators/simulators — push is impossible there. */
  isPhysicalDevice: boolean;
  /** Employee the token was last registered for. */
  employeeId: string | null;
};

/** Snapshot of the current push state — used by the in-app diagnostics card. */
export function getDebugInfo(): PushDebugInfo {
  return {
    status: _lastStatus,
    token: _lastRegisteredToken,
    isPhysicalDevice: Device.isDevice,
    employeeId: _lastRegisteredEmployeeId,
  };
}

/**
 * Force a fresh registration (ignores the in-memory cache).
 * Used by the "Retry" button in the diagnostics card.
 */
export function reregister(): Promise<TokenRegistrationResult> {
  invalidateRegistrationCache();
  return initialize();
}
