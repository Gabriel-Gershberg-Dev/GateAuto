import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';
import { spacing } from './theme';

/**
 * Software-keyboard height. Modal sheets sit in a transparent overlay, so
 * Android `adjustResize` on the Activity does not lift them.
 */
export function useKeyboardBottomInset(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const showEvent =
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent =
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent, (e) => {
      setHeight(e.endCoordinates.height);
    });
    const hide = Keyboard.addListener(hideEvent, () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return height;
}

/** Bottom spacing so a ConfirmSheet / FormSheet stays above the keyboard. */
export function sheetAvoidKeyboard(
  insetBottom: number,
  keyboardHeight: number,
): { paddingBottom: number; marginBottom: number } {
  const lift = Platform.OS === 'android' ? keyboardHeight : 0;
  return {
    paddingBottom: keyboardHeight > 0 ? 12 : Math.max(insetBottom, 16) + 8,
    marginBottom: spacing.sm + lift,
  };
}
