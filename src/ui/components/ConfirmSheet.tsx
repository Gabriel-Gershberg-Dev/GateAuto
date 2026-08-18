import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../ThemeProvider';
import { radii, spacing, type ThemeColors } from '../theme';

type Props = {
  visible: boolean;
  icon?: ReactNode;
  title: string;
  message: string;
  cancelLabel: string;
  confirmLabel: string;
  extraLabel?: string;
  destructive?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  onExtra?: () => void;
};

export function ConfirmSheet({
  visible,
  icon,
  title,
  message,
  cancelLabel,
  confirmLabel,
  extraLabel,
  destructive = false,
  onCancel,
  onConfirm,
  onExtra,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) {
      progress.setValue(0);
      return;
    }
    progress.setValue(0);
    Animated.timing(progress, {
      toValue: 1,
      duration: 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [progress, visible]);

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
          <Animated.View
            style={[styles.scrim, { opacity: progress }]}
          />
        </Pressable>
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
                    outputRange: [36, 0],
                  }),
                },
              ],
            },
          ]}
        >
          {icon ? <View style={styles.iconWrap}>{icon}</View> : null}
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
          {extraLabel && onExtra ? (
            <Pressable
              onPress={onExtra}
              style={({ pressed }) => [styles.extraBtn, pressed && styles.pressed]}
            >
              <Text style={styles.extraText}>{extraLabel}</Text>
            </Pressable>
          ) : null}
          <View style={styles.actions}>
            <Pressable
              onPress={onCancel}
              style={({ pressed }) => [
                styles.btn,
                styles.btnGhost,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.btnGhostText}>{cancelLabel}</Text>
            </Pressable>
            <Pressable
              onPress={onConfirm}
              style={({ pressed }) => [
                styles.btn,
                destructive ? styles.btnDanger : styles.btnPrimary,
                pressed && styles.pressed,
              ]}
            >
              <Text
                style={
                  destructive ? styles.btnDangerText : styles.btnPrimaryText
                }
              >
                {confirmLabel}
              </Text>
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
      marginBottom: spacing.sm,
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
      height: 48,
      borderRadius: radii.pill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    btnGhost: {
      backgroundColor: c.background,
    },
    btnGhostText: {
      color: c.text,
      fontWeight: '700',
      fontSize: 15,
    },
    btnPrimary: {
      backgroundColor: c.primary,
    },
    btnPrimaryText: {
      color: c.primaryOn,
      fontWeight: '700',
      fontSize: 15,
    },
    btnDanger: {
      backgroundColor: c.danger,
    },
    btnDangerText: {
      color: '#FFFFFF',
      fontWeight: '700',
      fontSize: 15,
    },
    pressed: {
      opacity: 0.88,
    },
    spinner: {
      marginTop: spacing.md,
      marginBottom: spacing.sm,
      alignSelf: 'flex-start',
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
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) {
      progress.setValue(0);
      return;
    }
    progress.setValue(0);
    Animated.timing(progress, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [progress, visible]);

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
  onDismiss,
}: {
  visible: boolean;
  title: string;
  message: string;
  onDismiss: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) {
      progress.setValue(0);
      return;
    }
    progress.setValue(0);
    Animated.timing(progress, {
      toValue: 1,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [progress, visible]);

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
            {
              paddingBottom: Math.max(insets.bottom, 16) + 8,
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
          <Text style={styles.message}>{message}</Text>
          <Pressable
            onPress={onDismiss}
            style={({ pressed }) => [
              styles.btn,
              styles.btnPrimary,
              { flex: 0, alignSelf: 'stretch', marginTop: spacing.md },
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.btnPrimaryText}>Got it</Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}
