import { type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '../ThemeProvider';
import { groupStyle } from '../theme';

/** One continuous surface — rows sit inside, hairlines between. */
export function Group({
  children,
  clip = true,
}: {
  children: ReactNode;
  clip?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View style={[groupStyle(colors), !clip && { overflow: 'visible' }]}>
      {children}
    </View>
  );
}

export function Hairline({ inset = 16 }: { inset?: number }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        height: StyleSheet.hairlineWidth,
        backgroundColor: colors.divider,
        marginStart: inset,
      }}
    />
  );
}
