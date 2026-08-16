import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useTheme } from '../ThemeProvider';
import { radii, spacing, type ThemeColors } from '../theme';

type Props = {
  value: string;
  size?: number;
  /** When false, only the QR is shown (use for long payloads). Default true. */
  showValue?: boolean;
};

export function QrCard({ value, size = 300, showValue = true }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={styles.wrap}>
      <QRCode
        value={value}
        size={size}
        backgroundColor={colors.surface}
        color={colors.text}
      />
      {showValue ? (
        <Text style={styles.hint} selectable>
          {value}
        </Text>
      ) : null}
    </View>
  );
}

function createStyles(c: ThemeColors) {
  return StyleSheet.create({
    wrap: {
      alignItems: 'center',
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: radii.md,
      padding: spacing.lg,
      gap: spacing.md,
    },
    hint: {
      fontSize: 16,
      fontWeight: '600',
      color: c.text,
      textAlign: 'center',
      fontFamily: 'monospace',
    },
  });
}
