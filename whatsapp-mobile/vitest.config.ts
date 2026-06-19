import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      'react-native': path.resolve(__dirname, 'vitest/mocks/react-native.tsx'),
      '@expo/vector-icons': path.resolve(__dirname, 'vitest/mocks/expo-vector-icons.tsx'),
      'react-native-safe-area-context': path.resolve(
        __dirname,
        'vitest/mocks/react-native-safe-area-context.tsx',
      ),
    },
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    server: {
      deps: {
        inline: [
          '@testing-library/react-native',
          'react-native',
          'react-test-renderer',
        ],
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      include: [
        'src/features/chat/screens/ConversationListScreen.tsx',
        'src/features/chat/screens/conversationListScreen.utils.ts',
      ],
      thresholds: {
        branches: 93,
        functions: 75,
        lines: 97,
        statements: 97,
      },
    },
  },
});
