import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as Notifications from 'expo-notifications';
import { useTranslation } from 'react-i18next';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { dismissUpdateNotification } from '../../notifications/notify';
import {
  getNativeNotificationPrefs,
  setNativeGateOpenNoticeEnabled,
  setNativeMonitorNoticeEnabled,
  setNativeNoticesEnabled,
} from '../../platform/keepAliveAlarm';
import {
  loadUpdateNoticeEnabled,
  setUpdateNoticeEnabled,
} from '../../updates/updateNotice';
import { useRtlLayout } from '../../i18n/useRtlLayout';
import { Group, Hairline } from '../components/Group';
import { useTheme } from '../ThemeProvider';
import { spacing, type ThemeColors } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Notifications'>;

export function NotificationsScreen(_props: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { row, writingDirection, textAlign } = useRtlLayout();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [allOn, setAllOn] = useState(true);
  const [gateOpenOn, setGateOpenOn] = useState(true);
  const [monitorOn, setMonitorOn] = useState(true);
  const [updatesOn, setUpdatesOn] = useState(true);

  const refresh = useCallback(async () => {
    const [native, updates] = await Promise.all([
      getNativeNotificationPrefs(),
      loadUpdateNoticeEnabled(),
    ]);
    setAllOn(native.all);
    setGateOpenOn(native.gateOpen);
    setMonitorOn(native.monitor);
    setUpdatesOn(updates);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const askNotifyPermission = () => {
    void (async () => {
      const current = await Notifications.getPermissionsAsync();
      if (!current.granted) {
        await Notifications.requestPermissionsAsync();
      }
    })();
  };

  const onAll = (value: boolean) => {
    setAllOn(value);
    void (async () => {
      await setNativeNoticesEnabled(value);
      if (!value) {
        await dismissUpdateNotification();
        return;
      }
      askNotifyPermission();
    })();
  };

  const onGateOpen = (value: boolean) => {
    setGateOpenOn(value);
    void setNativeGateOpenNoticeEnabled(value);
  };

  const onMonitor = (value: boolean) => {
    setMonitorOn(value);
    void setNativeMonitorNoticeEnabled(value);
  };

  const onUpdates = (value: boolean) => {
    setUpdatesOn(value);
    void (async () => {
      await setUpdateNoticeEnabled(value);
      if (!value) {
        await dismissUpdateNotification();
        return;
      }
      askNotifyPermission();
    })();
  };

  const kindsOff = !allOn;

  return (
    <ScrollView
      contentContainerStyle={styles.page}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.lede, { writingDirection, textAlign }]}>
        {t('notifications.lede')}
      </Text>
      <Group>
        <ToggleRow
          label={t('notifications.all')}
          detail={t('notifications.allDetail')}
          value={allOn}
          onValueChange={onAll}
          colors={colors}
          row={row}
          writingDirection={writingDirection}
          textAlign={textAlign}
        />
      </Group>
      <Text style={[styles.lede, { writingDirection, textAlign }]}>
        {t('notifications.kindsLede')}
      </Text>
      <Group>
        <ToggleRow
          label={t('notifications.gateOpen')}
          detail={t('notifications.gateOpenDetail')}
          value={gateOpenOn}
          onValueChange={onGateOpen}
          disabled={kindsOff}
          colors={colors}
          row={row}
          writingDirection={writingDirection}
          textAlign={textAlign}
        />
        <Hairline inset={16} />
        <ToggleRow
          label={t('notifications.monitor')}
          detail={t('notifications.monitorDetail')}
          value={monitorOn}
          onValueChange={onMonitor}
          disabled={kindsOff}
          colors={colors}
          row={row}
          writingDirection={writingDirection}
          textAlign={textAlign}
        />
        <Hairline inset={16} />
        <ToggleRow
          label={t('notifications.updates')}
          detail={t('notifications.updatesDetail')}
          value={updatesOn}
          onValueChange={onUpdates}
          disabled={kindsOff}
          colors={colors}
          row={row}
          writingDirection={writingDirection}
          textAlign={textAlign}
        />
      </Group>
    </ScrollView>
  );
}

function ToggleRow({
  label,
  detail,
  value,
  onValueChange,
  disabled = false,
  colors,
  row,
  writingDirection,
  textAlign,
}: {
  label: string;
  detail: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
  colors: ThemeColors;
  row: 'row' | 'row-reverse';
  writingDirection: 'ltr' | 'rtl';
  textAlign: 'left' | 'right';
}) {
  return (
    <View
      style={{
        flexDirection: row,
        alignItems: 'center',
        gap: 14,
        paddingVertical: 16,
        paddingHorizontal: 16,
        backgroundColor: colors.surface,
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text
          style={{
            fontSize: 17,
            fontWeight: '600',
            color: colors.text,
            letterSpacing: -0.2,
            writingDirection,
            textAlign,
          }}
        >
          {label}
        </Text>
        <Text
          style={{
            fontSize: 13,
            color: colors.muted,
            writingDirection,
            textAlign,
          }}
        >
          {detail}
        </Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ false: colors.border, true: colors.primaryMuted }}
        thumbColor={value && !disabled ? colors.primary : colors.switchThumbOff}
      />
    </View>
  );
}

function createStyles(c: ThemeColors) {
  return StyleSheet.create({
    page: {
      padding: spacing.md,
      gap: spacing.md,
      paddingBottom: spacing.lg,
      backgroundColor: c.background,
    },
    lede: {
      fontSize: 14,
      lineHeight: 20,
      color: c.muted,
      paddingHorizontal: 4,
    },
  });
}
