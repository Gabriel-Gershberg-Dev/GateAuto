import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRtlLayout } from '../../i18n/useRtlLayout';
import { IconChevronRight } from '../icons';
import { useTheme } from '../ThemeProvider';
import { spacing } from '../theme';
import { BarrierMark } from './BarrierMark';

/**
 * JS header that stays on-screen in Hebrew. Native-stack `headerTitle` as a
 * function + RTL clips Log / Refresh / Settings off the Android toolbar.
 */
export function NavHeader({
  title,
  mark = false,
  actions,
  onBack,
}: {
  title: string;
  mark?: boolean;
  actions?: ReactNode;
  onBack?: () => void;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { isRtl, row, writingDirection, textAlign } = useRtlLayout();

  return (
    <View
      style={[
        styles.safe,
        { paddingTop: insets.top, backgroundColor: colors.background },
      ]}
    >
      <View
        style={[
          styles.bar,
          {
            flexDirection: row,
            paddingStart: onBack ? 4 : spacing.md,
            paddingEnd: spacing.sm,
          },
        ]}
      >
        <View style={[styles.lead, { flexDirection: row }]}>
          {onBack ? (
            <HeaderIconButton
              onPress={onBack}
              accessibilityLabel={t('common.back')}
            >
              <View style={{ transform: [{ scaleX: isRtl ? 1 : -1 }] }}>
                <IconChevronRight color={colors.primary} size={22} />
              </View>
            </HeaderIconButton>
          ) : null}
          {mark ? <BarrierMark brand size={22} /> : null}
          <Text
            numberOfLines={1}
            ellipsizeMode="tail"
            style={[
              styles.title,
              { color: colors.text, writingDirection, textAlign },
            ]}
          >
            {title}
          </Text>
        </View>
        {actions ? (
          <View
            collapsable={false}
            style={[styles.actions, { flexDirection: row }]}
          >
            {actions}
          </View>
        ) : null}
      </View>
    </View>
  );
}

export function HeaderIconButton({
  children,
  onPress,
  accessibilityLabel,
  wide,
}: {
  children: ReactNode;
  onPress: () => void;
  accessibilityLabel?: string;
  wide?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      accessibilityLabel={accessibilityLabel}
      style={[styles.iconBtn, wide && styles.iconBtnWide]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: {
    overflow: 'visible',
  },
  bar: {
    minHeight: 56,
    alignItems: 'center',
    overflow: 'visible',
    width: '100%',
  },
  lead: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    gap: 8,
  },
  title: {
    flexShrink: 1,
    minWidth: 0,
    fontSize: 17,
    fontWeight: '600',
  },
  actions: {
    flexGrow: 0,
    flexShrink: 0,
    alignItems: 'center',
    overflow: 'visible',
  },
  iconBtn: {
    minWidth: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  iconBtnWide: {
    paddingHorizontal: 8,
  },
});
