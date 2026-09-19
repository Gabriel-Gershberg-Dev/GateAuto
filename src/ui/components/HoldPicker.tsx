import { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  DEFAULT_HOLD_SECONDS,
  HOLD_DURATION_PRESETS,
  MAX_HOLD_SECONDS,
} from '../../data/holdNormalize';
import { useRtlLayout } from '../../i18n/useRtlLayout';
import { useTheme } from '../ThemeProvider';
import { radii, type ThemeColors } from '../theme';
import { useTranslation } from 'react-i18next';
import { ConfirmSheet } from './ConfirmSheet';

type Props = {
  enabled: boolean;
  seconds: number;
  onEnabledChange: (enabled: boolean) => void;
  onSecondsChange: (seconds: number) => void;
};

function clampHoldSeconds(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_HOLD_SECONDS;
  return Math.min(MAX_HOLD_SECONDS, Math.max(1, Math.round(n)));
}

export function HoldPicker({
  enabled,
  seconds,
  onEnabledChange,
  onSecondsChange,
}: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { row, writingDirection, textAlign } = useRtlLayout();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const value = clampHoldSeconds(seconds);
  const isPreset = (HOLD_DURATION_PRESETS as readonly number[]).includes(value);
  const [customOpen, setCustomOpen] = useState(false);
  const [customText, setCustomText] = useState(String(value));

  useEffect(() => {
    if (!customOpen) setCustomText(String(value));
  }, [customOpen, value]);

  const customOn = enabled && !isPreset;

  return (
    <View style={styles.wrap}>
      <View style={[styles.switchRow, { flexDirection: row }]}>
        <Text style={[styles.label, { writingDirection, textAlign }]}>
          {t('editor.hold')}
        </Text>
        <View style={styles.switchSlot}>
        <Switch
          value={enabled}
          onValueChange={(next) => {
            onEnabledChange(next);
            if (next && !(seconds > 0)) onSecondsChange(DEFAULT_HOLD_SECONDS);
          }}
          trackColor={{ false: colors.border, true: colors.primaryMuted }}
          thumbColor={enabled ? colors.primary : colors.switchThumbOff}
        />
        </View>
      </View>
      {enabled ? (
        <>
          <View style={[styles.presets, { flexDirection: row }]}>
            {HOLD_DURATION_PRESETS.map((n) => {
              const on = isPreset && n === value;
              return (
                <Pressable
                  key={n}
                  onPress={() => onSecondsChange(n)}
                  style={[styles.chip, on && styles.chipOn]}
                >
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>
                    {n}
                  </Text>
                </Pressable>
              );
            })}
            <Pressable
              onPress={() => {
                setCustomText(String(value));
                setCustomOpen(true);
              }}
              style={[styles.chip, customOn && styles.chipOn]}
            >
              <Text style={[styles.chipText, customOn && styles.chipTextOn]}>
                {t('editor.holdCustom')}
              </Text>
            </Pressable>
          </View>
          <Text style={[styles.current, { writingDirection, textAlign }]}>
            {t('editor.holdValue', { seconds: value })}
          </Text>
        </>
      ) : (
        <Text style={[styles.current, { writingDirection, textAlign }]}>
          {t('editor.holdOff')}
        </Text>
      )}
      <Text style={[styles.hint, { writingDirection, textAlign }]}>
        {t('editor.holdHint')}
      </Text>
      <ConfirmSheet
        visible={customOpen}
        title={t('editor.holdCustomTitle')}
        message={t('editor.holdCustomMsg')}
        cancelLabel={t('common.cancel')}
        confirmLabel={t('common.save')}
        onCancel={() => setCustomOpen(false)}
        onConfirm={() => {
          const n = Number(customText.replace(/[^0-9]/g, ''));
          onSecondsChange(clampHoldSeconds(n));
          setCustomOpen(false);
        }}
      >
        <View style={[styles.customRow, { flexDirection: row }]}>
          <TextInput
            style={styles.customInput}
            value={customText}
            onChangeText={(raw) => setCustomText(raw.replace(/[^0-9]/g, ''))}
            keyboardType="number-pad"
            placeholder={String(DEFAULT_HOLD_SECONDS)}
            placeholderTextColor={colors.muted}
            selectTextOnFocus
            accessibilityLabel={t('editor.holdCustomLabel')}
          />
          <Text style={styles.customUnit}>{t('editor.holdSec')}</Text>
        </View>
      </ConfirmSheet>
    </View>
  );
}

function createStyles(c: ThemeColors) {
  return StyleSheet.create({
    wrap: {
      gap: 8,
    },
    switchRow: {
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    label: {
      flex: 1,
      minWidth: 0,
      fontSize: 16,
      fontWeight: '600',
      color: c.text,
    },
    switchSlot: {
      flexShrink: 0,
    },
    presets: {
      flexWrap: 'wrap',
      gap: 8,
    },
    chip: {
      minWidth: 44,
      minHeight: 44,
      justifyContent: 'center',
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface,
      alignItems: 'center',
    },
    chipOn: {
      borderColor: c.primary,
      backgroundColor: c.primary,
    },
    chipText: {
      fontSize: 14,
      fontWeight: '700',
      color: c.text,
    },
    chipTextOn: {
      color: c.primaryOn,
    },
    current: {
      fontSize: 13,
      fontWeight: '600',
      color: c.muted,
    },
    hint: {
      fontSize: 13,
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
    },
  });
}
