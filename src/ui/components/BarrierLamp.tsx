import { View } from 'react-native';
import { useTheme } from '../ThemeProvider';

/** Status LED: lit when auto-open is on / armed. */
export function BarrierLamp({ lit, size = 10 }: { lit: boolean; size?: number }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: lit ? colors.primary : colors.border,
      }}
    />
  );
}
