import { useCallback, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppI18n } from '../../i18n/I18nProvider';
import { readDeviceLanguageTag } from '../../i18n/deviceLocale';
import {
  isRtlLanguage,
  resolveLanguage,
  type LanguagePreference,
} from '../../i18n/locale';
import { preferenceFlipsDirection } from '../../i18n/rtl';
import { rememberResumeRoute, type ResumeRouteName } from '../../navigation/resumeRoute';
import { reloadAppForLayout } from '../../platform/reloadApp';
import { ConfirmSheet } from './ConfirmSheet';
import { IconGlobe } from '../icons';
import { useTheme } from '../ThemeProvider';
import { paddedCardStyle, radii, spacing, type ThemeColors } from '../theme';

const OPTIONS: LanguagePreference[] = ['system', 'en', 'he', 'ru'];

/**
 * Confirm-before-apply for the one switch that needs a full reload: crossing the
 * left-to-right / right-to-left boundary. Same-direction picks (English↔Russian)
 * apply instantly; a direction flip stages the choice so the confirm sheet can
 * explain the restart, then applies + reloads atomically — the app never lingers
 * half-mirrored.
 */
function useLanguageSwitch(resumeOnRtl?: ResumeRouteName) {
  const { setPreference } = useAppI18n();
  const [pending, setPending] = useState<LanguagePreference | null>(null);

  const choose = useCallback(
    (opt: LanguagePreference, afterApplied?: () => void) => {
      if (preferenceFlipsDirection(opt)) {
        setPending(opt);
        return;
      }
      void setPreference(opt).then(() => afterApplied?.());
    },
    [setPreference],
  );

  const confirm = useCallback(() => {
    const opt = pending;
    setPending(null);
    if (!opt) return;
    void (async () => {
      await setPreference(opt);
      if (resumeOnRtl) await rememberResumeRoute(resumeOnRtl);
      await reloadAppForLayout();
    })();
  }, [pending, resumeOnRtl, setPreference]);

  const cancel = useCallback(() => setPending(null), []);

  return { pending, choose, confirm, cancel };
}

function LanguageRestartSheet({
  pending,
  onConfirm,
  onCancel,
}: {
  pending: LanguagePreference | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const toRtl = pending
    ? isRtlLanguage(resolveLanguage(pending, readDeviceLanguageTag()))
    : false;

  return (
    <ConfirmSheet
      visible={pending != null}
      compact
      icon={<IconGlobe color={colors.primary} size={22} />}
      title={t('lang.restartTitle')}
      message={toRtl ? t('lang.restartToRtl') : t('lang.restartToLtr')}
      cancelLabel={t('lang.restartLater')}
      confirmLabel={t('lang.restartNow')}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}

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
  resumeOnRtl,
}: {
  resumeOnRtl?: ResumeRouteName;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { preference } = useAppI18n();
  const styles = useMemo(() => createPickerStyles(colors), [colors]);
  const { pending, choose, confirm, cancel } = useLanguageSwitch(resumeOnRtl);

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
              onPress={() => choose(opt)}
            >
              <Text
                style={[styles.chipText, selected && styles.chipTextSelected]}
                numberOfLines={1}
              >
                {languageLabel(t, opt)}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <LanguageRestartSheet
        pending={pending}
        onConfirm={confirm}
        onCancel={cancel}
      />
    </View>
  );
}

export function LanguageMenuButton() {
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
      />
    </>
  );
}

export function LanguageSheet({
  visible,
  onDismiss,
  resumeOnRtl,
}: {
  visible: boolean;
  onDismiss: () => void;
  resumeOnRtl?: ResumeRouteName;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { preference } = useAppI18n();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createSheetStyles(colors), [colors]);
  const { pending, choose, confirm, cancel } = useLanguageSwitch(resumeOnRtl);

  return (
    <>
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
                  onDismiss();
                  choose(opt);
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
    <LanguageRestartSheet
      pending={pending}
      onConfirm={confirm}
      onCancel={cancel}
    />
    </>
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
      justifyContent: 'center',
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
