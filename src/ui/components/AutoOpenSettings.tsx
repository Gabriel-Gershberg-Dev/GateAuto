import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { setMonitoringEnabled } from '../../data/gatesStore';
import {
  getMonitoringArmStatus,
  type MonitoringArmStatus,
} from '../../geo/geofencing';
import {
  getGeofencingApi,
  tryStartGeofencing,
  tryStopGeofencing,
} from '../../integrations/optionalNative';
import { BarrierMark } from './BarrierMark';
import { InfoSheet } from './ConfirmSheet';
import { IconInfo } from '../icons';
import { useTheme } from '../ThemeProvider';
import { radii, spacing, type ThemeColors } from '../theme';

export function AutoOpenSettings() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [enabled, setEnabled] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [armStatus, setArmStatus] = useState<MonitoringArmStatus | null>(null);
  const running = useRef(false);
  const pending = useRef<boolean | null>(null);

  const refresh = useCallback(async () => {
    const status = await getMonitoringArmStatus();
    setEnabled(status.flagOn);
    setArmStatus(status);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const onToggle = async (value: boolean) => {
    // Show the new value immediately. Disabling the Switch while busy makes
    // Android keep the old thumb until the screen remounts.
    setEnabled(value);
    pending.current = value;
    if (running.current) return;
    running.current = true;
    try {
      while (pending.current !== null) {
        const next = pending.current;
        pending.current = null;
        try {
          if (next) {
            const wired = await tryStartGeofencing();
            if (!wired) await setMonitoringEnabled(true);
          } else {
            const wired = await tryStopGeofencing();
            if (!wired) await setMonitoringEnabled(false);
          }
        } catch {
          // start/stop persist the flag if they got that far
        }
      }
    } finally {
      running.current = false;
      await refresh();
    }
  };

  const reallyArmed =
    !!armStatus?.flagOn &&
    armStatus.geofencingActive &&
    armStatus.btWatchOn;

  let status = 'Off';
  if (reallyArmed) status = 'Armed';
  else if (enabled) status = 'On — not fully armed';

  return (
    <>
      <View style={styles.card}>
        <View style={styles.row}>
          <BarrierMark watching={enabled} size={28} />
          <View style={styles.copy}>
            <View style={styles.titleRow}>
              <Text style={styles.title}>Auto-open</Text>
              <Pressable
                onPress={() => setInfoOpen(true)}
                hitSlop={10}
                accessibilityLabel="How auto-open works"
                style={styles.infoBtn}
              >
                <IconInfo color={colors.muted} size={18} />
              </Pressable>
            </View>
            <Text style={styles.meta}>Opens when you arrive</Text>
          </View>
          <Switch
            value={enabled}
            onValueChange={(v) => void onToggle(v)}
            trackColor={{ false: colors.border, true: colors.primaryMuted }}
            thumbColor={enabled ? colors.primary : colors.switchThumbOff}
          />
        </View>
        {armStatus ? (
          <Text
            style={[
              styles.status,
              reallyArmed ? styles.statusOk : enabled ? styles.statusWarn : null,
            ]}
          >
            {status}
            {getGeofencingApi() == null
              ? ' · geofencing not wired in this build'
              : ''}
          </Text>
        ) : null}
      </View>
      <InfoSheet
        visible={infoOpen}
        title="Auto-open"
        message="Opens the gate when you arrive, leave, or connect the car. While Auto-open is on, Android keeps a pinned “Searching for nearby gates” notice (same idea as PalGate — it cannot be swiped away). After an open, the next check is at that gate’s cooldown — not a 2-minute GPS batch."
        onDismiss={() => setInfoOpen(false)}
      />
    </>
  );
}

function createStyles(c: ThemeColors) {
  return StyleSheet.create({
    card: {
      backgroundColor: c.surface,
      borderRadius: radii.md,
      padding: spacing.md,
      gap: 8,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    copy: {
      flex: 1,
      minWidth: 0,
      gap: 2,
    },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    title: {
      fontSize: 17,
      fontWeight: '600',
      color: c.text,
      letterSpacing: -0.2,
    },
    infoBtn: {
      padding: 2,
    },
    meta: {
      fontSize: 13,
      color: c.muted,
    },
    status: {
      fontSize: 13,
      color: c.muted,
      fontWeight: '600',
      marginLeft: 40,
    },
    statusOk: {
      color: c.success,
    },
    statusWarn: {
      color: c.warning,
    },
  });
}
