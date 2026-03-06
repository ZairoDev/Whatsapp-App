import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { TokenInterface } from './types';

const AUTH_STORAGE_KEY = '@auth_token_data';

interface AuthState {
  tokenData: TokenInterface | null;
  isHydrated: boolean;
  /**
   * Set to true when the session is forcibly ended by an auth failure (401 / expired
   * token). The login screen reads this to show an appropriate banner, then clears it.
   */
  sessionExpired: boolean;
  setToken: (data: TokenInterface | null) => Promise<void>;
  clearToken: () => Promise<void>;
  /** Called by the API layer when a 401 / auth-failure response is received. */
  markSessionExpired: () => Promise<void>;
  /** Called by the login screen once the banner has been shown. */
  clearSessionExpired: () => void;
  hydrate: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  tokenData: null,
  isHydrated: false,
  sessionExpired: false,

  setToken: async (data) => {
    if (data === null) {
      await AsyncStorage.removeItem(AUTH_STORAGE_KEY);
      set({ tokenData: null });
      return;
    }
    set({ tokenData: data });
    try {
      await AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(data));
    } catch {
      // Keep in-memory state so navigation still works
    }
  },

  clearToken: async () => {
    await AsyncStorage.removeItem(AUTH_STORAGE_KEY);
    set({ tokenData: null });
  },

  markSessionExpired: async () => {
    await AsyncStorage.removeItem(AUTH_STORAGE_KEY);
    set({ tokenData: null, sessionExpired: true });
  },

  clearSessionExpired: () => {
    set({ sessionExpired: false });
  },

  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(AUTH_STORAGE_KEY);
      const tokenData = raw ? (JSON.parse(raw) as TokenInterface) : null;

      // If the token carries an expiry timestamp, check it client-side immediately.
      // This avoids showing the app at all for obviously stale tokens.
      if (tokenData?.expiresAt && Date.now() > tokenData.expiresAt) {
        await AsyncStorage.removeItem(AUTH_STORAGE_KEY);
        set({ tokenData: null, isHydrated: true, sessionExpired: true });
        return;
      }

      set({ tokenData, isHydrated: true });
    } catch {
      set({ tokenData: null, isHydrated: true });
    }
  },
}));

export function isAuthenticated(): boolean {
  const { tokenData } = useAuthStore.getState();
  return tokenData != null && (tokenData.token != null || Object.keys(tokenData).length > 0);
}
