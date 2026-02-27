/**
 * App color palette and theme tokens.
 * Centralize colors for consistency and theming.
 */
export const colors = {
  // Primary palette
  primary: '#25D366',
  primaryDark: '#128C7E',
  primaryLight: '#DCF8C6',

  // Neutrals
  background: '#FFFFFF',
  backgroundSecondary: '#F0F2F5',
  surface: '#FFFFFF',
  text: '#111B21',
  textSecondary: '#667781',
  textMuted: '#8696A0',

  // Chat / UI
  chatBubbleOut: '#D9FDD3',
  chatBubbleIn: '#FFFFFF',
  border: '#E9EDEF',
  divider: '#E9EDEF',

  // Status
  success: '#25D366',
  error: '#EA4335',
  warning: '#FBBC05',
  info: '#34B7F1',

  // Tab / nav
  tabActive: '#25D366',
  tabInactive: '#667781',
} as const;

export type Colors = typeof colors;
