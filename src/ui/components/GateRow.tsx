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
  useWindowDimensions,
  View,
} from 'react-native';
import { gateCardMarks } from '../../data/gateCardFacts';
import { displayGateName, effectiveHoldMs, type GateConfig } from '../../data/gatesStore';
import { isolateBidiText } from '../../i18n/bidi';
import { useRtlLayout } from '../../i18n/useRtlLayout';
import { formatCoordPair } from '../streetName';
import { IconInfo } from '../icons';
import { useReduceMotion } from '../useReduceMotion';
import { BarrierMark } from './BarrierMark';
import { HintSheet } from './ConfirmSheet';
import { useTheme } from '../ThemeProvider';
import { HUD_TEAL, radii, type ThemeColors } from '../theme';
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
  onCardTouchStart?: (pageY: number) => void;
  onCardTouchMove?: (pageY: number) => void;
  onCardTouchEnd?: () => void;
  /** Sit inside a list card — no second chrome. */
  embedded?: boolean;
};

export function GateRow({
  gate,
  onPress,
  onLongPress,
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
  onCardTouchStart,
  onCardTouchMove,
  onCardTouchEnd,
  embedded = false,
}: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { fontScale } = useWindowDimensions();
  const reduceMotion = useReduceMotion();
  const { isRtl, row, writingDirection, textAlign } = useRtlLayout();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const name = isolateBidiText(displayGateName(gate), isRtl);
  const marks = gateCardMarks(gate);
  const shareOff = marks.shareOff;
  const tight = fontScale >= 1.3;
  const [hintOpen, setHintOpen] = useState(false);
  const infoScale = useRef(new Animated.Value(1)).current;
  const openScale = useRef(new Animated.Value(1)).current;
  const openLamp = useRef(new Animated.Value(0)).current;
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
    if (reduceMotion) {
      sheen.setValue(1);
      const id = setTimeout(() => {
        sheen.setValue(0);
        setFlashLabel(null);
      }, 900);
      return () => clearTimeout(id);
    }
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
  }, [openFlash, reduceMotion, sheen]);

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
  } else if (gate.enabled && marks.hasPin) {
    status = t('gates.opensArrive', { meters: gate.radiusMeters });
  } else if (gate.enabled && !marks.hasPin) {
    status = t('gates.needsPin');
  } else if (marks.hasPin) {
    status = t('gates.manualMeters', { meters: gate.radiusMeters });
  } else {
    status = t('gates.manualNoPin');
  }

  const openKind =
    flashLabel === 'Opened' ? 'success' : flashLabel === 'Failed' ? 'fail' : null;

  const captionBits = [
    marks.meters != null ? t('gates.markMeters', { meters: marks.meters }) : null,
    marks.bluetooth ? t('gates.markBt') : null,
    marks.hold ? t('gates.markHold') : null,
    marks.shared ? t('gates.markShared') : null,
  ].filter((bit): bit is string => Boolean(bit));

  const pulseOpen = (down: boolean) => {
    if (reduceMotion) {
      openScale.setValue(1);
      openLamp.setValue(down ? 1 : 0);
      return;
    }
    Animated.parallel([
      Animated.timing(openScale, {
        toValue: down ? 0.96 : 1,
        duration: down ? 80 : 160,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(openLamp, {
        toValue: down ? 1 : 0,
        duration: down ? 70 : 200,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();
  };

  const openHint = () => {
    if (!reduceMotion) {
      Animated.sequence([
        Animated.timing(infoScale, {
          toValue: 0.86,
          duration: 80,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(infoScale, {
          toValue: 1,
          duration: 140,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start();
    }
    setHintOpen(true);
  };

  const btDevices = gate.bluetooth.required
    ? gate.bluetooth.devices
        .map((d) => [d.name?.trim(), d.address?.trim()].filter(Boolean).join(' · '))
        .filter(Boolean)
    : [];

  const hintRows: Array<{ label: string; value: string }> = [
    marks.hiddenPalGateName
      ? { label: t('gates.hintPalGate'), value: marks.hiddenPalGateName }
      : null,
    marks.meters != null
      ? {
          label: t('gates.hintRadius'),
          value: t('gates.markMeters', { meters: marks.meters }),
        }
      : null,
    {
      label: t('gates.hintPin'),
      value:
        marks.hasPin && gate.lat != null && gate.lng != null
          ? formatCoordPair(gate.lat, gate.lng)
          : t('gates.hintNoPin'),
    },
    {
      label: t('gates.hintBt'),
      value: marks.bluetooth
        ? btDevices.length
          ? btDevices.join('\n')
          : t('editor.requireBt')
        : t('gates.hintBtOff'),
    },
    {
      label: t('gates.hintHold'),
      value: marks.hold
        ? t('editor.holdValue', {
            seconds: Math.max(
              1,
              Math.round(effectiveHoldMs(gate.holdEnabled, gate.holdMs) / 1000),
            ),
          })
        : t('gates.hintHoldOff'),
    },
    {
      label: t('editor.cooldown'),
      value: t('editor.cooldownValue', {
        seconds: Math.max(1, Math.round((gate.cooldownMs || 0) / 1000)),
      }),
    },
    marks.shared
      ? {
          label: t('gates.hintShared'),
          value: [
            gate.sharedFromName
              ? t('gates.hintFrom', { name: gate.sharedFromName })
              : t('systems.fromInvite'),
            gate.sharedInviteCode
              ? t('gates.hintInvite', { code: gate.sharedInviteCode })
              : null,
          ]
            .filter(Boolean)
            .join('\n'),
        }
      : null,
  ].filter((row): row is { label: string; value: string } => Boolean(row));

  return (
    <View
      style={[
        styles.row,
        { flexDirection: row },
        embedded && styles.rowEmbedded,
        dragging && styles.rowDragging,
      ]}
      onTouchStart={(e) => onCardTouchStart?.(e.nativeEvent.pageY)}
      onTouchMove={(e) => onCardTouchMove?.(e.nativeEvent.pageY)}
      onTouchEnd={() => onCardTouchEnd?.()}
      onTouchCancel={() => onCardTouchEnd?.()}
    >
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
      {onReorderGrant ? (
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
      ) : null}
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
          pinned={marks.hasPin}
        />
        {selecting ? (
          <View
            style={[styles.check, selected && styles.checkOn]}
            accessibilityLabel={
              selected ? t('common.selected') : t('common.notSelected')
            }
          >
            {selected ? <View style={styles.checkDot} /> : null}
          </View>
        ) : null}
        <View style={styles.main}>
          <View style={[styles.nameRow, { flexDirection: row }]}>
            <Text
              style={[styles.name, { writingDirection, textAlign }]}
              numberOfLines={2}
              ellipsizeMode="tail"
            >
              {name}
            </Text>
            <Animated.View style={{ transform: [{ scale: infoScale }] }}>
              <Pressable
                onPress={openHint}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t('gates.hintA11y')}
                style={styles.infoBtn}
              >
                <IconInfo color={colors.muted} size={16} />
              </Pressable>
            </Animated.View>
          </View>
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
          {!tight && captionBits.length > 0 ? (
            <Text
              style={[styles.marks, { writingDirection, textAlign }]}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {captionBits.join(' · ')}
            </Text>
          ) : null}
        </View>
        {!shareOff ? (
          <Animated.View style={{ transform: [{ scale: openScale }] }}>
            <Pressable
              style={[
                styles.openBtn,
                opening && styles.openBtnDisabled,
                openKind === 'success' && styles.openBtnOk,
                openKind === 'fail' && styles.openBtnFail,
              ]}
              onPress={onOpen}
              onPressIn={() => pulseOpen(true)}
              onPressOut={() => pulseOpen(false)}
              disabled={opening}
              hitSlop={6}
            >
              <Animated.View
                pointerEvents="none"
                style={[styles.openLamp, { opacity: openLamp }]}
              />
              {opening ? (
                <ActivityIndicator color={colors.primaryOn} size="small" />
              ) : (
                <Text
                  style={[
                    styles.openText,
                    openKind === 'success' && styles.openTextOk,
                    openKind === 'fail' && styles.openTextFail,
                  ]}
                  numberOfLines={1}
                >
                  {flashLabel === 'Opened'
                    ? t('gates.opened')
                    : flashLabel === 'Failed'
                      ? t('gates.failed')
                      : t('open')}
                </Text>
              )}
            </Pressable>
          </Animated.View>
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
            numberOfLines={1}
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
        <Text style={styles.removeHint} numberOfLines={2}>
          {t('common.remove')}
        </Text>
      )}
      <HintSheet
        visible={hintOpen}
        title={isolateBidiText(displayGateName(gate), isRtl)}
        message={status}
        rows={hintRows}
        onDismiss={() => setHintOpen(false)}
      />
    </View>
  );
}

function createStyles(c: ThemeColors) {
  return StyleSheet.create({
    row: {
      alignItems: 'center',
      paddingStart: 6,
      paddingEnd: 12,
      backgroundColor: c.surface,
      overflow: 'hidden',
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: c.border,
      minWidth: 0,
    },
    rowEmbedded: {
      borderWidth: 0,
      borderRadius: 0,
      backgroundColor: 'transparent',
    },
    rowBody: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 10,
      paddingStart: 4,
      gap: 8,
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
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1,
      flexShrink: 0,
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
    nameRow: {
      alignItems: 'center',
      gap: 4,
      minWidth: 0,
      alignSelf: 'stretch',
    },
    name: {
      flex: 1,
      minWidth: 0,
      fontSize: 16,
      lineHeight: 21,
      fontWeight: '600',
      color: c.text,
    },
    infoBtn: {
      width: 36,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    meta: {
      fontSize: 13,
      color: c.muted,
      flexShrink: 1,
      alignSelf: 'stretch',
    },
    marks: {
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 0.2,
      color: c.primary,
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
    openBtn: {
      backgroundColor: c.primary,
      paddingHorizontal: 14,
      minHeight: 44,
      minWidth: 68,
      borderRadius: radii.pill,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    openLamp: {
      ...StyleSheet.absoluteFill,
      borderRadius: radii.pill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: HUD_TEAL,
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
      justifyContent: 'center',
      gap: 2,
      flexShrink: 0,
      minHeight: 44,
      paddingStart: 4,
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
      flexShrink: 0,
      maxWidth: 88,
    },
    check: {
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    checkOn: {
      borderColor: HUD_TEAL,
      backgroundColor: 'transparent',
    },
    checkDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: HUD_TEAL,
    },
  });
}
