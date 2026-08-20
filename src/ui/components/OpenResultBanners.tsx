import { useEffect, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../ThemeProvider';
import { radii, spacing, type ThemeColors } from '../theme';
import { useTranslation } from 'react-i18next';

export type OpenBanner = {
  id: string;
  gateId: string;
  name: string;
  success: boolean;
  message: string;
};

type Props = {
  banners: OpenBanner[];
  onDismiss: (id: string) => void;
  /** Auto-hide after this many ms (0 = stay until dismissed). */
  autoHideMs?: number;
  /**
   * `inline` sits in document flow (does not cover the list).
   * `bottom` floats above the home indicator.
   */
  placement?: 'inline' | 'bottom';
};

function BannerRow({
  banner,
  onDismiss,
  autoHideMs,
  styles,
}: {
  banner: OpenBanner;
  onDismiss: (id: string) => void;
  autoHideMs: number;
  styles: ReturnType<typeof createStyles>;
}) {
  const { t } = useTranslation();
  useEffect(() => {
    if (autoHideMs <= 0) return;
    const timer = setTimeout(() => onDismiss(banner.id), autoHideMs);
    return () => clearTimeout(timer);
  }, [banner.id, autoHideMs, onDismiss]);

  return (
    <Pressable
      style={[
        styles.banner,
        banner.success ? styles.bannerOk : styles.bannerFail,
      ]}
      onPress={() => onDismiss(banner.id)}
    >
      <View
        style={[
          styles.lamp,
          banner.success ? styles.lampOk : styles.lampFail,
        ]}
      />
      <View style={styles.textCol}>
        <Text style={styles.eyebrow}>
          {banner.success ? t('gates.opened') : t('gates.couldntOpen')}
        </Text>
        <Text style={styles.name} numberOfLines={1}>
          {banner.name}
        </Text>
        <Text
          style={[
            styles.message,
            banner.success ? styles.messageOk : styles.messageFail,
          ]}
          numberOfLines={2}
        >
          {banner.message}
        </Text>
      </View>
    </Pressable>
  );
}

export function OpenResultBanners({
  banners,
  onDismiss,
  autoHideMs = 3500,
  placement = 'inline',
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  if (banners.length === 0) return null;

  return (
    <View
      style={placement === 'bottom' ? styles.stackBottom : styles.stackInline}
      pointerEvents="box-none"
    >
      {banners.map((b) => (
        <BannerRow
          key={b.id}
          banner={b}
          onDismiss={onDismiss}
          autoHideMs={autoHideMs}
          styles={styles}
        />
      ))}
    </View>
  );
}

function createStyles(c: ThemeColors) {
  return StyleSheet.create({
    stackInline: {
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
      paddingBottom: spacing.sm,
      gap: spacing.sm,
    },
    stackBottom: {
      position: 'absolute',
      left: spacing.md,
      right: spacing.md,
      bottom: spacing.sm,
      zIndex: 20,
      gap: spacing.sm,
    },
    banner: {
      flexDirection: 'row',
      alignItems: 'stretch',
      overflow: 'hidden',
      borderRadius: radii.pill,
      borderWidth: 0,
      shadowColor: c.shadow,
      shadowOpacity: 0.16,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 3 },
      elevation: 4,
    },
    bannerOk: {
      backgroundColor: c.successBg,
      borderColor: c.successBorder,
    },
    bannerFail: {
      backgroundColor: c.failBg,
      borderColor: c.failBorder,
    },
    lamp: {
      width: 5,
    },
    lampOk: {
      backgroundColor: c.primary,
    },
    lampFail: {
      backgroundColor: c.fail,
    },
    eyebrow: {
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      color: c.muted,
    },
    textCol: {
      flex: 1,
      gap: 2,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 2,
    },
    name: {
      fontSize: 15,
      fontWeight: '700',
      color: c.text,
    },
    message: {
      fontSize: 13,
      lineHeight: 18,
    },
    messageOk: {
      color: c.success,
    },
    messageFail: {
      color: c.fail,
    },
  });
}
