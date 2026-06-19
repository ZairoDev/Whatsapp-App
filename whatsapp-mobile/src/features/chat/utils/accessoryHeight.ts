import Constants from 'expo-constants';
import { Dimensions, Platform } from 'react-native';

/** Composer bottom padding while the system keyboard or emoji panel is open. */
export const COMPOSER_KEYBOARD_PADDING = 6;

export type KeyboardEndCoordinates = {
  height: number;
  screenY: number;
};

/** Estimate keyboard height before the user has opened the system keyboard once. */
export function getDefaultAccessoryHeight(): number {
  const { height: windowHeight } = Dimensions.get('window');
  return Math.round(windowHeight * (Platform.OS === 'ios' ? 0.36 : 0.38));
}

/**
 * Resolve keyboard overlap using `screenY` when available — more reliable than
 * `height` alone across OEM keyboards, floating keyboards, and split layouts.
 */
export function resolveKeyboardHeight(
  endCoordinates: KeyboardEndCoordinates,
  windowHeight: number,
): number {
  const { height, screenY } = endCoordinates;
  if (
    Number.isFinite(screenY) &&
    screenY >= 0 &&
    Number.isFinite(windowHeight) &&
    windowHeight > 0
  ) {
    const fromScreenY = windowHeight - screenY;
    if (fromScreenY > 0 && fromScreenY <= windowHeight) {
      const rounded = Math.round(fromScreenY);
      if (height <= 0 || rounded >= height * 0.5) {
        return rounded;
      }
    }
  }
  return Math.max(0, Math.round(height));
}

/** Whether Android is configured to resize the window when the keyboard opens. */
export function usesAndroidKeyboardResize(): boolean {
  if (Platform.OS !== 'android') return false;
  const mode =
    Constants.expoConfig?.android?.softwareKeyboardLayoutMode ??
    (Constants.manifest as { android?: { softwareKeyboardLayoutMode?: string } } | null)?.android
      ?.softwareKeyboardLayoutMode;
  return mode !== 'pan';
}

/** Runtime signal that Android already shrank the window for the keyboard. */
export function isWindowResizedForKeyboard(
  windowHeightBefore: number,
  windowHeightAfter: number,
  keyboardHeight: number,
): boolean {
  if (keyboardHeight <= 0) return false;
  const shrink = windowHeightBefore - windowHeightAfter;
  return shrink >= keyboardHeight * 0.65;
}

export function shouldUseManualKeyboardInset(
  platform: typeof Platform.OS,
  options: {
    androidKeyboardResizeActive?: boolean;
    windowHeightBefore?: number;
    windowHeightAfter?: number;
    keyboardHeight?: number;
  } = {},
): boolean {
  if (platform !== 'android') return true;
  if (options.androidKeyboardResizeActive === true) return false;
  if (usesAndroidKeyboardResize()) return false;
  if (
    options.windowHeightBefore != null &&
    options.windowHeightAfter != null &&
    options.keyboardHeight != null &&
    isWindowResizedForKeyboard(
      options.windowHeightBefore,
      options.windowHeightAfter,
      options.keyboardHeight,
    )
  ) {
    return false;
  }
  return true;
}

/** Layout inset applied when the system keyboard is open (not for in-flow emoji panel). */
export function getKeyboardLayoutInset(keyboardHeight: number, safeAreaBottom: number): number {
  if (keyboardHeight <= 0) return 0;
  return Platform.OS === 'android'
    ? keyboardHeight
    : Math.max(0, keyboardHeight - safeAreaBottom);
}

/** Bottom padding for the chat shell while the system keyboard is visible. */
export function getChatBottomInset(params: {
  keyboardHeight: number;
  safeAreaBottom: number;
  isEmojiPickerOpen: boolean;
  androidKeyboardResizeActive?: boolean;
  windowHeightBefore?: number;
  windowHeightAfter?: number;
}): number {
  const {
    keyboardHeight,
    safeAreaBottom,
    isEmojiPickerOpen,
    androidKeyboardResizeActive,
    windowHeightBefore,
    windowHeightAfter,
  } = params;

  if (keyboardHeight <= 0 || isEmojiPickerOpen) return 0;

  if (
    !shouldUseManualKeyboardInset(Platform.OS, {
      androidKeyboardResizeActive,
      windowHeightBefore,
      windowHeightAfter,
      keyboardHeight,
    })
  ) {
    return 0;
  }

  return getKeyboardLayoutInset(keyboardHeight, safeAreaBottom);
}

/** Bottom padding inside the composer row. */
export function getComposerBottomPadding(params: {
  keyboardVisible: boolean;
  emojiPickerOpen: boolean;
  safeAreaBottom: number;
}): number {
  const { keyboardVisible, emojiPickerOpen, safeAreaBottom } = params;
  if (emojiPickerOpen || keyboardVisible) return COMPOSER_KEYBOARD_PADDING;
  return Math.max(COMPOSER_KEYBOARD_PADDING, safeAreaBottom);
}
