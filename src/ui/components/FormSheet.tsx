import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../ThemeProvider';
import { radii, spacing, type ThemeColors } from '../theme';
import {
  sheetAvoidKeyboard,
  useKeyboardBottomInset,
} from '../useKeyboardBottomInset';
import { useReduceMotion } from '../useReduceMotion';

export type FormSheetField = {
  key: string;
  label: string;
  value: string;
  onChange: (text: string) => void;
  placeholder?: string;
  autoCapitalize?: 'none' | 'words' | 'sentences';
  secureTextEntry?: boolean;
  keyboardType?: 'default' | 'email-address' | 'number-pad';
  autoFocus?: boolean;
  autoComplete?: 'email' | 'off' | 'name' | 'password';
  returnKeyType?: 'done' | 'next' | 'send' | 'go';
  onSubmitEditing?: () => void;
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
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardBottomInset();
  const reduceMotion = useReduceMotion();
  const progress = useRef(new Animated.Value(0)).current;
  const scrollRef = useRef<ScrollView>(null);
  const pad = sheetAvoidKeyboard(insets.bottom, keyboardHeight);

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
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [progress, reduceMotion, visible]);

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
                    outputRange: [32, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <ScrollView
            ref={scrollRef}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            style={styles.bodyScroll}
            contentContainerStyle={styles.body}
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
                  autoComplete={field.autoComplete}
                  autoFocus={field.autoFocus}
                  secureTextEntry={field.secureTextEntry}
                  keyboardType={field.keyboardType ?? 'default'}
                  returnKeyType={field.returnKeyType ?? 'done'}
                  onSubmitEditing={field.onSubmitEditing ?? onConfirm}
                  blurOnSubmit
                  editable={!busy}
                  onFocus={() => {
                    requestAnimationFrame(() => {
                      scrollRef.current?.scrollToEnd({ animated: true });
                    });
                  }}
                />
              </View>
            ))}
            {extra}
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </ScrollView>
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
              <Text style={styles.btnGhostText} numberOfLines={2}>
                {cancelLabel}
              </Text>
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
                numberOfLines={2}
              >
                {busy ? t('common.working') : confirmLabel}
              </Text>
            </Pressable>
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
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
    bodyScroll: {
      maxHeight: 360,
    },
    body: {
      gap: 10,
      paddingBottom: 4,
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
      minHeight: 48,
      fontSize: 16,
      color: c.text,
    },
    error: {
      fontSize: 13,
      color: c.danger,
    },
    actions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
      marginTop: spacing.sm,
    },
    btn: {
      flexGrow: 1,
      flexBasis: 132,
      minHeight: 48,
      paddingHorizontal: 12,
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
    pressed: {
      opacity: 0.88,
    },
    disabled: {
      opacity: 0.55,
    },
  });
}
