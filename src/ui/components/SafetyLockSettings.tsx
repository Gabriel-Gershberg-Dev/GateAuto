import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import {
  clampBurstCount,
  clampLockMinutes,
  DEFAULT_BURST_COUNT,
  DEFAULT_GATE_LOCK_MINUTES,
  MAX_BURST_COUNT,
  MAX_GATE_LOCK_MINUTES,
  MIN_BURST_COUNT,
  MIN_GATE_LOCK_MINUTES,
} from '../../data/safetyBurst';
import {
  loadSafetyLockSettings,
  saveSafetyLockSettings,
  type SafetyLockSettings,
} from '../../data/safetyLockSettings';
import { useRtlLayout } from '../../i18n/useRtlLayout';
import { ConfirmSheet } from './ConfirmSheet';
import { useTheme } from '../ThemeProvider';
import { paddedCardStyle, radii, spacing, type ThemeColors } from '../theme';

const ATTEMPT_PRESETS = [3, 4, 5, 6];
const DURATION_PRESETS = [5, 15, 30, 60, 120];

type EditKind = 'attempts' | 'duration';

export function SafetyLockSettings() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { row, writingDirection, textAlign } = useRtlLayout();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [settings, setSettings] = useState<SafetyLockSettings>({
    burstCount: DEFAULT_BURST_COUNT,
    lockMinutes: DEFAULT_GATE_LOCK_MINUTES,
  });
  const [edit, setEdit] = useState<EditKind | null>(null);
  const [draft, setDraft] = useState('');

  const refresh = useCallback(async () => {
    setSettings(await loadSafetyLockSettings());
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const apply = async (next: Partial<SafetyLockSettings>) => {
    setSettings(await saveSafetyLockSettings(next));
  };

  const attemptsCustom = !ATTEMPT_PRESETS.includes(settings.burstCount);
  const durationCustom = !DURATION_PRESETS.includes(settings.lockMinutes);

  const openCustom = (kind: EditKind) => {
    setDraft(
      String(kind === 'attempts' ? settings.burstCount : settings.lockMinutes),
    );
    setEdit(kind);
  };

  const confirmCustom = () => {
    const n = Number.parseInt(draft.replace(/[^0-9]/g, ''), 10);
    if (!Number.isFinite(n)) {
      setEdit(null);
      return;
    }
    if (edit === 'attempts') {
      void apply({ burstCount: clampBurstCount(n) });
    } else if (edit === 'duration') {
      void apply({ lockMinutes: clampLockMinutes(n) });
    }
    setEdit(null);
  };

  const draftValid =
    edit === 'attempts'
      ? Number.parseInt(draft, 10) >= MIN_BURST_COUNT
      : Number.parseInt(draft, 10) >= MIN_GATE_LOCK_MINUTES;

  return (
    <>
      <View style={styles.card}>
        <Text style={[styles.title, { writingDirection, textAlign }]}>
          {t('safety.title')}
        </Text>
        <Text style={[styles.meta, { writingDirection, textAlign }]}>
          {t('safety.meta')}
        </Text>

        <Text style={[styles.label, { writingDirection, textAlign }]}>
          {t('safety.attempts')}
        </Text>
        <View style={[styles.chips, { flexDirection: row }]}>
          {ATTEMPT_PRESETS.map((n) => {
            const on = !attemptsCustom && n === settings.burstCount;
            return (
              <Pressable
                key={`a-${n}`}
                onPress={() => void apply({ burstCount: n })}
                style={[styles.chip, on && styles.chipOn]}
              >
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{n}</Text>
              </Pressable>
            );
          })}
          <Pressable
            onPress={() => openCustom('attempts')}
            style={[styles.chip, attemptsCustom && styles.chipOn]}
          >
            <Text
              style={[styles.chipText, attemptsCustom && styles.chipTextOn]}
            >
              {attemptsCustom ? settings.burstCount : t('safety.custom')}
            </Text>
          </Pressable>
        </View>
        <Text style={[styles.hint, { writingDirection, textAlign }]}>
          {t('safety.attemptsHint', { min: MIN_BURST_COUNT })}
        </Text>

        <Text style={[styles.label, { writingDirection, textAlign }]}>
          {t('safety.duration')}
        </Text>
        <View style={[styles.chips, { flexDirection: row }]}>
          {DURATION_PRESETS.map((n) => {
            const on = !durationCustom && n === settings.lockMinutes;
            return (
              <Pressable
                key={`d-${n}`}
                onPress={() => void apply({ lockMinutes: n })}
                style={[styles.chip, on && styles.chipOn]}
              >
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{n}</Text>
              </Pressable>
            );
          })}
          {durationCustom ? (
            <Pressable
              onPress={() => openCustom('duration')}
              style={[styles.chip, styles.chipOn]}
            >
              <Text style={[styles.chipText, styles.chipTextOn]}>
                {settings.lockMinutes}
              </Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={() => openCustom('duration')}
              style={styles.chip}
            >
              <Text style={styles.chipText}>{t('safety.custom')}</Text>
            </Pressable>
          )}
        </View>
        <Text style={[styles.hint, { writingDirection, textAlign }]}>
          {t('safety.durationHint', {
            min: MIN_GATE_LOCK_MINUTES,
            max: MAX_GATE_LOCK_MINUTES,
          })}
        </Text>
      </View>

      <ConfirmSheet
        visible={edit != null}
        title={
          edit === 'attempts'
            ? t('safety.customAttemptsTitle')
            : t('safety.customDurationTitle')
        }
        message={
          edit === 'attempts'
            ? t('safety.customAttemptsMsg', {
                min: MIN_BURST_COUNT,
                max: MAX_BURST_COUNT,
              })
            : t('safety.customDurationMsg', {
                min: MIN_GATE_LOCK_MINUTES,
                max: MAX_GATE_LOCK_MINUTES,
              })
        }
        cancelLabel={t('common.cancel')}
        confirmLabel={t('common.save')}
        confirmDisabled={!draftValid}
        onCancel={() => setEdit(null)}
        onConfirm={confirmCustom}
      >
        <View style={[styles.customRow, { flexDirection: row }]}>
          <TextInput
            style={styles.customInput}
            value={draft}
            onChangeText={(raw) => setDraft(raw.replace(/[^0-9]/g, ''))}
            keyboardType="number-pad"
            placeholder={
              edit === 'attempts'
                ? String(DEFAULT_BURST_COUNT)
                : String(DEFAULT_GATE_LOCK_MINUTES)
            }
            placeholderTextColor={colors.muted}
            selectTextOnFocus
            accessibilityLabel={
              edit === 'attempts'
                ? t('safety.customAttemptsTitle')
                : t('safety.customDurationTitle')
            }
          />
          <Text style={styles.customUnit}>
            {edit === 'duration' ? t('safety.minutes') : ''}
          </Text>
        </View>
      </ConfirmSheet>
    </>
  );
}

function createStyles(c: ThemeColors) {
  return StyleSheet.create({
    card: {
      ...paddedCardStyle(c),
      gap: 8,
    },
    title: {
      fontSize: 16,
      fontWeight: '600',
      color: c.text,
      letterSpacing: -0.2,
    },
    meta: {
      fontSize: 13,
      color: c.muted,
      marginBottom: 4,
    },
    label: {
      fontSize: 13,
      fontWeight: '700',
      color: c.text,
      marginTop: 4,
    },
    chips: {
      flexWrap: 'wrap',
      gap: 6,
    },
    chip: {
      minWidth: 40,
      justifyContent: 'center',
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.background,
      alignItems: 'center',
    },
    chipOn: {
      borderColor: c.primary,
      backgroundColor: c.primary,
    },
    chipText: {
      fontSize: 13,
      fontWeight: '700',
      color: c.text,
    },
    chipTextOn: {
      color: c.primaryOn,
    },
    hint: {
      fontSize: 12,
      color: c.muted,
    },
    customRow: {
      alignItems: 'center',
      gap: 8,
    },
    customInput: {
      flex: 1,
      height: 44,
      borderRadius: radii.sm,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.background,
      paddingHorizontal: 12,
      fontSize: 16,
      fontWeight: '600',
      color: c.text,
    },
    customUnit: {
      fontSize: 14,
      fontWeight: '600',
      color: c.muted,
      minWidth: 28,
    },
  });
}
