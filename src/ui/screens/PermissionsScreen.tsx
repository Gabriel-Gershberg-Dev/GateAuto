import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AppState,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { requestBluetoothPermissions } from '../../bluetooth/carBluetooth';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import {
  probeAutoOpenPermissions,
  refreshPermissionStatus,
  type PermissionProbe,
} from '../../permissions/autoOpenPermissions';
import {
  openAppDetailsSettings,
  openBatteryUnrestrictedPrompt,
  openSamsungDeviceCareBattery,
} from '../../platform/androidBatteryLinks';
import { useTheme } from '../ThemeProvider';
import { radii, spacing, type ThemeColors } from '../theme';
import { useTranslation } from 'react-i18next';
import { useRtlLayout } from '../../i18n/useRtlLayout';

type Props = NativeStackScreenProps<RootStackParamList, 'Permissions'>;

type PermState = 'unknown' | 'granted' | 'denied' | 'limited';

type ChecklistItem = {
  key: string;
  title: string;
  detail: string;
  state: PermState;
  actionLabel: string;
  onAction: () => void;
};

function labelFor(state: PermState, t: (key: string) => string): string {
  switch (state) {
    case 'granted':
      return t('permissions.granted');
    case 'denied':
      return t('permissions.needed');
    case 'limited':
      return t('permissions.limited');
    default:
      return t('permissions.check');
  }
}

function btState(probe: PermissionProbe | null): PermState {
  if (!probe) return 'unknown';
  return probe.bluetooth ? 'granted' : 'denied';
}

function batteryState(probe: PermissionProbe | null): PermState {
  if (!probe) return 'unknown';
  if (Platform.OS !== 'android') return 'granted';
  return probe.batteryUnrestricted ? 'granted' : 'denied';
}

export function PermissionsScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { row } = useRtlLayout();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [fg, setFg] = useState<PermState>('unknown');
  const [bg, setBg] = useState<PermState>('unknown');
  const [notif, setNotif] = useState<PermState>('unknown');
  const [probe, setProbe] = useState<PermissionProbe | null>(null);

  const refresh = useCallback(async () => {
    const next = await probeAutoOpenPermissions();
    setProbe(next);
    setFg(next.locationFg ? 'granted' : 'denied');
    setBg(next.locationBg ? 'granted' : 'denied');
    const n = await Notifications.getPermissionsAsync();
    setNotif(n.granted ? 'granted' : n.status === 'denied' ? 'denied' : 'limited');
    await refreshPermissionStatus();
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  const requestLocation = async () => {
    const foreground = await Location.requestForegroundPermissionsAsync();
    setFg(foreground.granted ? 'granted' : 'denied');
    if (foreground.granted) {
      const background = await Location.requestBackgroundPermissionsAsync();
      setBg(background.granted ? 'granted' : 'denied');
    }
    await refresh();
  };

  const requestNotifications = async () => {
    const n = await Notifications.requestPermissionsAsync();
    setNotif(n.granted ? 'granted' : 'denied');
    await refresh();
  };

  const requestBluetooth = async () => {
    try {
      const ok = await Promise.resolve(requestBluetoothPermissions()).catch(
        () => false,
      );
      if (!ok && Platform.OS === 'android') {
        void openAppDetailsSettings();
      }
    } catch {
      void openAppDetailsSettings();
    }
    await refresh();
  };

  const bluetooth = btState(probe);
  const battery = batteryState(probe);

  const items: ChecklistItem[] = [
    {
      key: 'loc-fg',
      title: t('permissions.locFg'),
      detail: t('permissions.locFgDetail'),
      state: fg,
      actionLabel: fg === 'granted' ? t('common.ok') : t('common.allow'),
      onAction: () => void requestLocation(),
    },
    {
      key: 'loc-bg',
      title: t('permissions.locBg'),
      detail: t('permissions.locBgDetail'),
      state: bg,
      actionLabel: bg === 'granted' ? t('common.ok') : t('permissions.allowAlways'),
      onAction: () => void requestLocation(),
    },
    {
      key: 'notif',
      title: t('permissions.notif'),
      detail: t('permissions.notifDetail'),
      state: notif,
      actionLabel: notif === 'granted' ? t('common.ok') : t('common.allow'),
      onAction: () => void requestNotifications(),
    },
    {
      key: 'bt',
      title: Platform.OS === 'android' ? t('permissions.btAndroid') : t('permissions.bt'),
      detail: t('permissions.btDetail'),
      state: bluetooth,
      actionLabel:
        bluetooth === 'granted' ? t('common.ok') : t('permissions.allowSettings'),
      onAction: () => void requestBluetooth(),
    },
  ];

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{t('permissions.title')}</Text>
      <Text style={styles.body}>{t('permissions.body')}</Text>

      {items.map((item) => (
        <View key={item.key} style={styles.card}>
          <View style={[styles.cardHeader, { flexDirection: row }]}>
            <Text style={styles.cardTitle} numberOfLines={2}>
              {item.title}
            </Text>
            <Text
              style={[
                styles.badge,
                item.state === 'granted' ? styles.badgeOk : styles.badgeWarn,
              ]}
              numberOfLines={1}
            >
              {labelFor(item.state, t)}
            </Text>
          </View>
          <Text style={styles.cardDetail}>{item.detail}</Text>
          {item.state !== 'granted' && (
            <Pressable style={styles.button} onPress={item.onAction}>
              <Text style={styles.buttonText}>{item.actionLabel}</Text>
            </Pressable>
          )}
        </View>
      ))}

      {Platform.OS === 'android' && (
        <View style={styles.card}>
          <View style={[styles.cardHeader, { flexDirection: row }]}>
            <Text style={styles.cardTitle} numberOfLines={2}>
              {t('permissions.samsungTitle')}
            </Text>
            <Text
              style={[
                styles.badge,
                battery === 'granted' ? styles.badgeOk : styles.badgeWarn,
              ]}
            >
              {labelFor(battery, t)}
            </Text>
          </View>
          <Text style={styles.cardDetail}>{t('permissions.samsungDetail')}</Text>
          {battery !== 'granted' && (
            <>
              <Text style={styles.steps}>{t('permissions.samsungSteps')}</Text>
              <View style={styles.buttonRow}>
                <Pressable
                  style={styles.button}
                  onPress={() => void openBatteryUnrestrictedPrompt()}
                >
                  <Text style={styles.buttonText}>{t('permissions.unrestricted')}</Text>
                </Pressable>
                <Pressable
                  style={styles.buttonSecondary}
                  onPress={() => void openSamsungDeviceCareBattery()}
                >
                  <Text style={styles.buttonSecondaryText}>
                    {t('permissions.deviceCare')}
                  </Text>
                </Pressable>
                <Pressable
                  style={styles.buttonSecondary}
                  onPress={() => void openAppDetailsSettings()}
                >
                  <Text style={styles.buttonSecondaryText}>
                    {t('permissions.appSettings')}
                  </Text>
                </Pressable>
              </View>
            </>
          )}
        </View>
      )}

      {Platform.OS !== 'android' && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('permissions.bgLocation')}</Text>
          <Text style={styles.cardDetail}>{t('permissions.bgLocationDetail')}</Text>
          <Pressable
            style={styles.button}
            onPress={() => void openAppDetailsSettings()}
          >
            <Text style={styles.buttonText}>{t('permissions.openSettings')}</Text>
          </Pressable>
        </View>
      )}

      <Pressable style={styles.secondary} onPress={() => void refresh()}>
        <Text style={styles.secondaryText}>{t('permissions.refresh')}</Text>
      </Pressable>

      <Pressable
        style={styles.primary}
        onPress={() => navigation.replace('GatesList')}
      >
        <Text style={styles.buttonText}>{t('permissions.continue')}</Text>
      </Pressable>
    </ScrollView>
  );
}

function createStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: {
      padding: spacing.lg,
      gap: spacing.md,
      backgroundColor: c.background,
    },
    title: {
      fontSize: 22,
      fontWeight: '700',
      color: c.text,
    },
    body: {
      fontSize: 16,
      color: c.muted,
      marginBottom: spacing.sm,
    },
    card: {
      backgroundColor: c.surface,
      borderRadius: radii.pill,
      padding: spacing.md,
      gap: spacing.sm,
    },
    cardHeader: {
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: spacing.sm,
    },
    cardTitle: {
      flex: 1,
      minWidth: 0,
      flexShrink: 1,
      fontSize: 16,
      fontWeight: '600',
      color: c.text,
    },
    badge: {
      flexShrink: 0,
      fontSize: 12,
      fontWeight: '600',
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: radii.sm,
      overflow: 'hidden',
    },
    badgeOk: {
      backgroundColor: c.successBg,
      color: c.success,
    },
    badgeWarn: {
      backgroundColor: c.warningBg,
      color: c.warning,
    },
    cardDetail: {
      fontSize: 14,
      color: c.muted,
    },
    steps: {
      fontSize: 14,
      lineHeight: 22,
      color: c.text,
    },
    buttonRow: {
      gap: spacing.sm,
    },
    button: {
      alignSelf: 'flex-start',
      minHeight: 44,
      justifyContent: 'center',
      backgroundColor: c.primary,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radii.sm,
    },
    buttonSecondary: {
      alignSelf: 'flex-start',
      minHeight: 44,
      justifyContent: 'center',
      backgroundColor: c.surface,
      borderColor: c.primary,
      borderWidth: 1,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radii.sm,
    },
    buttonSecondaryText: {
      color: c.primary,
      fontWeight: '600',
    },
    primary: {
      backgroundColor: c.primary,
      paddingVertical: 14,
      borderRadius: radii.pill,
      alignItems: 'center',
      marginTop: spacing.sm,
    },
    secondary: {
      paddingVertical: spacing.sm,
      alignItems: 'center',
    },
    secondaryText: {
      color: c.primary,
      fontWeight: '600',
    },
    buttonText: {
      color: c.primaryOn,
      fontWeight: '600',
    },
  });
}
