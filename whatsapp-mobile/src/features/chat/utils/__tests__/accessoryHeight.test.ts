import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const platformState = { os: 'ios' as 'ios' | 'android' };
const expoConfigState = { softwareKeyboardLayoutMode: 'resize' as string | undefined };

vi.mock('react-native', () => ({
  Dimensions: {
    get: () => ({ width: 390, height: 844 }),
  },
  Platform: {
    get OS() {
      return platformState.os;
    },
  },
}));

vi.mock('expo-constants', () => ({
  default: {
    get expoConfig() {
      return expoConfigState.softwareKeyboardLayoutMode
        ? { android: { softwareKeyboardLayoutMode: expoConfigState.softwareKeyboardLayoutMode } }
        : undefined;
    },
    manifest: null,
  },
}));

import {
  COMPOSER_KEYBOARD_PADDING,
  getChatBottomInset,
  getComposerBottomPadding,
  getDefaultAccessoryHeight,
  getKeyboardLayoutInset,
  isWindowResizedForKeyboard,
  resolveKeyboardHeight,
  shouldUseManualKeyboardInset,
  usesAndroidKeyboardResize,
} from '../accessoryHeight';

describe('accessoryHeight keyboard helpers', () => {
  beforeEach(() => {
    platformState.os = 'ios';
    expoConfigState.softwareKeyboardLayoutMode = 'resize';
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('resolveKeyboardHeight', () => {
    it('prefers screenY when it agrees with reported height', () => {
      expect(resolveKeyboardHeight({ height: 336, screenY: 508 }, 844)).toBe(336);
    });

    it('uses screenY when height is zero (some OEM keyboards)', () => {
      expect(resolveKeyboardHeight({ height: 0, screenY: 520 }, 844)).toBe(324);
    });

    it('falls back to height when screenY is implausible', () => {
      expect(resolveKeyboardHeight({ height: 320, screenY: 800 }, 844)).toBe(320);
    });

    it('never returns negative values', () => {
      expect(resolveKeyboardHeight({ height: -10, screenY: -1 }, 844)).toBe(0);
    });

    it('handles floating keyboard with smaller overlap via screenY', () => {
      expect(resolveKeyboardHeight({ height: 336, screenY: 644 }, 844)).toBe(200);
    });
  });

  describe('usesAndroidKeyboardResize', () => {
    it('returns false on iOS', () => {
      platformState.os = 'ios';
      expect(usesAndroidKeyboardResize()).toBe(false);
    });

    it('returns true when Expo config uses resize mode', () => {
      platformState.os = 'android';
      expoConfigState.softwareKeyboardLayoutMode = 'resize';
      expect(usesAndroidKeyboardResize()).toBe(true);
    });

    it('returns false when Expo config uses pan mode', () => {
      platformState.os = 'android';
      expoConfigState.softwareKeyboardLayoutMode = 'pan';
      expect(usesAndroidKeyboardResize()).toBe(false);
    });
  });

  describe('isWindowResizedForKeyboard', () => {
    it('detects resize when window shrinks by most of the keyboard height', () => {
      expect(isWindowResizedForKeyboard(844, 520, 320)).toBe(true);
    });

    it('returns false when shrink is negligible (pan mode)', () => {
      expect(isWindowResizedForKeyboard(844, 830, 320)).toBe(false);
    });
  });

  describe('shouldUseManualKeyboardInset', () => {
    it('always uses manual inset on iOS', () => {
      platformState.os = 'ios';
      expect(shouldUseManualKeyboardInset('ios')).toBe(true);
    });

    it('skips manual inset on Android resize config', () => {
      platformState.os = 'android';
      expoConfigState.softwareKeyboardLayoutMode = 'resize';
      expect(shouldUseManualKeyboardInset('android')).toBe(false);
    });

    it('uses manual inset on Android pan config without runtime resize', () => {
      platformState.os = 'android';
      expoConfigState.softwareKeyboardLayoutMode = 'pan';
      expect(shouldUseManualKeyboardInset('android')).toBe(true);
    });

    it('skips manual inset when runtime resize is detected on pan devices', () => {
      platformState.os = 'android';
      expoConfigState.softwareKeyboardLayoutMode = 'pan';
      expect(
        shouldUseManualKeyboardInset('android', {
          windowHeightBefore: 844,
          windowHeightAfter: 520,
          keyboardHeight: 320,
        }),
      ).toBe(false);
    });
  });

  describe('getChatBottomInset', () => {
    it('returns zero when keyboard is closed', () => {
      expect(
        getChatBottomInset({
          keyboardHeight: 0,
          safeAreaBottom: 34,
          isEmojiPickerOpen: false,
        }),
      ).toBe(0);
    });

    it('returns zero while emoji picker is open', () => {
      expect(
        getChatBottomInset({
          keyboardHeight: 336,
          safeAreaBottom: 34,
          isEmojiPickerOpen: true,
        }),
      ).toBe(0);
    });

    it('subtracts safe area on iOS', () => {
      platformState.os = 'ios';
      expect(
        getChatBottomInset({
          keyboardHeight: 336,
          safeAreaBottom: 34,
          isEmojiPickerOpen: false,
        }),
      ).toBe(302);
    });

    it('returns zero on Android resize devices (avoids double offset)', () => {
      platformState.os = 'android';
      expoConfigState.softwareKeyboardLayoutMode = 'resize';
      expect(
        getChatBottomInset({
          keyboardHeight: 320,
          safeAreaBottom: 24,
          isEmojiPickerOpen: false,
        }),
      ).toBe(0);
    });

    it('applies full keyboard height on Android pan devices', () => {
      platformState.os = 'android';
      expoConfigState.softwareKeyboardLayoutMode = 'pan';
      expect(
        getChatBottomInset({
          keyboardHeight: 320,
          safeAreaBottom: 24,
          isEmojiPickerOpen: false,
        }),
      ).toBe(320);
    });

    it('matches iPhone 15 Pro keyboard event (screenY-based height)', () => {
      platformState.os = 'ios';
      const keyboardHeight = resolveKeyboardHeight({ height: 336, screenY: 508 }, 844);
      expect(
        getChatBottomInset({
          keyboardHeight,
          safeAreaBottom: 34,
          isEmojiPickerOpen: false,
        }),
      ).toBe(302);
    });

    it('matches Pixel resize scenario without extra gap', () => {
      platformState.os = 'android';
      expoConfigState.softwareKeyboardLayoutMode = 'resize';
      const keyboardHeight = resolveKeyboardHeight({ height: 0, screenY: 524 }, 844);
      expect(
        getChatBottomInset({
          keyboardHeight,
          safeAreaBottom: 24,
          isEmojiPickerOpen: false,
          windowHeightBefore: 844,
          windowHeightAfter: 524,
        }),
      ).toBe(0);
    });

    it('matches Samsung pan scenario with manual inset', () => {
      platformState.os = 'android';
      expoConfigState.softwareKeyboardLayoutMode = 'pan';
      const keyboardHeight = resolveKeyboardHeight({ height: 308, screenY: 536 }, 844);
      expect(
        getChatBottomInset({
          keyboardHeight,
          safeAreaBottom: 0,
          isEmojiPickerOpen: false,
          windowHeightBefore: 844,
          windowHeightAfter: 844,
        }),
      ).toBe(308);
    });
  });

  describe('getComposerBottomPadding', () => {
    it('uses safe area when keyboard and emoji are closed', () => {
      expect(
        getComposerBottomPadding({
          keyboardVisible: false,
          emojiPickerOpen: false,
          safeAreaBottom: 34,
        }),
      ).toBe(34);
    });

    it('uses compact padding when keyboard is open', () => {
      expect(
        getComposerBottomPadding({
          keyboardVisible: true,
          emojiPickerOpen: false,
          safeAreaBottom: 34,
        }),
      ).toBe(COMPOSER_KEYBOARD_PADDING);
    });

    it('uses compact padding when emoji panel is open', () => {
      expect(
        getComposerBottomPadding({
          keyboardVisible: false,
          emojiPickerOpen: true,
          safeAreaBottom: 34,
        }),
      ).toBe(COMPOSER_KEYBOARD_PADDING);
    });
  });

  describe('getKeyboardLayoutInset (emoji panel sizing)', () => {
    it('keeps full keyboard height on Android for emoji panel', () => {
      platformState.os = 'android';
      expect(getKeyboardLayoutInset(320, 24)).toBe(320);
    });

    it('subtracts safe area on iOS for emoji panel', () => {
      platformState.os = 'ios';
      expect(getKeyboardLayoutInset(336, 34)).toBe(302);
    });
  });

  describe('getDefaultAccessoryHeight', () => {
    it('returns a reasonable fraction of window height on iOS', () => {
      platformState.os = 'ios';
      expect(getDefaultAccessoryHeight()).toBe(Math.round(844 * 0.36));
    });

    it('returns a reasonable fraction of window height on Android', () => {
      platformState.os = 'android';
      expect(getDefaultAccessoryHeight()).toBe(Math.round(844 * 0.38));
    });
  });
});
