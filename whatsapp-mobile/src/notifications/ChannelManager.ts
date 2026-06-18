/**
 * ChannelManager — Android Notification Channel lifecycle.
 *
 * Android 8+ (API 26+) requires a notification channel for every notification.
 * Channels control sound, vibration, importance, and lock-screen visibility at
 * the OS level — the user can override per-channel in system settings, and the
 * app CANNOT override that choice at runtime.
 *
 * Rules:
 *  - Create channels once, early in the app lifecycle (we also create them in
 *    index.ts at module level so they exist even before JS fully evaluates).
 *  - Never delete a channel silently — that loses the user's custom settings.
 *  - Channel IDs are constants exported from this file so they are used
 *    consistently when sending notifications from the backend.
 */

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

export const CHANNEL_ID = {
  /** All inbound WhatsApp message notifications. */
  MESSAGES: 'whatsapp-messages',
  /** Incoming call alert. Bypasses DnD. */
  CALLS: 'whatsapp-calls',
  /** Fallback — used by old push tokens / backend payloads that omit channelId. */
  DEFAULT: 'default',
} as const;

export type ChannelId = (typeof CHANNEL_ID)[keyof typeof CHANNEL_ID];

/** Returns true when the platform requires notification channels (Android 8+). */
export function channelsRequired(): boolean {
  return Platform.OS === 'android';
}

/**
 * Idempotently create all notification channels.
 * Safe to call multiple times — Expo merges identical channel definitions.
 * Called from index.ts (module level) and also from TokenManager.initialize()
 * as a safety net for edge cases where index.ts IIFE may have been skipped.
 */
export async function setupNotificationChannels(): Promise<void> {
  if (!channelsRequired()) return;

  await Promise.all([
    // WhatsApp Messages — heads-up, sound, vibration, public on lock screen
    Notifications.setNotificationChannelAsync(CHANNEL_ID.MESSAGES, {
      name: 'WhatsApp Messages',
      description: 'New WhatsApp messages from guests and property owners',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#25D366',
      sound: 'default',
      enableVibrate: true,
      showBadge: true,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    }),

    // WhatsApp Calls — same importance as Messages but bypasses DnD
    Notifications.setNotificationChannelAsync(CHANNEL_ID.CALLS, {
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
    }),

    // Default fallback — keeps backward-compat with push tokens sent before channelId existed
    Notifications.setNotificationChannelAsync(CHANNEL_ID.DEFAULT, {
      name: 'Default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#25D366',
      sound: 'default',
      enableVibrate: true,
      showBadge: true,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    }),
  ]);
}

/** List all created channels (useful for debug screens). */
export async function listChannels(): Promise<Notifications.NotificationChannel[]> {
  if (!channelsRequired()) return [];
  return Notifications.getNotificationChannelsAsync();
}
