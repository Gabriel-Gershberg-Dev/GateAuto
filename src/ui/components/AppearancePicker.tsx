import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../ThemeProvider';
import { paddedCardStyle, radii, type ThemeColors, type ThemePreference } from '../theme';

const OPTIONS: ThemePreference[] = ['system', 'light', 'dark'];

export function AppearancePicker() {
  const { t } = useTranslation();
  const { colors, preference, setPreference } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const labelFor = (value: ThemePreference) => {
    if (value === 'system') return t('appearance.system');
    if (value === 'light') return t('appearance.light');
    return t('appearance.dark');
  };

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{t('appearance.title')}</Text>
      <View style={styles.segment}>
        {OPTIONS.map((opt) => {
          const selected = preference === opt;
          return (
            <Pressable
              key={opt}
              style={[styles.chip, selected && styles.chipSelected]}
              onPress={() => setPreference(opt)}
            >
              <Text
                style={[styles.chipText, selected && styles.chipTextSelected]}
                numberOfLines={1}
              >
                {labelFor(opt)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function createStyles(c: ThemeColors) {
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
      backgroundColor: c.background,
      borderRadius: radii.sm,
      padding: 3,
      gap: 2,
    },
    chip: {
      flex: 1,
      minWidth: 0,
      paddingVertical: 8,
      paddingHorizontal: 6,
      borderRadius: radii.sm - 2,
      alignItems: 'center',
      justifyContent: 'center',
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
