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
import { BarrierMark } from './BarrierMark';
import { IconShare } from '../icons';
import { useTheme } from '../ThemeProvider';
import { radii, type ThemeColors } from '../theme';

export type GateOpenFlash = {
  kind: 'success' | 'fail';
  nonce: number;
  message?: string;
};

type Props = {
  gate: GateConfig;
  onPress: () => void;
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
};

export function GateRow({
  gate,
  onPress,
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
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const hasPin = gate.lat != null && gate.lng != null;
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
  if (flashLabel === 'Opened') {
    status = openFlash?.message || 'Opened successfully';
  } else if (flashLabel === 'Failed') {
    status = openFlash?.message || 'Couldn’t open';
  } else if (lockMins > 0) {
    status = `Auto locked · ${lockMins}m`;
  } else if (!autoOpenMaster && gate.enabled) {
    status = 'Paused in Settings';
  } else if (gate.enabled && hasPin) {
    status = `Opens on arrive · ${gate.radiusMeters} m`;
  } else if (gate.enabled && !hasPin) {
    status = 'Needs a pin';
  } else if (hasPin) {
    status = `Manual · ${gate.radiusMeters} m`;
  } else {
    status = 'Manual · no pin';
  }

  const openKind = flashLabel === 'Opened' ? 'success' : flashLabel === 'Failed' ? 'fail' : null;

  return (
    <View style={[styles.row, dragging && styles.rowDragging]}>
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
        accessibilityLabel="Hold and drag to reorder"
        accessibilityRole="adjustable"
        hitSlop={8}
        style={styles.notchHit}
        collapsable={false}
      >
        <View style={[styles.notch, dragging && styles.notchActive]} />
      </View>
      <Pressable
        onPress={onPress}
        android_ripple={
          dragging ? undefined : { color: colors.surfacePressed }
        }
        style={({ pressed }) => [
          styles.rowBody,
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
        <View style={styles.main}>
          <Text style={styles.name} numberOfLines={1}>
            {displayGateName(gate)}
          </Text>
          <Text
            style={[
              styles.meta,
              lockMins > 0 && !flashLabel && styles.lockHint,
              !autoOpenMaster &&
                gate.enabled &&
                !flashLabel &&
                styles.lockHint,
              openKind === 'success' && styles.okHint,
              openKind === 'fail' && styles.failHint,
            ]}
            numberOfLines={1}
          >
            {status}
          </Text>
        </View>
        {onShare ? (
          <Pressable
            onPress={onShare}
            hitSlop={8}
            accessibilityLabel="Share gate"
            style={styles.shareBtn}
          >
            <IconShare color={colors.muted} size={18} />
          </Pressable>
        ) : null}
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
              {flashLabel ?? 'Open'}
            </Text>
          )}
        </Pressable>
      </Pressable>
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
          Auto
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
    </View>
  );
}

function createStyles(c: ThemeColors) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingLeft: 6,
      paddingRight: 16,
      backgroundColor: c.surface,
      overflow: 'hidden',
      borderRadius: radii.md,
    },
    rowBody: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 18,
      paddingLeft: 4,
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
      gap: 4,
    },
    name: {
      fontSize: 18,
      fontWeight: '600',
      color: c.text,
      letterSpacing: -0.2,
    },
    meta: {
      fontSize: 14,
      color: c.muted,
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
      color: '#041210',
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
  });
}
