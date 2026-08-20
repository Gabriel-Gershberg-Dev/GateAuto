import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { displayGateName, type GateConfig } from '../../data/gatesStore';
import { isolateBidiText } from '../../i18n/bidi';
import { useRtlLayout } from '../../i18n/useRtlLayout';
import { BarrierMark } from './BarrierMark';
import { IconShare } from '../icons';
import { useTheme } from '../ThemeProvider';
import { radii, type ThemeColors } from '../theme';
import { useTranslation } from 'react-i18next';

export type GateOpenFlash = {
  kind: 'success' | 'fail';
  nonce: number;
  message?: string;
};

type Props = {
  gate: GateConfig;
  onPress: () => void;
  onLongPress?: () => void;
  onShare?: () => void;
  onToggleEnabled: (enabled: boolean) => void;
  /** Master Auto-open in Settings. When off, the per-gate Auto switch is locked. */
  autoOpenMaster?: boolean;
  onAutoOpenBlocked?: () => void;
  onOpen: () => void;
  opening?: boolean;
  /** Remaining safety-lock time for this gate (auto-open only); 0/undefined = unlocked. */
  safetyLockRemainingMs?: number;
  dragging?: boolean;
  openFlash?: GateOpenFlash | null;
  onReorderGrant?: () => void;
  onReorderMove?: (dy: number) => void;
  onReorderRelease?: () => void;
  selecting?: boolean;
  selected?: boolean;
};

export function GateRow({
  gate,
  onPress,
  onLongPress,
  onShare,
  onToggleEnabled,
  autoOpenMaster = true,
  onAutoOpenBlocked,
  onOpen,
  opening = false,
  safetyLockRemainingMs = 0,
  dragging = false,
  openFlash = null,
  onReorderGrant,
  onReorderMove,
  onReorderRelease,
  selecting = false,
  selected = false,
}: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { isRtl, row, writingDirection, textAlign } = useRtlLayout();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const name = isolateBidiText(displayGateName(gate), isRtl);
  const hasPin = gate.lat != null && gate.lng != null;
  const shareOff = Boolean(gate.shareDisabled);
  const lockMins =
    safetyLockRemainingMs > 0
      ? Math.max(1, Math.ceil(safetyLockRemainingMs / 60_000))
      : 0;

  const reorderCbs = useRef({
    grant: onReorderGrant,
    move: onReorderMove,
    release: onReorderRelease,
  });
  reorderCbs.current = {
    grant: onReorderGrant,
    move: onReorderMove,
    release: onReorderRelease,
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: () => reorderCbs.current.grant?.(),
      onPanResponderMove: (_e, g) => reorderCbs.current.move?.(g.dy),
      onPanResponderRelease: () => reorderCbs.current.release?.(),
      onPanResponderTerminate: () => reorderCbs.current.release?.(),
    }),
  ).current;

  const sheen = useRef(new Animated.Value(0)).current;
  const [flashLabel, setFlashLabel] = useState<'Opened' | 'Failed' | null>(
    null,
  );

  useEffect(() => {
    if (!openFlash) return;
    setFlashLabel(openFlash.kind === 'success' ? 'Opened' : 'Failed');
    sheen.setValue(0);
    Animated.sequence([
      Animated.timing(sheen, {
        toValue: 1,
        duration: 280,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.delay(1100),
      Animated.timing(sheen, {
        toValue: 0,
        duration: 420,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) setFlashLabel(null);
    });
  }, [openFlash, sheen]);

  let status: string;
  if (shareOff) {
    status = t('gates.shareDisabled');
  } else if (flashLabel === 'Opened') {
    status = openFlash?.message || t('gates.openedOk');
  } else if (flashLabel === 'Failed') {
    status = openFlash?.message || t('gates.couldntOpen');
  } else if (lockMins > 0) {
    status = t('gates.autoLocked', { mins: lockMins });
  } else if (!autoOpenMaster && gate.enabled) {
    status = t('gates.paused');
  } else if (gate.enabled && hasPin) {
    status = t('gates.opensArrive', { meters: gate.radiusMeters });
  } else if (gate.enabled && !hasPin) {
    status = t('gates.needsPin');
  } else if (hasPin) {
    status = t('gates.manualMeters', { meters: gate.radiusMeters });
  } else {
    status = t('gates.manualNoPin');
  }

  const openKind = flashLabel === 'Opened' ? 'success' : flashLabel === 'Failed' ? 'fail' : null;

  return (
    <View style={[styles.row, { flexDirection: row }, dragging && styles.rowDragging]}>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.sheen,
          {
            backgroundColor:
              openKind === 'fail' ? colors.failBg : colors.successBg,
            opacity: sheen,
          },
        ]}
      />
      <View
        {...pan.panHandlers}
        accessibilityLabel={t('gates.reorder')}
        accessibilityRole="adjustable"
        hitSlop={8}
        style={styles.notchHit}
        collapsable={false}
      >
        <View style={[styles.notch, dragging && styles.notchActive]} />
      </View>
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        delayLongPress={420}
        android_ripple={
          dragging ? undefined : { color: colors.surfacePressed }
        }
        style={({ pressed }) => [
          styles.rowBody,
          { flexDirection: row },
          pressed && !dragging && Platform.OS === 'ios'
            ? styles.rowPressed
            : null,
        ]}
      >
        <BarrierMark
          size={26}
          watching={
            autoOpenMaster &&
            gate.enabled &&
            openKind !== 'success' &&
            !opening
          }
          opening={opening || openKind === 'success'}
          pinned={hasPin}
        />
        {selecting ? (
          <View
            style={[styles.check, selected && styles.checkOn]}
            accessibilityLabel={selected ? t('common.selected') : t('common.notSelected')}
          >
            {selected ? <View style={styles.checkDot} /> : null}
          </View>
        ) : null}
        <View style={styles.main}>
          <Text
            style={[styles.name, { writingDirection, textAlign }]}
            numberOfLines={2}
            ellipsizeMode="tail"
          >
            {name}
          </Text>
          <Text
            style={[
              styles.meta,
              { writingDirection, textAlign },
              lockMins > 0 && !flashLabel && styles.lockHint,
              !autoOpenMaster &&
                gate.enabled &&
                !flashLabel &&
                styles.lockHint,
              openKind === 'success' && styles.okHint,
              openKind === 'fail' && styles.failHint,
            ]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {status}
          </Text>
        </View>
        {onShare && !selecting && !shareOff ? (
          <Pressable
            onPress={onShare}
            hitSlop={8}
            accessibilityLabel={t('gates.shareOne')}
            style={styles.shareBtn}
          >
            <IconShare color={colors.muted} size={18} />
          </Pressable>
        ) : null}
        {!shareOff ? (
        <Pressable
          style={({ pressed }) => [
            styles.openBtn,
            opening && styles.openBtnDisabled,
            pressed && styles.openBtnPressed,
            openKind === 'success' && styles.openBtnOk,
            openKind === 'fail' && styles.openBtnFail,
          ]}
          onPress={onOpen}
          disabled={opening}
          hitSlop={6}
        >
          {opening ? (
            <ActivityIndicator color={colors.primaryOn} size="small" />
          ) : (
            <Text
              style={[
                styles.openText,
                openKind === 'success' && styles.openTextOk,
                openKind === 'fail' && styles.openTextFail,
              ]}
            >
              {flashLabel === 'Opened'
                ? t('gates.opened')
                : flashLabel === 'Failed'
                  ? t('gates.failed')
                  : t('open')}
            </Text>
          )}
        </Pressable>
        ) : null}
      </Pressable>
      {!shareOff ? (
      <Pressable
        onPress={() => {
          if (!autoOpenMaster) onAutoOpenBlocked?.();
        }}
        style={[styles.toggleWrap, !autoOpenMaster && styles.toggleLocked]}
      >
        <Text
          style={[
            styles.toggleLabel,
            !autoOpenMaster && styles.toggleLabelLocked,
          ]}
        >
          {t('autoOpen.auto')}
        </Text>
        <View pointerEvents={autoOpenMaster ? 'auto' : 'none'}>
          <Switch
            value={gate.enabled}
            disabled={!autoOpenMaster}
            onValueChange={onToggleEnabled}
            trackColor={{
              false: colors.border,
              true: autoOpenMaster ? colors.primaryMuted : colors.border,
            }}
            thumbColor={
              autoOpenMaster && gate.enabled
                ? colors.primary
                : colors.switchThumbOff
            }
          />
        </View>
      </Pressable>
      ) : (
        <Text style={styles.removeHint}>{t('common.remove')}</Text>
      )}
    </View>
  );
}

function createStyles(c: ThemeColors) {
  return StyleSheet.create({
    row: {
      alignItems: 'center',
      paddingStart: 6,
      paddingEnd: 16,
      backgroundColor: c.surface,
      overflow: 'hidden',
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: c.border,
    },
    rowBody: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 12,
      paddingStart: 4,
      gap: 10,
      minWidth: 0,
    },
    rowPressed: {
      backgroundColor: c.surfacePressed,
    },
    rowDragging: {
      backgroundColor: c.surface,
    },
    sheen: {
      ...StyleSheet.absoluteFill,
    },
    notchHit: {
      width: 36,
      height: 52,
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1,
    },
    notch: {
      width: 5,
      height: 22,
      borderRadius: 3,
      backgroundColor: c.muted,
      opacity: 0.38,
    },
    notchActive: {
      opacity: 0.85,
      backgroundColor: c.primary,
    },
    main: {
      flex: 1,
      minWidth: 0,
      gap: 2,
    },
    name: {
      fontSize: 16,
      lineHeight: 21,
      fontWeight: '600',
      color: c.text,
      flexShrink: 1,
      alignSelf: 'stretch',
    },
    meta: {
      fontSize: 14,
      color: c.muted,
      flexShrink: 1,
      alignSelf: 'stretch',
    },
    lockHint: {
      color: c.warning,
      fontWeight: '600',
    },
    okHint: {
      color: c.success,
      fontWeight: '600',
    },
    failHint: {
      color: c.fail,
      fontWeight: '600',
    },
    shareBtn: {
      width: 36,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    openBtn: {
      backgroundColor: c.primary,
      paddingHorizontal: 18,
      height: 44,
      minWidth: 72,
      borderRadius: radii.pill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    openBtnPressed: {
      opacity: 0.88,
    },
    openBtnDisabled: {
      opacity: 0.55,
    },
    openBtnOk: {
      backgroundColor: c.success,
    },
    openBtnFail: {
      backgroundColor: c.fail,
    },
    openText: {
      color: c.primaryOn,
      fontWeight: '700',
      fontSize: 15,
    },
    openTextOk: {
      color: c.primaryOn,
    },
    openTextFail: {
      color: '#FFFFFF',
    },
    toggleWrap: {
      alignItems: 'center',
      gap: 2,
    },
    toggleLocked: {
      opacity: 0.42,
    },
    toggleLabel: {
      fontSize: 11,
      fontWeight: '600',
      color: c.muted,
    },
    toggleLabelLocked: {
      color: c.muted,
    },
    removeHint: {
      fontSize: 13,
      fontWeight: '700',
      color: c.danger,
      paddingStart: 8,
    },
    check: {
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 2,
      borderColor: c.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkOn: {
      borderColor: c.primary,
      backgroundColor: c.primaryMuted,
    },
    checkDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: c.primary,
    },
  });
}
