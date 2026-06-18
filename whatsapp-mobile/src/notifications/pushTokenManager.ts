/**
 * @deprecated Use TokenManager instead.
 * This file is kept only for backward-compatibility.
 * All push token logic has been moved to TokenManager.ts which adds:
 *  - Token refresh listener (FCM/APNs rotation)
 *  - Deduplication to prevent parallel registration races
 *  - Channel setup as a prerequisite step
 *  - Proper teardown on logout
 */
export { initialize as registerForPushNotificationsAsync, teardown } from './TokenManager';
export type { TokenRegistrationResult as PushRegistrationResult } from './TokenManager';
