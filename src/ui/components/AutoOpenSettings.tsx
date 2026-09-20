import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { displayGateName, loadGates, setMonitoringEnabled } from '../../data/gatesStore';
import { getActiveLocks } from '../../data/openSafetyLock';
import {
  getMonitoringArmStatus,
  type MonitoringArmStatus,
} from '../../geo/geofencing';
import {
  getGeofencingApi,
  tryStartGeofencing,
  tryStopGeofencing,
} from '../../integrations/optionalNative';
import { importNativeOpenEvents } from '../../platform/keepAliveAlarm';
import { BarrierMark } from './BarrierMark';
import { InfoSheet } from './ConfirmSheet';
import { IconInfo } from '../icons';
import { useTheme } from '../ThemeProvider';
import { paddedCardStyle, radii, spacing, type ThemeColors } from '../theme';
import { useTranslation } from 'react-i18next';
import { useRtlLayout } from '../../i18n/useRtlLayout';

export function AutoOpenSettings() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { row, writingDirection, textAlign } = useRtlLayout();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [enabled, setEnabled] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [armStatus, setArmStatus] = useState<MonitoringArmStatus | null>(null);
  const [lockBanner, setLockBanner] = useState<string | null>(null);
  const [gateCount, setGateCount] = useState(0);
  const running = useRef(false);
  const pending = useRef<boolean | null>(null);

  const refresh = useCallback(async () => {
    const status = await getMonitoringArmStatus();
    setEnabled(status.flagOn);
    setArmStatus(status);
    await importNativeOpenEvents();
    const gates = await loadGates();
    setGateCount(gates.length);
    const labels: Record<string, string> = {};
    for (const g of gates) {
      labels[g.id] = displayGateName(g);
    }
    const locks = await getActiveLocks(labels);
    if (locks.length === 0) {
      setLockBanner(null);
    } else if (locks.length === 1) {
      const lock = locks[0];
      const name = labels[lock.gateId]?.trim() ?? '';
      const who = name ? `${name}: ` : '';
      const mins = Math.max(1, Math.ceil(lock.remainingMs / 60_000));
      setLockBanner(t('safety.lockBanner', { who, mins }));
    } else {
      const list = locks
        .map((lock) => {
          const mins = Math.max(1, Math.ceil(lock.remainingMs / 60_000));
          const label = labels[lock.gateId]?.trim() || lock.gateId;
          return t('safety.minsItem', { label, mins });
        })
        .join(' · ');
      setLockBanner(t('safety.lockBannerMulti', { list }));
    }
  }, [t]);

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

  let status = t('autoOpen.off');
  if (reallyArmed) status = t('autoOpen.armed');
  else if (enabled) status = t('autoOpen.onNotArmed');

  if (gateCount === 0) return null;

  return (
    <>
      <View style={styles.card}>
        <View style={[styles.row, { flexDirection: row }]}>
          <BarrierMark watching={enabled} size={28} />
          <View style={styles.copy}>
            <View style={[styles.titleRow, { flexDirection: row }]}>
              <Text
                style={[styles.title, { writingDirection, textAlign }]}
                numberOfLines={2}
              >
                {t('autoOpen.title')}
              </Text>
              <Pressable
                onPress={() => setInfoOpen(true)}
                hitSlop={10}
                accessibilityLabel={t('autoOpen.how')}
                style={styles.infoBtn}
              >
                <IconInfo color={colors.muted} size={18} />
              </Pressable>
            </View>
            <Text
              style={[styles.meta, { writingDirection, textAlign }]}
              numberOfLines={3}
            >
              {t('autoOpen.meta')}
            </Text>
          </View>
          <View style={styles.switchSlot}>
          <Switch
            value={enabled}
            onValueChange={(v) => void onToggle(v)}
            trackColor={{ false: colors.border, true: colors.primaryMuted }}
            thumbColor={enabled ? colors.primary : colors.switchThumbOff}
          />
          </View>
        </View>
        {armStatus ? (
          <Text
            style={[
              styles.status,
              reallyArmed ? styles.statusOk : enabled ? styles.statusWarn : null,
            ]}
          >
            {status}
            {getGeofencingApi() == null ? t('autoOpen.notWired') : ''}
          </Text>
        ) : null}
        {lockBanner ? (
          <Text style={styles.lockBanner}>{lockBanner}</Text>
        ) : null}
        <Text
          style={[styles.meta, { writingDirection, textAlign }]}
          numberOfLines={3}
        >
          {t('widget.howAdd')}
        </Text>
      </View>
      <InfoSheet
        visible={infoOpen}
        title={t('autoOpen.title')}
        message={t('autoOpen.info')}
        onDismiss={() => setInfoOpen(false)}
      />
    </>
  );
}

function createStyles(c: ThemeColors) {
  return StyleSheet.create({
    card: {
      ...paddedCardStyle(c),
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
      alignItems: 'center',
      gap: 6,
      minWidth: 0,
      flexShrink: 1,
    },
    title: {
      flex: 1,
      minWidth: 0,
      fontSize: 17,
      fontWeight: '600',
      color: c.text,
      letterSpacing: -0.2,
    },
    switchSlot: {
      flexShrink: 0,
      justifyContent: 'center',
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
      marginStart: 40,
    },
    statusOk: {
      color: c.success,
    },
    statusWarn: {
      color: c.warning,
    },
    lockBanner: {
      fontSize: 13,
      fontWeight: '600',
      color: c.warning,
      backgroundColor: c.warningBg,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.sm,
      borderRadius: radii.sm,
      marginStart: 40,
    },
  });
}
