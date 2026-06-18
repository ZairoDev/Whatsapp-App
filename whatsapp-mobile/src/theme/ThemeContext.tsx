import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { darkColors, lightColors, type AppColors } from './palettes';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedScheme = 'light' | 'dark';

const STORAGE_KEY = '@adminstro/theme-preference';

type ThemeContextValue = {
  colors: AppColors;
  isDark: boolean;
  preference: ThemePreference;
  resolvedScheme: ResolvedScheme;
  setPreference: (preference: ThemePreference) => void;
  /** Cycles system → light → dark → system */
  cycleTheme: () => void;
  preferenceLabel: string;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

const PREFERENCE_ORDER: ThemePreference[] = ['system', 'light', 'dark'];

const PREFERENCE_LABELS: Record<ThemePreference, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
};

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>('system');

  useEffect(() => {
    void AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (stored === 'light' || stored === 'dark' || stored === 'system') {
        setPreferenceState(stored);
      }
    });
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    void AsyncStorage.setItem(STORAGE_KEY, next);
  }, []);

  const cycleTheme = useCallback(() => {
    const idx = PREFERENCE_ORDER.indexOf(preference);
    const next = PREFERENCE_ORDER[(idx + 1) % PREFERENCE_ORDER.length];
    setPreference(next);
  }, [preference, setPreference]);

  const resolvedScheme: ResolvedScheme =
    preference === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : preference;

  const isDark = resolvedScheme === 'dark';
  const colors = isDark ? darkColors : lightColors;

  const value = useMemo<ThemeContextValue>(
    () => ({
      colors,
      isDark,
      preference,
      resolvedScheme,
      setPreference,
      cycleTheme,
      preferenceLabel: PREFERENCE_LABELS[preference],
    }),
    [colors, isDark, preference, resolvedScheme, setPreference, cycleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return ctx;
}
