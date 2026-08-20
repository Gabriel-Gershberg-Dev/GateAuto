import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { DEFAULT_COOLDOWN_SECONDS } from '../../data/gatesStore';
import { useRtlLayout } from '../../i18n/useRtlLayout';
import { useTheme } from '../ThemeProvider';
import { radii, type ThemeColors } from '../theme';
import { useTranslation } from 'react-i18next';

const PRESETS = [5, 10, 20, 30, 60];
const MAX_COOLDOWN_SECONDS = 3600;

type Props = {
  value: number;
  onChange: (seconds: number) => void;
};

export function CooldownPicker({ value, onChange }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { row, writingDirection, textAlign } = useRtlLayout();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const seconds = Math.max(0, Math.round(value) || 0);
  const [customMode, setCustomMode] = useState(!PRESETS.includes(seconds));
  const [customText, setCustomText] = useState(String(seconds));

  useEffect(() => {
    if (!customMode) setCustomText(String(seconds));
  }, [customMode, seconds]);

  return (
    <View style={styles.wrap}>
      <Text style={[styles.label, { writingDirection, textAlign }]}>
        {t('editor.cooldown')}
      </Text>
      <View style={[styles.presets, { flexDirection: row }]}>
        {PRESETS.map((n) => {
          const on = !customMode && n === seconds;
          return (
            <Pressable
              key={n}
              onPress={() => {
                setCustomMode(false);
                onChange(n);
              }}
              style={[styles.chip, on && styles.chipOn]}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{n}</Text>
            </Pressable>
          );
        })}
        <Pressable
          onPress={() => {
            setCustomText(String(seconds));
            setCustomMode(true);
          }}
          style={[styles.chip, customMode && styles.chipOn]}
        >
          <Text style={[styles.chipText, customMode && styles.chipTextOn]}>
            {t('editor.cooldownCustom')}
          </Text>
        </Pressable>
      </View>
      {customMode ? (
        <View style={[styles.customRow, { flexDirection: row }]}>
          <TextInput
            style={styles.customInput}
            value={customText}
            onChangeText={(raw) => {
              const next = raw.replace(/[^0-9]/g, '');
              setCustomText(next);
              const n = Number(next);
              onChange(
                Number.isFinite(n)
                  ? Math.min(MAX_COOLDOWN_SECONDS, Math.max(0, Math.round(n)))
                  : DEFAULT_COOLDOWN_SECONDS,
              );
            }}
            keyboardType="number-pad"
            placeholder={String(DEFAULT_COOLDOWN_SECONDS)}
            placeholderTextColor={colors.muted}
            selectTextOnFocus
            accessibilityLabel={t('editor.cooldownCustomLabel')}
          />
          <Text style={styles.customUnit}>{t('editor.cooldownSec')}</Text>
        </View>
      ) : (
        <Text style={[styles.current, { writingDirection, textAlign }]}>
          {t('editor.cooldownValue', { seconds })}
        </Text>
      )}
      <Text style={[styles.hint, { writingDirection, textAlign }]}>
        {t('editor.cooldownHint', { seconds: DEFAULT_COOLDOWN_SECONDS })}
      </Text>
    </View>
  );
}

function createStyles(c: ThemeColors) {
  return StyleSheet.create({
    wrap: {
      gap: 8,
    },
    label: {
      fontSize: 16,
      fontWeight: '600',
      color: c.text,
    },
    presets: {
      flexWrap: 'wrap',
      gap: 8,
    },
    chip: {
      minWidth: 44,
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
    customRow: {
      alignItems: 'center',
      gap: 8,
    },
    customInput: {
      flex: 1,
      height: 40,
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
    hint: {
      fontSize: 13,
      color: c.muted,
    },
  });
}
