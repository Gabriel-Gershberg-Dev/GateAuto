import { useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppI18n } from '../../i18n/I18nProvider';
import type { LanguagePreference } from '../../i18n/locale';
import { rememberResumeRoute, type ResumeRouteName } from '../../navigation/resumeRoute';
import { useTheme } from '../ThemeProvider';
import { paddedCardStyle, radii, spacing, type ThemeColors } from '../theme';

const OPTIONS: LanguagePreference[] = ['system', 'en', 'he', 'ru'];

export function languageLabel(
  t: (key: string) => string,
  value: LanguagePreference,
): string {
  switch (value) {
    case 'system':
      return t('lang.device');
    case 'en':
      return t('lang.english');
    case 'he':
      return t('lang.hebrew');
    case 'ru':
      return t('lang.russian');
  }
}

export function LanguagePicker({
  onRtlMayNeedRestart,
  resumeOnRtl,
}: {
  onRtlMayNeedRestart?: () => void;
  resumeOnRtl?: ResumeRouteName;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { preference, setPreference } = useAppI18n();
  const styles = useMemo(() => createPickerStyles(colors), [colors]);

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{t('lang.title')}</Text>
      <View style={styles.segment}>
        {OPTIONS.map((opt) => {
          const selected = preference === opt;
          return (
            <Pressable
              key={opt}
              style={[styles.chip, selected && styles.chipSelected]}
              onPress={() => {
                void setPreference(opt).then((needsRestart) => {
                  if (needsRestart) {
                    if (resumeOnRtl) void rememberResumeRoute(resumeOnRtl);
                    onRtlMayNeedRestart?.();
                  }
                });
              }}
            >
              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                {languageLabel(t, opt)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function LanguageMenuButton({
  onRtlMayNeedRestart,
}: {
  onRtlMayNeedRestart?: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { preference } = useAppI18n();
  const styles = useMemo(() => createMenuStyles(colors), [colors]);
  const [open, setOpen] = useState(false);

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={t('lang.title')}
        style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
      >
        <Text style={styles.pillKicker}>{t('lang.title')}</Text>
        <Text style={styles.pillValue}>{languageLabel(t, preference)}</Text>
      </Pressable>
      <LanguageSheet
        visible={open}
        onDismiss={() => setOpen(false)}
        onRtlMayNeedRestart={onRtlMayNeedRestart}
      />
    </>
  );
}

export function LanguageSheet({
  visible,
  onDismiss,
  onRtlMayNeedRestart,
  resumeOnRtl,
}: {
  visible: boolean;
  onDismiss: () => void;
  onRtlMayNeedRestart?: () => void;
  resumeOnRtl?: ResumeRouteName;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { preference, setPreference } = useAppI18n();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createSheetStyles(colors), [colors]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onDismiss}
    >
      <View style={styles.root}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss} />
        <View
          style={[
            styles.sheet,
            { paddingBottom: Math.max(insets.bottom, 16) + 8 },
          ]}
        >
          <Text style={styles.title}>{t('lang.title')}</Text>
          <Text style={styles.message}>{t('lang.choose')}</Text>
          {OPTIONS.map((opt) => {
            const selected = preference === opt;
            return (
              <Pressable
                key={opt}
                onPress={() => {
                  void setPreference(opt).then((needsRestart) => {
                    if (needsRestart) {
                      if (resumeOnRtl) void rememberResumeRoute(resumeOnRtl);
                      onRtlMayNeedRestart?.();
                    }
                    onDismiss();
                  });
                }}
                style={({ pressed }) => [
                  styles.row,
                  selected && styles.rowOn,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.rowText, selected && styles.rowTextOn]}>
                  {languageLabel(t, opt)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </Modal>
  );
}

function createPickerStyles(c: ThemeColors) {
  return StyleSheet.create({
    card: {
      ...paddedCardStyle(c),
      gap: 12,
    },
    title: {
      fontSize: 16,
      fontWeight: '600',
      color: c.text,
      letterSpacing: -0.2,
    },
    segment: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      backgroundColor: c.background,
      borderRadius: radii.sm,
      padding: 3,
      gap: 2,
    },
    chip: {
      flexGrow: 1,
      minWidth: '22%',
      paddingVertical: 8,
      paddingHorizontal: 6,
      borderRadius: radii.sm - 2,
      alignItems: 'center',
    },
    chipSelected: {
      backgroundColor: c.surface,
    },
    chipText: {
      fontSize: 13,
      fontWeight: '600',
      color: c.muted,
    },
    chipTextSelected: {
      color: c.text,
    },
  });
}

function createMenuStyles(c: ThemeColors) {
  return StyleSheet.create({
    pill: {
      alignSelf: 'flex-end',
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface,
      gap: 1,
    },
    pillKicker: {
      fontSize: 10,
      fontWeight: '700',
      letterSpacing: 0.8,
      textTransform: 'uppercase',
      color: c.muted,
    },
    pillValue: {
      fontSize: 14,
      fontWeight: '700',
      color: c.primary,
    },
    pressed: {
      opacity: 0.88,
    },
  });
}

function createSheetStyles(c: ThemeColors) {
  return StyleSheet.create({
    root: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: c.overlay,
    },
    sheet: {
      backgroundColor: c.surface,
      borderTopLeftRadius: radii.lg,
      borderTopRightRadius: radii.lg,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.lg,
      gap: 8,
    },
    title: {
      fontSize: 20,
      fontWeight: '700',
      color: c.text,
    },
    message: {
      fontSize: 14,
      color: c.muted,
      marginBottom: 6,
    },
    row: {
      minHeight: 48,
      borderRadius: radii.sm,
      paddingHorizontal: 14,
      justifyContent: 'center',
      backgroundColor: c.background,
    },
    rowOn: {
      backgroundColor: c.primaryMuted,
    },
    rowText: {
      fontSize: 16,
      fontWeight: '600',
      color: c.text,
    },
    rowTextOn: {
      color: c.primary,
    },
    pressed: {
      opacity: 0.88,
    },
  });
}
