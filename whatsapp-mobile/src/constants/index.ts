/**
 * App-wide constants.
 */
export const APP_NAME = 'WhatsApp';

export const API_CONFIG = {
   // Use same base as auth by default; override with EXPO_PUBLIC_API_URL for local/dev if needed
   BASE_URL: process.env.EXPO_PUBLIC_API_URL ?? 'http://192.168.1.20:3000/api',
  TIMEOUT_MS: 15000,
} as const;

export const SOCKET_CONFIG = {
  URL: process.env.EXPO_PUBLIC_SOCKET_URL ?? 'https://api.example.com',
  RECONNECT_ATTEMPTS: 5,
  RECONNECT_DELAY_MS: 3000,
} as const;
