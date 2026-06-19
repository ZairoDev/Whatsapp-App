import { useCallback, useEffect, useRef, useState } from 'react';
import { Dimensions, Keyboard, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  getChatBottomInset,
  isWindowResizedForKeyboard,
  resolveKeyboardHeight,
  usesAndroidKeyboardResize,
} from '../utils/accessoryHeight';

export function useChatKeyboard() {
  const insets = useSafeAreaInsets();
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [lastKeyboardHeight, setLastKeyboardHeight] = useState(0);
  const [lastKeyboardDuration, setLastKeyboardDuration] = useState(250);
  const [isEmojiPickerOpen, setIsEmojiPickerOpen] = useState(false);
  const [androidKeyboardResizeActive, setAndroidKeyboardResizeActive] = useState(() =>
    usesAndroidKeyboardResize(),
  );
  const [windowHeightAfterKeyboard, setWindowHeightAfterKeyboard] = useState(
    () => Dimensions.get('window').height,
  );

  const baselineWindowHeightRef = useRef(Dimensions.get('window').height);
  const windowHeightBeforeKeyboardRef = useRef(Dimensions.get('window').height);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSub = Keyboard.addListener(showEvent, (event) => {
      windowHeightBeforeKeyboardRef.current = baselineWindowHeightRef.current;
      const currentWindowHeight = Dimensions.get('window').height;
      setWindowHeightAfterKeyboard(currentWindowHeight);
      const height = resolveKeyboardHeight(event.endCoordinates, windowHeightBeforeKeyboardRef.current);

      if (Platform.OS === 'android') {
        const resizeDetected = isWindowResizedForKeyboard(
          windowHeightBeforeKeyboardRef.current,
          currentWindowHeight,
          height,
        );
        setAndroidKeyboardResizeActive(resizeDetected || usesAndroidKeyboardResize());
      }

      setLastKeyboardHeight(height);
      setKeyboardHeight(height);
      if (typeof event.duration === 'number' && event.duration > 0) {
        setLastKeyboardDuration(event.duration);
      }
    });

    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardHeight(0);
      const nextHeight = Dimensions.get('window').height;
      baselineWindowHeightRef.current = nextHeight;
      setWindowHeightAfterKeyboard(nextHeight);
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const handleEmojiPickerOpenChange = useCallback((open: boolean) => {
    setIsEmojiPickerOpen(open);
  }, []);

  const bottomInset = getChatBottomInset({
    keyboardHeight,
    safeAreaBottom: insets.bottom,
    isEmojiPickerOpen,
    androidKeyboardResizeActive,
    windowHeightBefore: windowHeightBeforeKeyboardRef.current,
    windowHeightAfter: windowHeightAfterKeyboard,
  });

  return {
    bottomInset,
    keyboardHeight,
    lastKeyboardHeight,
    lastKeyboardDuration,
    isEmojiPickerOpen,
    onEmojiPickerOpenChange: handleEmojiPickerOpenChange,
  };
}
