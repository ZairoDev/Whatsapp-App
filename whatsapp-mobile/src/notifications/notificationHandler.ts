/**
 * notificationHandler — Foreground presentation policy + tap navigation.
 *
 * Three distinct notification scenarios:
 *
 * 1. FOREGROUND  — App is open and running.
 *    setNotificationHandler (set in index.ts) controls whether the system
 *    shows a banner/sound.  We suppress it when the user is already looking at
 *    the relevant conversation or when a voice call is active.  We then emit
 *    the payload to the in-app banner store so the custom banner shows instead.
 *
 * 2. BACKGROUND  — App is running but not in focus (iOS) or process alive
 *    (Android).  The OS shows the notification via FCM/APNs.  When the user
 *    taps it, addNotificationResponseReceivedListener fires.
 *
 * 3. KILLED / COLD START — App is not running.  The OS shows the notification.
 *    When the user taps and the app launches, addNotificationResponseReceivedListener
 *    WILL NOT FIRE because the listener wasn't registered yet.
 *    Instead, getLastNotificationResponseAsync() must be called once the
 *    NavigationContainer is ready.  See handleLastNotificationResponse() below.
 *
 * Navigation queuing:
 *    Both scenario 2 and 3 navigate to a conversation.  If navigationRef isn't
 *    ready yet (e.g. scenario 3 during app boot), we queue the intent and flush
 *    it once the nav container signals readiness via onNavigationReady().
 */

import * as Notifications from 'expo-notifications';

import { useChatStore } from '../features/chat/chat.store';
import { navigationRef } from '../core/navigation/navigationRef';
import { isCallActive } from '../services/callAudioSession';

// ── Types ─────────────────────────────────────────────────────────────────────

export type NotificationData = {
  conversationId?: string;
  businessPhoneId?: string;
  messageType?: string;
  timestamp?: number;
  senderId?: string;
};

export type ForegroundNotificationCallback = (
  data: NotificationData & { title?: string; body?: string },
) => void;

// ── Navigation queue ──────────────────────────────────────────────────────────
// When a notification tap arrives before the nav container is ready, we hold
// the intent here and flush it once onNavigationReady() is called.

let _pendingNavConversationId: string | null = null;

function navigateToConversation(conversationId: string): void {
  if (navigationRef.isReady()) {
    navigationRef.navigate(
      'ChatApp',
      // Nested screen params — kept loose at runtime
      ({ screen: 'ConversationDetail', params: { conversationId } } as any),
    );
    _pendingNavConversationId = null;
  } else {
    // Queue it — will be flushed when nav container fires onReady
    _pendingNavConversationId = conversationId;
  }
}

/**
 * Call this from NavigationContainer's onReady callback (in RootNavigator).
 * Flushes any pending notification-tap navigation that arrived before the
 * container was initialized (killed-app cold-start scenario).
 */
export function onNavigationReady(): void {
  if (_pendingNavConversationId) {
    const id = _pendingNavConversationId;
    _pendingNavConversationId = null;
    navigateToConversation(id);
  }
}

// ── Killed-app last response ──────────────────────────────────────────────────

/**
 * Handle the notification that launched the app from a killed state.
 *
 * MUST be called once the NavigationContainer is mounted and ready.
 * addNotificationResponseReceivedListener does NOT fire for the notification
 * that opened a killed app — this is the only way to handle that case.
 */
export async function handleLastNotificationResponse(): Promise<void> {
  try {
    const response = await Notifications.getLastNotificationResponseAsync();
    if (!response) return;

    const data = extractData(response.notification);
    if (!data.conversationId) return;

    // Dismiss it so it doesn't trigger again on the next app restart
    await Notifications.dismissNotificationAsync(
      response.notification.request.identifier,
    ).catch(() => {}); // non-fatal

    navigateToConversation(data.conversationId);
  } catch {
    // Non-fatal — worst case the user just doesn't deep-link
  }
}

// ── Data extraction ───────────────────────────────────────────────────────────

function extractData(notification: Notifications.Notification): NotificationData {
  const raw = (notification.request.content.data ?? {}) as Record<string, unknown>;
  return {
    conversationId: typeof raw.conversationId === 'string' ? raw.conversationId : undefined,
    businessPhoneId: typeof raw.businessPhoneId === 'string' ? raw.businessPhoneId : undefined,
    messageType: typeof raw.messageType === 'string' ? raw.messageType : undefined,
    timestamp: typeof raw.timestamp === 'number' ? raw.timestamp : undefined,
    senderId: typeof raw.senderId === 'string' ? raw.senderId : undefined,
  };
}

// ── Handler registration ──────────────────────────────────────────────────────

/**
 * Register the sophisticated foreground presentation policy and the tap handler.
 *
 * This OVERRIDES the permissive default handler set in index.ts with one that
 * suppresses the system banner/sound when the user is already in the relevant
 * conversation or when a call is active.
 *
 * Returns a cleanup function — call it when the component that owns the
 * handlers unmounts (or when the user logs out).
 */
export function initNotificationHandlers(opts: {
  onForegroundNotification: ForegroundNotificationCallback;
}): () => void {
  // ── 1. Foreground presentation policy ──────────────────────────────────────
  // Overrides the permissive default set at module level in index.ts
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      // Always silent during an active call — notification sound buzzes in earpiece
      if (isCallActive()) {
        return {
          shouldShowAlert: false,
          shouldShowBanner: false,
          shouldShowList: true,
          shouldPlaySound: false,
          shouldSetBadge: false,
        };
      }

      const data = extractData(notification);
      const activeId = useChatStore.getState().activeConversationId;
      const isCurrentConversation =
        Boolean(data.conversationId) && data.conversationId === activeId;

      return {
        shouldShowAlert: !isCurrentConversation,
        shouldShowBanner: !isCurrentConversation,
        shouldShowList: !isCurrentConversation,
        shouldPlaySound: !isCurrentConversation,
        shouldSetBadge: false,
      };
    },
  });

  // ── 2. Foreground notification received ───────────────────────────────────
  // Fire the in-app banner callback when the system suppresses its own banner
  // (because the user is in a different conversation, not the current one)
  const subReceived = Notifications.addNotificationReceivedListener((notification) => {
    const data = extractData(notification);
    if (!data.conversationId) return;

    const activeId = useChatStore.getState().activeConversationId;
    if (data.conversationId === activeId) return; // already viewing — no banner needed

    opts.onForegroundNotification({
      ...data,
      title: notification.request.content.title ?? undefined,
      body: notification.request.content.body ?? undefined,
    });
  });

  // ── 3. Notification tap (background → foreground) ─────────────────────────
  // Fires when user taps a notification while app is in background.
  // Does NOT fire for killed-app cold-start (handled by handleLastNotificationResponse)
  const subResponse = Notifications.addNotificationResponseReceivedListener((response) => {
    const data = extractData(response.notification);
    if (!data.conversationId) return;
    navigateToConversation(data.conversationId);
  });

  // ── Cleanup ───────────────────────────────────────────────────────────────
  return () => {
    subReceived.remove();
    subResponse.remove();
    // Restore the permissive default so notifications still show if handlers
    // are momentarily unregistered during a re-mount cycle
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
  };
}
