import { useEffect, useRef } from 'react';
import { Animated, I18nManager, Pressable, StyleSheet, View } from 'react-native';
import { toggleThumbOffset } from '../../i18n/bidi';
import { useRtlLayout } from '../../i18n/useRtlLayout';
import { useReduceMotion } from '../useReduceMotion';

const TRACK_W = 44;
const TRACK_H = 26;
const THUMB = 20;
const PAD = 3;
const TRAVEL = TRACK_W - THUMB - PAD * 2;

/**
 * Drop-in for the platform Switch. Draws its own thumb so "on" lands on the
 * same side on every vendor (Xiaomi does not mirror Switch in RTL).
 */
export function Toggle({
  value,
  onValueChange,
  disabled = false,
  trackColor,
  thumbColor,
  accessibilityLabel,
}: {
  value: boolean;
  onValueChange?: (next: boolean) => void;
  disabled?: boolean;
  trackColor: { false: string; true: string };
  thumbColor: string;
  accessibilityLabel?: string;
}) {
  const { isRtl } = useRtlLayout();
  const reduceMotion = useReduceMotion();
  const target = toggleThumbOffset(value, isRtl, I18nManager.isRTL, TRAVEL);
  const x = useRef(new Animated.Value(target)).current;

  useEffect(() => {
    if (reduceMotion) {
      x.setValue(target);
      return;
    }
    Animated.timing(x, {
      toValue: target,
      duration: 160,
      useNativeDriver: true,
    }).start();
  }, [target, reduceMotion, x]);

  return (
    <Pressable
      onPress={() => onValueChange?.(!value)}
      disabled={disabled}
      hitSlop={8}
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: value, disabled }}
    >
      <View
        style={[
          styles.track,
          { backgroundColor: value ? trackColor.true : trackColor.false },
        ]}
      >
        <Animated.View
          style={[
            styles.thumb,
            { backgroundColor: thumbColor, transform: [{ translateX: x }] },
          ]}
        />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: {
    width: TRACK_W,
    height: TRACK_H,
    borderRadius: TRACK_H / 2,
    paddingHorizontal: PAD,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 1.5,
    shadowOffset: { width: 0, height: 1 },
  },
});
