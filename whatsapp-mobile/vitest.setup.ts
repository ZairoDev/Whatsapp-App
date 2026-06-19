import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { focusEffectState } from './vitest/focusEffect';

vi.mock('react-native', async () => {
  return await import('./vitest/mocks/react-native.tsx');
});

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined),
  },
}));

vi.mock('@react-navigation/native', async () => {
  const React = await import('react');
  return {
    useFocusEffect: (callback: () => void | (() => void)) => {
      React.useEffect(() => {
        focusEffectState.latest = callback;
        const cleanup = callback();
        return typeof cleanup === 'function' ? cleanup : undefined;
      }, [callback]);
    },
  };
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});
