/**
 * App-wide constants.
 */
export const APP_NAME = 'WhatsApp';

export const API_CONFIG = {
   // Use same base as auth by default; override with EXPO_PUBLIC_API_URL for local/dev if needed
   BASE_URL: process.env.EXPO_PUBLIC_API_URL ?? 'https://adminstro.in/api',
  TIMEOUT_MS: 15000,
} as const;

export const TRANSLATE_CONFIG = {
  // Optional LibreTranslate-compatible endpoint (POST { q, source, target, format }).
  // If omitted, the app falls back to MyMemory (no key, public).
  URL: process.env.EXPO_PUBLIC_TRANSLATE_URL,
  MYMEMORY_URL: 'https://api.mymemory.translated.net/get',
  TIMEOUT_MS: 15000,
} as const;

export const SOCKET_CONFIG = {
  // Prefer explicit override; otherwise derive from API base (strip trailing "/api").
  URL:
    process.env.EXPO_PUBLIC_SOCKET_URL ??
    (() => {
      const base = API_CONFIG.BASE_URL;
      // e.g. https://adminstro.in/api -> https://adminstro.in
      return base.replace(/\/api\/?$/, '');
    })(),
  RECONNECT_ATTEMPTS: 5,
  RECONNECT_DELAY_MS: 3000,
} as const;
