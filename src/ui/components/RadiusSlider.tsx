import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  MAX_RADIUS_METERS,
  MIN_RADIUS_METERS,
} from '../../data/gatesStore';
import { useTheme } from '../ThemeProvider';
import { radii, spacing, type ThemeColors } from '../theme';

type Props = {
  value: number;
  onChange: (meters: number) => void;
  min?: number;
  max?: number;
  step?: number;
};

export function RadiusSlider({
  value,
  onChange,
  min = MIN_RADIUS_METERS,
  max = MAX_RADIUS_METERS,
  step = 5,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const steps = useMemo(() => {
    const list: number[] = [];
    for (let n = min; n <= max; n += step) list.push(n);
    if (list[list.length - 1] !== max) list.push(max);
    return list;
  }, [min, max, step]);

  const found = steps.findIndex((s) => s >= value);
  const idx = found === -1 ? steps.length - 1 : found;

  const dec = () => onChange(steps[Math.max(0, idx - 1)] ?? min);
  const inc = () => onChange(steps[Math.min(steps.length - 1, idx + 1)] ?? max);

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Radius: {value} m</Text>
      <View style={styles.controls}>
        <Pressable style={styles.btn} onPress={dec}>
          <Text style={styles.btnText}>−</Text>
        </Pressable>
        <View style={styles.track}>
          <View
            style={[
              styles.fill,
              { width: `${((value - min) / (max - min)) * 100}%` },
            ]}
          />
        </View>
        <Pressable style={styles.btn} onPress={inc}>
          <Text style={styles.btnText}>+</Text>
        </Pressable>
      </View>
      <Text style={styles.hint}>
        {min}–{max} m (default 50)
      </Text>
    </View>
  );
}

function createStyles(c: ThemeColors) {
  return StyleSheet.create({
    wrap: {
      gap: spacing.sm,
    },
    label: {
      fontSize: 16,
      fontWeight: '600',
      color: c.text,
    },
    controls: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    btn: {
      width: 40,
      height: 40,
      borderRadius: radii.sm,
      backgroundColor: c.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    btnText: {
      color: c.primaryOn,
      fontSize: 22,
      fontWeight: '600',
      lineHeight: 24,
    },
    track: {
      flex: 1,
      height: 8,
      borderRadius: 4,
      backgroundColor: c.border,
      overflow: 'hidden',
    },
    fill: {
      height: '100%',
      backgroundColor: c.primary,
    },
    hint: {
      fontSize: 13,
      color: c.muted,
    },
  });
}
