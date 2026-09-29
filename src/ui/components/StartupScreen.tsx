import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import type { StartupNetPhase } from '../../firebase/startupNetwork';
import { useTheme } from '../ThemeProvider';
import { radii, spacing, type as typeScale } from '../theme';

/**
 * Cabin-teal arrival: boom rises once, then a lamp bloom breathes.
 * Replaces the startup ActivityIndicator. Does not wait extra — parent
 * still unmounts this as soon as auth / hub route is ready.
 */
export function StartupScreen({
  connection = 'quiet',
  onRefresh,
  onContinue,
}: {
  connection?: StartupNetPhase;
  onRefresh?: () => void;
  onContinue?: () => void;
}) {
  const { t } = useTranslation();
  const { colors, scheme } = useTheme();
  const ink = scheme === 'dark' ? '#030607' : colors.background;
  const lamp = colors.primary;
  const [reduceMotion, setReduceMotion] = useState(false);
  const arm = useRef(new Animated.Value(0)).current;
  const bloom = useRef(new Animated.Value(0.28)).current;
  const rule = useRef(new Animated.Value(0)).current;
  const word = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (mounted) setReduceMotion(v);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      arm.setValue(1);
      bloom.setValue(0.55);
      rule.setValue(1);
      word.setValue(1);
      return;
    }
    arm.setValue(0);
    rule.setValue(0);
    word.setValue(0);
    bloom.setValue(0.22);
    Animated.sequence([
      Animated.timing(arm, {
        toValue: 1,
        duration: 680,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.parallel([
        Animated.timing(rule, {
          toValue: 1,
          duration: 380,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(word, {
          toValue: 1,
          duration: 420,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    ]).start();
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bloom, {
          toValue: 1,
          duration: 1400,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(bloom, {
          toValue: 0.32,
          duration: 1400,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [arm, bloom, reduceMotion, rule, word]);

  const rotate = arm.interpolate({
    inputRange: [0, 1],
    outputRange: ['12deg', '-34deg'],
  });
  const bloomScale = bloom.interpolate({
    inputRange: [0, 1],
    outputRange: [0.72, 1.18],
  });
  const bloomOpacity = bloom.interpolate({
    inputRange: [0, 1],
    outputRange: [0.12, 0.38],
  });
  const ruleScale = rule.interpolate({
    inputRange: [0, 1],
    outputRange: [0.12, 1],
  });

  return (
    <View
      style={[styles.root, { backgroundColor: ink }]}
      accessibilityRole={connection === 'needsRefresh' ? undefined : 'progressbar'}
      accessibilityLabel={
        connection === 'needsRefresh' ? t('startup.stuckTitle') : t('startup.a11y')
      }
    >
      <View style={styles.stage}>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.bloom,
            {
              backgroundColor: lamp,
              opacity: bloomOpacity,
              transform: [{ scale: bloomScale }],
            },
          ]}
        />
        <View style={styles.mark}>
          <View style={[styles.post, { backgroundColor: lamp }]} />
          <View
            style={[styles.post, styles.postFar, { backgroundColor: lamp }]}
          />
          <Animated.View
            style={[styles.hinge, { transform: [{ rotate }] }]}
          >
            <View style={[styles.boom, { backgroundColor: lamp }]} />
          </Animated.View>
          <View style={[styles.pivot, { backgroundColor: lamp }]} />
        </View>
        <Animated.Text
          style={[
            styles.word,
            {
              color: colors.text,
              opacity: word,
            },
          ]}
        >
          GATEAUTO
        </Animated.Text>
        <Animated.View
          style={[
            styles.rule,
            {
              backgroundColor: lamp,
              opacity: rule,
              transform: [{ scaleX: ruleScale }],
            },
          ]}
        />
      </View>
      {connection === 'refreshing' ? (
        <Text
          style={[styles.status, { color: colors.muted }]}
          accessibilityLiveRegion="polite"
        >
          {t('startup.refreshing')}
        </Text>
      ) : null}
      {connection === 'needsRefresh' ? (
        <View style={styles.notice} accessibilityLiveRegion="polite">
          <Text style={[styles.noticeTitle, { color: colors.text }]}>
            {t('startup.stuckTitle')}
          </Text>
          <Text style={[styles.noticeBody, { color: colors.muted }]}>
            {t('startup.stuckBody')}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={onRefresh}
            style={({ pressed }) => [
              styles.refresh,
              { backgroundColor: colors.primary, opacity: pressed ? 0.82 : 1 },
            ]}
          >
            <Text style={[styles.refreshText, { color: colors.primaryOn }]}>
              {t('startup.refresh')}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={onContinue}
            style={styles.openAnyway}
          >
            <Text style={[styles.openAnywayText, { color: colors.primary }]}>
              {t('startup.openAnyway')}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  status: {
    ...typeScale.meta,
    marginTop: spacing.lg,
    textAlign: 'center',
    maxWidth: 280,
  },
  notice: {
    marginTop: spacing.lg,
    width: '100%',
    maxWidth: 320,
    alignItems: 'center',
  },
  noticeTitle: {
    ...typeScale.section,
    textAlign: 'center',
  },
  noticeBody: {
    ...typeScale.meta,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  refresh: {
    marginTop: spacing.md,
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
  },
  refreshText: {
    fontWeight: '700',
    fontSize: 15,
  },
  openAnyway: {
    marginTop: spacing.sm,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  openAnywayText: {
    fontWeight: '700',
    fontSize: 15,
  },
  stage: {
    alignItems: 'center',
    width: 220,
    height: 220,
    justifyContent: 'center',
  },
  bloom: {
    position: 'absolute',
    width: 168,
    height: 168,
    borderRadius: 84,
  },
  mark: {
    width: 72,
    height: 72,
  },
  post: {
    position: 'absolute',
    left: 12,
    top: 24,
    width: 7,
    height: 40,
    borderRadius: 4,
  },
  postFar: {
    left: 53,
    opacity: 0.42,
  },
  hinge: {
    position: 'absolute',
    left: 18,
    top: 30,
    width: 1,
    height: 1,
  },
  boom: {
    position: 'absolute',
    left: 0,
    top: -3.5,
    width: 40,
    height: 7,
    borderRadius: 4,
  },
  pivot: {
    position: 'absolute',
    left: 14,
    top: 26,
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  word: {
    ...typeScale.eyebrow,
    marginTop: 22,
    letterSpacing: 4.2,
    fontSize: 12,
  },
  rule: {
    marginTop: 14,
    height: 1,
    width: 56,
  },
});
