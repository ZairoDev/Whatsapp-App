import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { TokenInterface } from './types';

const AUTH_STORAGE_KEY = '@auth_token_data';

interface AuthState {
  tokenData: TokenInterface | null;
  isHydrated: boolean;
  setToken: (data: TokenInterface | null) => Promise<void>;
  clearToken: () => Promise<void>;
  hydrate: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  tokenData: null,
  isHydrated: false,

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
      // Keep in-memory state so navigation still works; persistence will retry on next app open if needed
    }
  },

  clearToken: async () => {
    await AsyncStorage.removeItem(AUTH_STORAGE_KEY);
    set({ tokenData: null });
  },

  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(AUTH_STORAGE_KEY);
      const tokenData = raw ? (JSON.parse(raw) as TokenInterface) : null;
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
