import { type ReactNode, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { isolateBidiText } from '../../i18n/bidi';
import { useRtlLayout } from '../../i18n/useRtlLayout';
import { IconChevronRight } from '../icons';
import { useTheme } from '../ThemeProvider';
import { HUD_TEAL, radii, type ThemeColors } from '../theme';
import { BarrierMark } from './BarrierMark';
import { Hairline } from './Group';

type Props = {
  name: string;
  count: number;
  autoCount: number;
  expanded: boolean;
  children?: ReactNode;
  onToggleExpand: () => void;
  onLongPress?: () => void;
  onUngroup: () => void;
  onRename: () => void;
  onAdd?: () => void;
};

export function GateListCard({
  name,
  count,
  autoCount,
  expanded,
  children,
  onToggleExpand,
  onLongPress,
  onUngroup,
  onRename,
  onAdd,
}: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { isRtl, row, writingDirection, textAlign } = useRtlLayout();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const title = isolateBidiText(name.trim() || t('gates.listDefault'), isRtl);
  const meta = autoCount > 0 ? t('autoOpen.auto') + ' ' + autoCount : null;

  return (
    <View style={styles.card}>
      <Pressable
        onPress={onToggleExpand}
        onLongPress={onLongPress}
        delayLongPress={420}
        style={({ pressed }) => [
          styles.header,
          { flexDirection: row },
          pressed && styles.pressed,
        ]}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={
          expanded ? t('gates.listA11yCollapse') : t('gates.listA11yExpand')
        }
      >
        <View
          style={[
            styles.chevronWell,
            {
              transform: [
                {
                  rotate: expanded ? '90deg' : isRtl ? '180deg' : '0deg',
                },
              ],
            },
          ]}
        >
          <IconChevronRight color={colors.muted} size={16} />
        </View>
        <BarrierMark size={26} watching={autoCount > 0} />
        <View style={styles.titles}>
          <Text
            style={[styles.name, { writingDirection, textAlign }]}
            numberOfLines={2}
            ellipsizeMode="tail"
          >
            {title}
          </Text>
          {meta ? (
            <Text
              style={[styles.meta, { writingDirection, textAlign }]}
              numberOfLines={1}
            >
              {meta}
            </Text>
          ) : null}
        </View>
        <View style={styles.countChip}>
          <Text style={styles.countText}>{count}</Text>
        </View>
      </Pressable>
      {expanded ? (
        <>
          <Hairline inset={0} />
          <View style={styles.body}>
            <View style={styles.well}>{children}</View>
          </View>
          <View style={[styles.footer, { flexDirection: row }]}>
            {onAdd ? (
              <Pressable
                onPress={onAdd}
                hitSlop={8}
                style={({ pressed }) => [styles.footerBtn, pressed && styles.pressed]}
              >
                <Text style={styles.footerText}>{t('gates.listAdd')}</Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={onRename}
              hitSlop={8}
              style={({ pressed }) => [styles.footerBtn, pressed && styles.pressed]}
            >
              <Text style={styles.footerText}>{t('gates.listRename')}</Text>
            </Pressable>
            <Pressable
              onPress={onUngroup}
              hitSlop={8}
              style={({ pressed }) => [styles.footerBtn, pressed && styles.pressed]}
            >
              <Text style={styles.footerUngroup}>{t('gates.listUngroup')}</Text>
            </Pressable>
          </View>
        </>
      ) : null}
    </View>
  );
}

function createStyles(c: ThemeColors) {
  return StyleSheet.create({
    card: {
      backgroundColor: c.surface,
      overflow: 'hidden',
      borderRadius: radii.md,
    },
    header: {
      alignItems: 'center',
      paddingStart: 10,
      paddingEnd: 12,
      minHeight: 64,
      gap: 8,
    },
    chevronWell: {
      width: 26,
      height: 26,
      borderRadius: 13,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.primaryMuted,
      flexShrink: 0,
    },
    titles: {
      flex: 1,
      minWidth: 0,
      gap: 2,
    },
    name: {
      fontSize: 16,
      lineHeight: 21,
      fontWeight: '600',
      color: c.text,
    },
    meta: {
      fontSize: 13,
      color: c.muted,
    },
    countChip: {
      minWidth: 28,
      height: 28,
      paddingHorizontal: 8,
      borderRadius: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: HUD_TEAL,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    countText: {
      color: HUD_TEAL,
      fontWeight: '700',
      fontSize: 13,
      fontVariant: ['tabular-nums'],
    },
    body: {
      paddingHorizontal: 8,
      paddingTop: 8,
      paddingBottom: 2,
    },
    well: {
      backgroundColor: c.background,
      borderRadius: radii.sm,
      overflow: 'hidden',
      paddingVertical: 4,
    },
    footer: {
      alignItems: 'center',
      justifyContent: 'flex-start',
      gap: 8,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    footerBtn: {
      minHeight: 36,
      paddingHorizontal: 8,
      justifyContent: 'center',
    },
    footerText: {
      color: c.primary,
      fontWeight: '700',
      fontSize: 14,
    },
    footerUngroup: {
      color: c.muted,
      fontWeight: '600',
      fontSize: 14,
    },
    pressed: {
      opacity: 0.72,
    },
  });
}
