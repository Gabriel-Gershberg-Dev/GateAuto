import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../ThemeProvider';
import { radii, spacing, type ThemeColors } from '../theme';

export type FormSheetField = {
  key: string;
  label: string;
  value: string;
  onChange: (text: string) => void;
  placeholder?: string;
  autoCapitalize?: 'none' | 'words' | 'sentences';
  secureTextEntry?: boolean;
  keyboardType?: 'default' | 'email-address' | 'number-pad';
};

export function FormSheet({
  visible,
  title,
  message,
  fields,
  cancelLabel,
  confirmLabel,
  extra,
  destructive,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  title: string;
  message?: string;
  fields: FormSheetField[];
  cancelLabel: string;
  confirmLabel: string;
  extra?: ReactNode;
  destructive?: boolean;
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
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
      onRequestClose={onCancel}
    >
      <View style={styles.root} pointerEvents={visible ? 'auto' : 'none'}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel}>
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
          {message ? <Text style={styles.message}>{message}</Text> : null}
          {fields.map((field) => (
            <View key={field.key} style={styles.field}>
              <Text style={styles.label}>{field.label}</Text>
              <TextInput
                style={styles.input}
                value={field.value}
                onChangeText={field.onChange}
                placeholder={field.placeholder}
                placeholderTextColor={colors.muted}
                autoCapitalize={field.autoCapitalize ?? 'none'}
                autoCorrect={false}
                secureTextEntry={field.secureTextEntry}
                keyboardType={field.keyboardType ?? 'default'}
                editable={!busy}
              />
            </View>
          ))}
          {extra}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <View style={styles.actions}>
            <Pressable
              onPress={onCancel}
              disabled={busy}
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
              disabled={busy}
              style={({ pressed }) => [
                styles.btn,
                destructive ? styles.btnDanger : styles.btnPrimary,
                pressed && styles.pressed,
                busy && styles.disabled,
              ]}
            >
              <Text
                style={
                  destructive ? styles.btnDangerText : styles.btnPrimaryText
                }
              >
                {busy ? 'Working…' : confirmLabel}
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
    field: {
      gap: 6,
    },
    label: {
      fontSize: 13,
      fontWeight: '600',
      color: c.text,
    },
    input: {
      backgroundColor: c.background,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: radii.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      fontSize: 16,
      color: c.text,
    },
    error: {
      fontSize: 13,
      color: c.danger,
    },
    actions: {
      flexDirection: 'row',
      gap: 10,
      marginTop: spacing.sm,
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
    disabled: {
      opacity: 0.55,
    },
  });
}
