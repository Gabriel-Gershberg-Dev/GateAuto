import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useRtlLayout } from '../../i18n/useRtlLayout';
import { IconClose, IconLayers, IconShare, IconTrash, IconUnlink } from '../icons';
import { useTheme } from '../ThemeProvider';
import { HUD_TEAL, type, type ThemeColors } from '../theme';
import { useReduceMotion } from '../useReduceMotion';

export const SELECTION_KEY_MIN_HEIGHT = 46;
const SCAN_TICK = 36;

type Props = {
  visible: boolean;
  count: number;
  showShare: boolean;
  showRemove: boolean;
  showList?: boolean;
  /** List is on for 2+ gates, or 1+ when a list already exists. */
  listEnabled?: boolean;
  showUngroup?: boolean;
  onShare: () => void;
  onRemove: () => void;
  onList?: () => void;
  onUngroup?: () => void;
  onCancel: () => void;
};

type Tone = 'teal' | 'danger' | 'mute';

export function SelectionHud({
  visible,
  count,
  showShare,
  showRemove,
  showList = false,
  listEnabled,
  showUngroup = false,
  onShare,
  onRemove,
  onList,
  onUngroup,
  onCancel,
}: Props) {
  const canList = listEnabled ?? count >= 2;
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { isRtl, row, writingDirection } = useRtlLayout();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const progress = useRef(new Animated.Value(0)).current;
  const scan = useRef(new Animated.Value(0)).current;
  const [clusterW, setClusterW] = useState(0);

  useEffect(() => {
    if (!visible) {
      progress.setValue(0);
      scan.setValue(0);
      return;
    }
    if (reduceMotion) {
      progress.setValue(1);
      scan.setValue(1);
      return;
    }
    progress.setValue(0);
    scan.setValue(0);
    Animated.timing(progress, {
      toValue: 1,
      duration: 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    Animated.timing(scan, {
      toValue: 1,
      duration: 700,
      easing: Easing.inOut(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [progress, reduceMotion, scan, visible]);

  if (!visible) return null;

  let fadeIndex = 0;
  const nextFade = () => {
    const i = fadeIndex;
    fadeIndex += 1;
    return reduceMotion
      ? 1
      : progress.interpolate({
          inputRange: [0, 0.22 + i * 0.12, 0.42 + i * 0.12],
          outputRange: [0, 0, 1],
          extrapolate: 'clamp',
        });
  };

  const readoutFade = nextFade();
  const listFade = showList ? nextFade() : null;
  const ungroupFade = showUngroup ? nextFade() : null;
  const shareFade = showShare ? nextFade() : null;
  const removeFade = showRemove ? nextFade() : null;
  const closeFade = nextFade();

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.wrap,
        {
          paddingBottom: Math.max(insets.bottom, 8),
          transform: [
            {
              translateY: reduceMotion
                ? 0
                : progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [10, 0],
                  }),
            },
          ],
        },
      ]}
    >
      <View
        style={[styles.cluster, { flexDirection: row }]}
        onLayout={(e) => setClusterW(e.nativeEvent.layout.width)}
      >
        {!reduceMotion && clusterW > 0 ? (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.scanTick,
              {
                opacity: scan.interpolate({
                  inputRange: [0, 0.12, 0.82, 1],
                  outputRange: [0, 0.55, 0.55, 0],
                }),
                transform: [
                  {
                    translateX: scan.interpolate({
                      inputRange: [0, 1],
                      outputRange: isRtl
                        ? [clusterW, -SCAN_TICK]
                        : [-SCAN_TICK, clusterW],
                    }),
                  },
                ],
              },
            ]}
          />
        ) : null}
        <Animated.View
          style={[styles.readout, { flexDirection: row, opacity: readoutFade }]}
        >
          <View style={styles.pipLamp} />
          <Text style={[styles.count, { writingDirection }]}>{count}</Text>
        </Animated.View>
        <View style={[styles.keys, { flexDirection: row }]}>
          {showList && listFade ? (
            <CommandKey
              fade={listFade}
              writingDirection={writingDirection}
              styles={styles}
              tone="teal"
              disabled={!canList}
              label={t('gates.listAction')}
              a11y={canList ? t('gates.listAddTitle') : t('gates.listMake')}
              onPress={onList}
              icon={<IconLayers color={canList ? HUD_TEAL : colors.muted} size={18} />}
            />
          ) : null}
          {showUngroup && ungroupFade ? (
            <CommandKey
              fade={ungroupFade}
              writingDirection={writingDirection}
              styles={styles}
              tone="mute"
              disabled={count === 0}
              label={t('gates.listRemove')}
              a11y={t('gates.listRemoveA11y')}
              onPress={onUngroup}
              icon={<IconUnlink color={colors.muted} size={18} />}
            />
          ) : null}
          {showShare && shareFade ? (
            <CommandKey
              fade={shareFade}
              writingDirection={writingDirection}
              styles={styles}
              tone="teal"
              disabled={count === 0}
              label={t('gates.shareAction')}
              a11y={t('gates.shareBar', { count: Math.max(count, 1) })}
              onPress={onShare}
              icon={
                <IconShare color={count === 0 ? colors.muted : HUD_TEAL} size={18} />
              }
            />
          ) : null}
          {showRemove && removeFade ? (
            <CommandKey
              fade={removeFade}
              writingDirection={writingDirection}
              styles={styles}
              tone="danger"
              disabled={count === 0}
              label={t('common.remove')}
              a11y={t('gates.removeBar', { count: Math.max(count, 1) })}
              onPress={onRemove}
              icon={
                <IconTrash
                  color={count === 0 ? colors.muted : colors.danger}
                  size={18}
                />
              }
            />
          ) : null}
        </View>
        <Animated.View style={{ opacity: closeFade }}>
          <Pressable
            onPress={onCancel}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={t('common.cancel')}
            style={({ pressed }) => [styles.closeKey, pressed && styles.pressed]}
          >
            <IconClose color={colors.muted} size={16} />
          </Pressable>
        </Animated.View>
        <View pointerEvents="none" style={styles.horizon} />
      </View>
    </Animated.View>
  );
}

function CommandKey({
  fade,
  writingDirection,
  styles,
  tone,
  disabled,
  label,
  a11y,
  onPress,
  icon,
}: {
  fade: Animated.AnimatedInterpolation<number> | number;
  writingDirection: 'ltr' | 'rtl';
  styles: ReturnType<typeof createStyles>;
  tone: Tone;
  disabled: boolean;
  label: string;
  a11y: string;
  onPress?: () => void;
  icon: ReactNode;
}) {
  const labelStyle =
    tone === 'danger'
      ? styles.keyLabelDanger
      : tone === 'mute'
        ? styles.keyLabelMute
        : styles.keyLabelTeal;

  return (
    <Animated.View style={[styles.keySlot, { opacity: fade }]}>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        hitSlop={4}
        accessibilityRole="button"
        accessibilityLabel={a11y}
        style={({ pressed }) => [
          styles.key,
          pressed && styles.pressed,
          disabled && styles.disabled,
        ]}
      >
        <View style={[styles.keyTick, tone === 'danger' && styles.keyTickDanger]} />
        {icon}
        <Text
          style={[styles.keyLabel, labelStyle, { writingDirection }]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.75}
        >
          {label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

function createStyles(c: ThemeColors) {
  return StyleSheet.create({
    wrap: {
      marginHorizontal: 16,
      marginBottom: 4,
    },
    cluster: {
      alignItems: 'center',
      alignSelf: 'stretch',
      justifyContent: 'flex-start',
      flexWrap: 'nowrap',
      gap: 6,
      position: 'relative',
      paddingBottom: 8,
    },
    horizon: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      height: StyleSheet.hairlineWidth,
      backgroundColor: HUD_TEAL,
      opacity: 0.45,
    },
    scanTick: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      width: SCAN_TICK,
      height: 1,
      backgroundColor: HUD_TEAL,
    },
    readout: {
      alignItems: 'center',
      gap: 6,
      minHeight: SELECTION_KEY_MIN_HEIGHT,
      minWidth: 28,
      paddingHorizontal: 2,
      flexShrink: 0,
    },
    pipLamp: {
      width: 7,
      height: 7,
      borderRadius: 4,
      backgroundColor: HUD_TEAL,
    },
    count: {
      fontSize: 15,
      fontWeight: '600',
      color: HUD_TEAL,
      fontFamily: type.mono.fontFamily,
      fontVariant: ['tabular-nums'],
      minWidth: 16,
      textAlign: 'center',
    },
    keys: {
      flex: 1,
      minWidth: 0,
      alignItems: 'stretch',
      justifyContent: 'space-evenly',
      flexWrap: 'nowrap',
      gap: 2,
    },
    keySlot: {
      flex: 1,
      minWidth: 0,
    },
    key: {
      minHeight: SELECTION_KEY_MIN_HEIGHT,
      paddingHorizontal: 4,
      paddingTop: 6,
      paddingBottom: 2,
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: 3,
    },
    keyTick: {
      position: 'absolute',
      top: 0,
      width: 12,
      height: 1,
      backgroundColor: HUD_TEAL,
      opacity: 0.7,
    },
    keyTickDanger: {
      backgroundColor: c.danger,
    },
    keyLabel: {
      fontWeight: '700',
      fontSize: 11,
      letterSpacing: 0.2,
      textAlign: 'center',
      alignSelf: 'stretch',
    },
    keyLabelTeal: {
      color: HUD_TEAL,
    },
    keyLabelDanger: {
      color: c.danger,
    },
    keyLabelMute: {
      color: c.muted,
    },
    closeKey: {
      width: 36,
      height: 36,
      borderRadius: 18,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    pressed: {
      opacity: 0.72,
    },
    disabled: {
      opacity: 0.38,
    },
  });
}
