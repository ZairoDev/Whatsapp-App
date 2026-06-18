/**
 * Light and dark color palettes for the app.
 */
export type AppColors = {
  primary: string;
  primaryDark: string;
  primaryLight: string;
  background: string;
  backgroundSecondary: string;
  surface: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  chatBubbleOut: string;
  chatBubbleIn: string;
  border: string;
  divider: string;
  success: string;
  error: string;
  warning: string;
  info: string;
  tabActive: string;
  tabInactive: string;
  chatHeader: string;
  chatWallpaper: string;
  overlay: string;
  inputBackground: string;
  modalBackground: string;
  shadow: string;
  onPrimary: string;
};

export const lightColors: AppColors = {
  primary: '#25D366',
  primaryDark: '#128C7E',
  primaryLight: '#DCF8C6',
  background: '#FFFFFF',
  backgroundSecondary: '#F0F2F5',
  surface: '#FFFFFF',
  text: '#111B21',
  textSecondary: '#667781',
  textMuted: '#8696A0',
  chatBubbleOut: '#D9FDD3',
  chatBubbleIn: '#FFFFFF',
  border: '#E9EDEF',
  divider: '#E9EDEF',
  success: '#25D366',
  error: '#EA4335',
  warning: '#FBBC05',
  info: '#34B7F1',
  tabActive: '#25D366',
  tabInactive: '#667781',
  chatHeader: '#075E54',
  chatWallpaper: '#EFEAE2',
  overlay: 'rgba(0,0,0,0.45)',
  inputBackground: '#FFFFFF',
  modalBackground: '#FFFFFF',
  shadow: '#0B141A',
  onPrimary: '#FFFFFF',
};

export const darkColors: AppColors = {
  primary: '#25D366',
  primaryDark: '#128C7E',
  primaryLight: 'rgba(37, 211, 102, 0.16)',
  background: '#0B141A',
  backgroundSecondary: '#111B21',
  surface: '#1F2C34',
  text: '#E9EDEF',
  textSecondary: '#8696A0',
  textMuted: 'rgba(233,237,239,0.55)',
  chatBubbleOut: '#005C4B',
  chatBubbleIn: '#1F2C34',
  border: 'rgba(255,255,255,0.10)',
  divider: 'rgba(255,255,255,0.08)',
  success: '#25D366',
  error: '#F15C6D',
  warning: '#FBBC05',
  info: '#34B7F1',
  tabActive: '#25D366',
  tabInactive: '#8696A0',
  chatHeader: '#1F2C34',
  chatWallpaper: '#0B141A',
  overlay: 'rgba(0,0,0,0.65)',
  inputBackground: '#2A3942',
  modalBackground: '#1F2C34',
  shadow: '#000000',
  onPrimary: '#FFFFFF',
};
