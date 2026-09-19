import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { useTheme } from '../ThemeProvider';
import { HUD_TEAL } from '../theme';
import { useReduceMotion } from '../useReduceMotion';

/**
 * Brand barrier. Arm only rises for a real open.
 * Auto-on is the radio arcs (watching), not an open arm.
 */
export function BarrierMark({
  size = 22,
  color,
  brand = false,
  watching = false,
  opening = false,
  pinned = false,
}: {
  size?: number;
  color?: string;
  /** Header / logo pose — slightly raised, not a status. */
  brand?: boolean;
  /** Auto-open is armed — signal arcs, arm stays down. */
  watching?: boolean;
  /** Gate is actually opening / just opened. */
  opening?: boolean;
  /** Has a map pin. */
  pinned?: boolean;
}) {
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  const tint = color ?? colors.primary;
  const lamp = HUD_TEAL;
  const arm = useRef(new Animated.Value(brand ? 0.45 : 0)).current;
  const pulse = useRef(new Animated.Value(0.45)).current;

  useEffect(() => {
    if (brand) {
      arm.setValue(0.45);
      return;
    }
    Animated.spring(arm, {
      toValue: opening ? 1 : 0,
      useNativeDriver: true,
      friction: 7,
      tension: 90,
    }).start();
  }, [arm, brand, opening]);

  useEffect(() => {
    if (!watching) {
      pulse.stopAnimation();
      pulse.setValue(0);
      return;
    }
    if (reduceMotion) {
      pulse.setValue(0.72);
      return;
    }
    pulse.setValue(0.4);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1400,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.35,
          duration: 1400,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduceMotion, watching]);

  const s = size / 24;
  const lampStroke = Math.max(StyleSheet.hairlineWidth * 2, 1);
  const postW = 2.6 * s;
  const postH = 13 * s;
  const postTop = 8.2 * s;
  const armH = 2.3 * s;
  const armLen = 12.5 * s;
  const hingeX = 6.2 * s;
  const hingeY = 10 * s;

  const rotate = arm.interpolate({
    inputRange: [0, 0.45, 1],
    outputRange: ['10deg', '-28deg', '-62deg'],
  });

  return (
    <View style={{ width: size, height: size, overflow: 'visible' }}>
      {watching ? (
        <>
          <Animated.View
            style={{
              position: 'absolute',
              left: 8.5 * s,
              top: 1.2 * s,
              width: 9 * s,
              height: 5 * s,
              borderColor: lamp,
              borderTopWidth: lampStroke,
              borderLeftWidth: lampStroke,
              borderRightWidth: lampStroke,
              borderBottomWidth: 0,
              borderTopLeftRadius: 8 * s,
              borderTopRightRadius: 8 * s,
              opacity: pulse,
            }}
          />
          <Animated.View
            style={{
              position: 'absolute',
              left: 10.2 * s,
              top: 3.4 * s,
              width: 5.6 * s,
              height: 3.2 * s,
              borderColor: lamp,
              borderTopWidth: lampStroke,
              borderLeftWidth: lampStroke,
              borderRightWidth: lampStroke,
              borderBottomWidth: 0,
              borderTopLeftRadius: 6 * s,
              borderTopRightRadius: 6 * s,
              opacity: pulse.interpolate({
                inputRange: [0.35, 1],
                outputRange: [0.85, 0.4],
              }),
            }}
          />
        </>
      ) : null}
      <View
        style={{
          position: 'absolute',
          left: 4 * s,
          top: postTop,
          width: postW,
          height: postH,
          borderRadius: postW / 2,
          backgroundColor: tint,
        }}
      />
      <View
        style={{
          position: 'absolute',
          right: 4 * s,
          top: postTop,
          width: postW,
          height: postH,
          borderRadius: postW / 2,
          backgroundColor: tint,
          opacity: 0.5,
        }}
      />
      <Animated.View
        style={{
          position: 'absolute',
          left: hingeX,
          top: hingeY,
          width: 1,
          height: 1,
          overflow: 'visible',
          transform: [{ rotate }],
        }}
      >
        <View
          style={{
            position: 'absolute',
            left: 0,
            top: -armH / 2,
            width: armLen,
            height: armH,
            borderRadius: armH / 2,
            backgroundColor: tint,
          }}
        />
      </Animated.View>
      <View
        style={{
          position: 'absolute',
          left: hingeX - 1.5 * s,
          top: hingeY - 1.5 * s,
          width: 3 * s,
          height: 3 * s,
          borderRadius: 1.5 * s,
          backgroundColor: tint,
        }}
      />
      {pinned ? (
        <View
          style={{
            position: 'absolute',
            left: 3.4 * s,
            top: 5.4 * s,
            width: 3.4 * s,
            height: 3.4 * s,
            borderRadius: 1.7 * s,
            backgroundColor: colors.warning,
          }}
        />
      ) : null}
    </View>
  );
}
