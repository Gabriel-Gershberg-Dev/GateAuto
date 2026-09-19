import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isolateBidiText } from '../../i18n/bidi';
import { useRtlLayout } from '../../i18n/useRtlLayout';
import { useTheme } from '../ThemeProvider';
import { useTranslation } from 'react-i18next';
import { HUD_TEAL, HUD_TEAL_LINE, radii, spacing, type, type ThemeColors } from '../theme';
import {
  sheetAvoidKeyboard,
  useKeyboardBottomInset,
} from '../useKeyboardBottomInset';
import { useReduceMotion } from '../useReduceMotion';

type Props = {
  visible: boolean;
  icon?: ReactNode;
  title: string;
  message: string;
  children?: ReactNode;
  cancelLabel: string;
  confirmLabel: string;
  extraLabel?: string;
  destructive?: boolean;
  confirmDisabled?: boolean;
  /** Hug-content 36px keys — Remove confirm, not full-width slabs. */
  compact?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  onExtra?: () => void;
};

function useSheetProgress(visible: boolean, duration: number) {
  const progress = useRef(new Animated.Value(0)).current;
  const reduceMotion = useReduceMotion();

  useEffect(() => {
    if (!visible) {
      progress.setValue(0);
      return;
    }
    if (reduceMotion) {
      progress.setValue(1);
      return;
    }
    progress.setValue(0);
    Animated.timing(progress, {
      toValue: 1,
      duration,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [duration, progress, reduceMotion, visible]);

  return progress;
}

export function ConfirmSheet({
  visible,
  icon,
  title,
  message,
  children,
  cancelLabel,
  confirmLabel,
  extraLabel,
  destructive = false,
  confirmDisabled = false,
  compact = false,
  onCancel,
  onConfirm,
  onExtra,
}: Props) {
  const { colors } = useTheme();
  const { row } = useRtlLayout();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardBottomInset();
  const progress = useSheetProgress(visible, 280);
  const pad = sheetAvoidKeyboard(insets.bottom, keyboardHeight);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onCancel}
    >
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        enabled={Platform.OS === 'ios'}
        pointerEvents={visible ? 'auto' : 'none'}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel}>
          <Animated.View style={[styles.scrim, { opacity: progress }]} />
        </Pressable>
        <Animated.View
          style={[
            styles.sheet,
            pad,
            {
              opacity: progress,
              transform: [
                {
                  translateY: progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [36, 0],
                  }),
                },
              ],
            },
          ]}
        >
          {icon ? <View style={styles.iconWrap}>{icon}</View> : null}
          <Text style={styles.title}>{title}</Text>
          {message ? <Text style={styles.message}>{message}</Text> : null}
          {children ? (
            <ScrollView
              style={styles.bodyScroll}
              contentContainerStyle={styles.bodyScrollContent}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
            >
              {children}
            </ScrollView>
          ) : null}
          {extraLabel && onExtra ? (
            <Pressable
              onPress={onExtra}
              style={({ pressed }) => [styles.extraBtn, pressed && styles.pressed]}
            >
              <Text style={styles.extraText}>{extraLabel}</Text>
            </Pressable>
          ) : null}
          {compact ? (
            <View style={[styles.compactRow, { flexDirection: row }]}>
              <Pressable
                onPress={onCancel}
                style={({ pressed }) => [
                  styles.compactBtn,
                  styles.btnGhost,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.compactBtnText} numberOfLines={1}>
                  {cancelLabel}
                </Text>
              </Pressable>
              <Pressable
                onPress={onConfirm}
                disabled={confirmDisabled}
                style={({ pressed }) => [
                  styles.compactBtn,
                  destructive ? styles.btnDanger : styles.btnPrimary,
                  pressed && styles.pressed,
                  confirmDisabled && styles.disabled,
                ]}
              >
                <Text
                  style={
                    destructive
                      ? styles.compactDangerText
                      : styles.compactPrimaryText
                  }
                  numberOfLines={1}
                >
                  {confirmLabel}
                </Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.actions}>
              <Pressable
                onPress={onCancel}
                style={({ pressed }) => [
                  styles.btn,
                  styles.btnGhost,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.btnGhostText} numberOfLines={1}>
                  {cancelLabel}
                </Text>
              </Pressable>
              <Pressable
                onPress={onConfirm}
                disabled={confirmDisabled}
                style={({ pressed }) => [
                  styles.btn,
                  destructive ? styles.btnDanger : styles.btnPrimary,
                  pressed && styles.pressed,
                  confirmDisabled && styles.disabled,
                ]}
              >
                <Text
                  style={
                    destructive ? styles.btnDangerText : styles.btnPrimaryText
                  }
                  numberOfLines={1}
                >
                  {confirmLabel}
                </Text>
              </Pressable>
            </View>
          )}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export type SheetAction = {
  key: string;
  label: string;
  onPress: () => void;
  destructive?: boolean;
};

/** Stacked Share / Remove list — same sheet language as ConfirmSheet. */
export function ActionSheet({
  visible,
  title,
  message,
  actions,
  cancelLabel,
  onCancel,
}: {
  visible: boolean;
  title: string;
  message?: string;
  actions: SheetAction[];
  cancelLabel: string;
  onCancel: () => void;
}) {
  const { colors } = useTheme();
  const { row, writingDirection, textAlign } = useRtlLayout();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardBottomInset();
  const progress = useSheetProgress(visible, 240);
  const pad = sheetAvoidKeyboard(insets.bottom, keyboardHeight);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onCancel}
    >
      <View style={styles.root} pointerEvents={visible ? 'auto' : 'none'}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel}>
          <Animated.View style={[styles.scrim, { opacity: progress }]} />
        </Pressable>
        <Animated.View
          style={[
            styles.sheet,
            pad,
            {
              opacity: progress,
              transform: [
                {
                  translateY: progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [28, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <Text style={[styles.title, { writingDirection, textAlign }]}>
            {title}
          </Text>
          {message ? (
            <Text style={[styles.message, { writingDirection, textAlign }]}>
              {message}
            </Text>
          ) : null}
          <View style={styles.actionList}>
            {actions.map((action, index) => (
              <View key={action.key}>
                {index > 0 ? <View style={styles.listHair} /> : null}
                <Pressable
                  onPress={action.onPress}
                  style={({ pressed }) => [
                    styles.listRow,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text
                    style={[
                      styles.listRowText,
                      { writingDirection, textAlign },
                      action.destructive && styles.listRowDanger,
                    ]}
                    numberOfLines={1}
                  >
                    {action.label}
                  </Text>
                </Pressable>
              </View>
            ))}
          </View>
          <View style={[styles.compactRow, { flexDirection: row }]}>
            <Pressable
              onPress={onCancel}
              style={({ pressed }) => [
                styles.compactBtn,
                styles.btnGhost,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.compactBtnText}>{cancelLabel}</Text>
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

function createStyles(c: ThemeColors) {
  return StyleSheet.create({
    root: {
      flex: 1,
      justifyContent: 'flex-end',
    },
    scrim: {
      ...StyleSheet.absoluteFill,
      backgroundColor: c.overlay,
    },
    sheet: {
      marginHorizontal: spacing.md,
      backgroundColor: c.surface,
      borderRadius: radii.lg,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg,
      gap: 10,
      borderWidth: 1,
      borderColor: c.border,
    },
    iconWrap: {
      width: 44,
      height: 44,
      borderRadius: 14,
      backgroundColor: c.primaryMuted,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 4,
    },
    title: {
      fontSize: 22,
      fontWeight: '700',
      color: c.text,
      letterSpacing: -0.4,
    },
    message: {
      fontSize: 15,
      lineHeight: 22,
      color: c.muted,
    },
    bodyScroll: {
      maxHeight: 280,
    },
    bodyScrollContent: {
      gap: 8,
      paddingBottom: 4,
    },
    disabled: {
      opacity: 0.55,
    },
    extraBtn: {
      alignSelf: 'flex-start',
      paddingVertical: 4,
    },
    extraText: {
      color: c.primary,
      fontWeight: '700',
      fontSize: 15,
    },
    actions: {
      flexDirection: 'row',
      gap: 10,
      marginTop: spacing.md,
    },
    btn: {
      flex: 1,
      height: 44,
      paddingHorizontal: 10,
      borderRadius: radii.pill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    compactRow: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      alignItems: 'center',
      gap: 8,
      marginTop: 4,
    },
    compactBtn: {
      minHeight: 36,
      paddingHorizontal: 14,
      paddingVertical: 7,
      borderRadius: radii.pill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    compactBtnText: {
      color: c.text,
      fontWeight: '700',
      fontSize: 14,
    },
    compactPrimaryText: {
      color: c.primaryOn,
      fontWeight: '700',
      fontSize: 14,
    },
    compactDangerText: {
      color: '#FFFFFF',
      fontWeight: '700',
      fontSize: 14,
    },
    btnGhost: {
      backgroundColor: c.background,
    },
    btnGhostText: {
      color: c.text,
      fontWeight: '700',
      fontSize: 15,
      textAlign: 'center',
    },
    btnPrimary: {
      backgroundColor: c.primary,
    },
    btnPrimaryText: {
      color: c.primaryOn,
      fontWeight: '700',
      fontSize: 15,
      textAlign: 'center',
    },
    btnDanger: {
      backgroundColor: c.danger,
    },
    btnDangerText: {
      color: '#FFFFFF',
      fontWeight: '700',
      fontSize: 15,
      textAlign: 'center',
    },
    actionList: {
      marginTop: 2,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radii.sm,
      overflow: 'hidden',
      backgroundColor: c.background,
    },
    listHair: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: c.divider,
    },
    listRow: {
      paddingVertical: 10,
      paddingHorizontal: 12,
      justifyContent: 'center',
    },
    listRowText: {
      color: c.text,
      fontWeight: '600',
      fontSize: 15,
    },
    listRowDanger: {
      color: c.danger,
    },
    pressed: {
      opacity: 0.88,
    },
    spinner: {
      marginTop: spacing.md,
      marginBottom: spacing.sm,
      alignSelf: 'flex-start',
    },
    hintSheet: {
      marginHorizontal: spacing.md,
      backgroundColor: c.surface,
      borderRadius: radii.md,
      paddingHorizontal: 12,
      paddingTop: 12,
      gap: 8,
      borderWidth: 1,
      borderColor: c.border,
    },
    hudFrame: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: HUD_TEAL,
      paddingHorizontal: 12,
      paddingVertical: 10,
      gap: 6,
      overflow: 'hidden',
    },
    hudScan: {
      position: 'absolute',
      start: 0,
      end: 0,
      height: 1,
      backgroundColor: HUD_TEAL,
      opacity: 0.45,
    },
    hudTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: c.text,
      letterSpacing: 0.2,
    },
    hudStatus: {
      fontSize: 12,
      lineHeight: 16,
      color: c.muted,
    },
    hudRows: {
      gap: 0,
      marginTop: 2,
    },
    hudRow: {
      alignItems: 'flex-start',
      gap: 10,
      paddingVertical: 5,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: HUD_TEAL_LINE,
    },
    hudLabel: {
      width: 86,
      fontSize: 10,
      fontWeight: '700',
      letterSpacing: 0.8,
      textTransform: 'uppercase',
      color: HUD_TEAL,
      flexShrink: 0,
    },
    hudValue: {
      flex: 1,
      minWidth: 0,
      fontSize: 13,
      lineHeight: 17,
      fontWeight: '600',
      color: c.text,
      fontFamily: type.mono.fontFamily,
    },
  });
}

export function BusySheet({
  visible,
  title,
  message,
}: {
  visible: boolean;
  title: string;
  message: string;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const progress = useSheetProgress(visible, 220);

  return (
    <Modal visible={visible} transparent animationType="none" statusBarTranslucent>
      <View style={styles.root} pointerEvents="auto">
        <Animated.View style={[styles.scrim, { opacity: progress }]} />
        <Animated.View
          style={[
            styles.sheet,
            {
              paddingBottom: Math.max(insets.bottom, 16) + 8,
              opacity: progress,
              transform: [
                {
                  translateY: progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [28, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
          <ActivityIndicator
            color={colors.primary}
            size="large"
            style={styles.spinner}
          />
        </Animated.View>
      </View>
    </Modal>
  );
}

export function InfoSheet({
  visible,
  title,
  message,
  children,
  onDismiss,
}: {
  visible: boolean;
  title: string;
  message: string;
  children?: ReactNode;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { row } = useRtlLayout();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardBottomInset();
  const progress = useSheetProgress(visible, 260);
  const pad = sheetAvoidKeyboard(insets.bottom, keyboardHeight);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onDismiss}
    >
      <View style={styles.root} pointerEvents={visible ? 'auto' : 'none'}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss}>
          <Animated.View style={[styles.scrim, { opacity: progress }]} />
        </Pressable>
        <Animated.View
          style={[
            styles.sheet,
            pad,
            {
              opacity: progress,
              transform: [
                {
                  translateY: progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [32, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <Text style={styles.title}>{title}</Text>
          {message ? <Text style={styles.message}>{message}</Text> : null}
          {children ? (
            <ScrollView
              style={styles.bodyScroll}
              contentContainerStyle={styles.bodyScrollContent}
              keyboardShouldPersistTaps="handled"
            >
              {children}
            </ScrollView>
          ) : null}
          <View style={[styles.compactRow, { flexDirection: row }]}>
            <Pressable
              onPress={onDismiss}
              style={({ pressed }) => [
                styles.compactBtn,
                styles.btnPrimary,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.compactPrimaryText}>{t('common.gotIt')}</Text>
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

/** Gate-card instrument readout — compact HUD, not a marketing modal. */
export function HintSheet({
  visible,
  title,
  message,
  rows,
  onDismiss,
}: {
  visible: boolean;
  title: string;
  message?: string;
  rows: Array<{ label: string; value: string }>;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { isRtl, row, writingDirection, textAlign } = useRtlLayout();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardBottomInset();
  const progress = useSheetProgress(visible, 260);
  const reduceMotion = useReduceMotion();
  const pad = sheetAvoidKeyboard(insets.bottom, keyboardHeight);
  const scan = useRef(new Animated.Value(0)).current;
  const [frameH, setFrameH] = useState(0);

  useEffect(() => {
    if (!visible || reduceMotion || frameH <= 0) {
      scan.setValue(0);
      return;
    }
    scan.setValue(0);
    Animated.timing(scan, {
      toValue: 1,
      duration: 700,
      easing: Easing.inOut(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [frameH, reduceMotion, scan, visible]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onDismiss}
    >
      <View style={styles.root} pointerEvents={visible ? 'auto' : 'none'}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss}>
          <Animated.View style={[styles.scrim, { opacity: progress }]} />
        </Pressable>
        <Animated.View
          style={[
            styles.hintSheet,
            pad,
            {
              opacity: progress,
              transform: [
                {
                  translateY: progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [22, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <View
            style={styles.hudFrame}
            onLayout={(e) => setFrameH(e.nativeEvent.layout.height)}
          >
            {!reduceMotion && frameH > 0 ? (
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.hudScan,
                  {
                    transform: [
                      {
                        translateY: scan.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0, Math.max(frameH - 2, 0)],
                        }),
                      },
                    ],
                  },
                ]}
              />
            ) : null}
            <Text
              style={[styles.hudTitle, { writingDirection, textAlign }]}
              numberOfLines={2}
            >
              {title}
            </Text>
            {message ? (
              <Text
                style={[styles.hudStatus, { writingDirection, textAlign }]}
                numberOfLines={2}
              >
                {message}
              </Text>
            ) : null}
            <View style={styles.hudRows}>
              {rows.map((item, index) => (
                <Animated.View
                  key={item.label}
                  style={[
                    styles.hudRow,
                    { flexDirection: row },
                    reduceMotion
                      ? null
                      : {
                          opacity: progress.interpolate({
                            inputRange: [
                              0,
                              0.28 + index * 0.08,
                              0.48 + index * 0.08,
                            ],
                            outputRange: [0, 0, 1],
                            extrapolate: 'clamp',
                          }),
                        },
                  ]}
                >
                  <Text
                    style={[styles.hudLabel, { writingDirection }]}
                    numberOfLines={1}
                  >
                    {item.label}
                  </Text>
                  <Text
                    style={[styles.hudValue, { writingDirection, textAlign }]}
                    selectable
                  >
                    {isolateBidiText(item.value, isRtl)}
                  </Text>
                </Animated.View>
              ))}
            </View>
          </View>
          <View style={[styles.compactRow, { flexDirection: row }]}>
            <Pressable
              onPress={onDismiss}
              style={({ pressed }) => [
                styles.compactBtn,
                styles.btnPrimary,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.compactPrimaryText}>{t('common.gotIt')}</Text>
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}
