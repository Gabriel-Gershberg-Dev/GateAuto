import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useMemo } from 'react';
import { useTheme } from '../ThemeProvider';
import { radii, spacing, type ThemeColors, type ThemePreference } from '../theme';

const OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export function AppearancePicker() {
  const { colors, preference, setPreference } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Appearance</Text>
      <View style={styles.segment}>
        {OPTIONS.map((opt) => {
          const selected = preference === opt.value;
          return (
            <Pressable
              key={opt.value}
              style={[styles.chip, selected && styles.chipSelected]}
              onPress={() => setPreference(opt.value)}
            >
              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                {opt.label}
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
      backgroundColor: c.surface,
      borderRadius: radii.md,
      padding: spacing.md,
      gap: 12,
      borderWidth: 1,
      borderColor: c.border,
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
      paddingVertical: 8,
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
