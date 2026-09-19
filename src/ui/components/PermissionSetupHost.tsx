import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../auth/AuthProvider';
import { useRtlLayout } from '../../i18n/useRtlLayout';
import {
  decidePermissionSheet,
  markPermissionSetupLater,
  refreshPermissionStatus,
  requestAllMissing,
  requestCriticalPermission,
  startPermissionAppStateRefresh,
  subscribeOpenPermissionSetup,
  subscribePermissionStatus,
  type CriticalPermissionId,
} from '../../permissions/autoOpenPermissions';
import { openSamsungDeviceCareBattery } from '../../platform/androidBatteryLinks';
import { IconShield } from '../icons';
import { useTheme } from '../ThemeProvider';
import { HUD_TEAL, hudFrameStyle, spacing, type ThemeColors } from '../theme';
import { useReduceMotion } from '../useReduceMotion';
import { ConfirmSheet } from './ConfirmSheet';

function rowLabel(
  id: CriticalPermissionId,
  t: (key: string) => string,
): string {
  switch (id) {
    case 'location':
      return t('permissions.rowLocation');
    case 'notifications':
      return t('permissions.rowNotif');
    case 'bluetooth':
      return t('permissions.rowBt');
    case 'battery':
      return t('permissions.rowBattery');
  }
}

const ALL_ROWS: CriticalPermissionId[] = [
  'location',
  'notifications',
  'bluetooth',
  'battery',
];

/**
 * After login (email / Google / guest), not on splash or Sign in.
 * Skip if already granted. Later still lets them use the app.
 */
export function PermissionSetupHost() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { row, writingDirection } = useRtlLayout();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { user } = useAuth();
  const [visible, setVisible] = useState(false);
  const [missing, setMissing] = useState<CriticalPermissionId[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => subscribePermissionStatus(setMissing), []);

  useEffect(() => {
    return startPermissionAppStateRefresh();
  }, []);

  useEffect(() => {
    if (!user) {
      setVisible(false);
      setMissing([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const decision = await decidePermissionSheet({ signedIn: true });
      if (cancelled) return;
      if (decision.showSheet) setVisible(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    return subscribeOpenPermissionSetup(() => {
      if (!user) return;
      setVisible(true);
      void refreshPermissionStatus();
    });
  }, [user]);

  useEffect(() => {
    if (visible && missing.length === 0) setVisible(false);
  }, [missing, visible]);

  const onLater = () => {
    setVisible(false);
    void markPermissionSetupLater();
  };

  const onGrant = async () => {
    setBusy(true);
    try {
      await requestAllMissing(missing);
      const next = await refreshPermissionStatus();
      if (next.length === 0) setVisible(false);
    } finally {
      setBusy(false);
    }
  };

  const onRow = async (id: CriticalPermissionId) => {
    if (busy || !missing.includes(id)) return;
    setBusy(true);
    try {
      await requestCriticalPermission(id);
      await refreshPermissionStatus();
    } finally {
      setBusy(false);
    }
  };

  const batteryMissing = missing.includes('battery');

  return (
    <ConfirmSheet
      visible={visible && missing.length > 0}
      icon={<IconShield color={colors.primary} size={22} />}
      title={t('permissions.setupTitle')}
      message={t('permissions.setupBody')}
      cancelLabel={t('permissions.setupLater')}
      confirmLabel={t('permissions.setupGrant')}
      extraLabel={batteryMissing ? t('permissions.deviceCare') : undefined}
      confirmDisabled={busy}
      onCancel={onLater}
      onConfirm={() => void onGrant()}
      onExtra={
        batteryMissing ? () => void openSamsungDeviceCareBattery() : undefined
      }
    >
      <View style={styles.list}>
        {ALL_ROWS.map((id) => {
          const need = missing.includes(id);
          return (
            <Pressable
              key={id}
              onPress={() => void onRow(id)}
              disabled={!need || busy}
              style={({ pressed }) => [
                styles.permRow,
                { flexDirection: row },
                pressed && need && styles.pressed,
              ]}
              accessibilityRole="button"
              accessibilityState={{ disabled: !need }}
            >
              <View style={[styles.dot, need ? styles.dotNeed : styles.dotOk]} />
              <Text
                style={[styles.permLabel, { writingDirection }]}
                numberOfLines={2}
              >
                {rowLabel(id, t)}
              </Text>
              <Text
                style={[
                  need ? styles.permAction : styles.permOk,
                  { writingDirection },
                ]}
                numberOfLines={1}
              >
                {need
                  ? id === 'battery'
                    ? t('permissions.openSettings')
                    : t('common.allow')
                  : t('permissions.granted')}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </ConfirmSheet>
  );
}

function createStyles(c: ThemeColors) {
  return StyleSheet.create({
    list: {
      gap: 4,
    },
    permRow: {
      alignItems: 'center',
      minHeight: 44,
      paddingVertical: 6,
      gap: 8,
    },
    dot: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    dotOk: {
      backgroundColor: c.success,
    },
    dotNeed: {
      backgroundColor: c.warning,
    },
    permLabel: {
      flex: 1,
      minWidth: 0,
      flexShrink: 1,
      fontSize: 15,
      fontWeight: '600',
      color: c.text,
    },
    permAction: {
      flexShrink: 0,
      maxWidth: '46%',
      fontSize: 13,
      fontWeight: '700',
      color: c.primary,
    },
    permOk: {
      flexShrink: 0,
      fontSize: 13,
      fontWeight: '700',
      color: c.success,
    },
    pressed: {
      opacity: 0.72,
    },
  });
}

/** Compact one-line warning on Gates. Tap re-opens setup. */
export function PermissionWarningBanner({
  onPress,
}: {
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { row, writingDirection } = useRtlLayout();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const bannerStyles = useMemo(() => bannerStyle(colors), [colors]);
  const [missing, setMissing] = useState<CriticalPermissionId[]>([]);
  const reduceMotion = useReduceMotion();
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => subscribePermissionStatus(setMissing), []);

  useEffect(() => {
    if (missing.length === 0) {
      fade.setValue(0);
      return;
    }
    if (reduceMotion) {
      fade.setValue(1);
      return;
    }
    fade.setValue(0);
    Animated.timing(fade, {
      toValue: 1,
      duration: 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [fade, missing.length, reduceMotion]);

  if (missing.length === 0) return null;

  return (
    <Animated.View
      style={{
        opacity: fade,
        transform: [
          {
            translateY: fade.interpolate({
              inputRange: [0, 1],
              outputRange: [-8, 0],
            }),
          },
        ],
      }}
    >
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          bannerStyles.box,
          { flexDirection: row },
          pressed && styles.pressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel={t('permissions.bannerA11y')}
      >
        <View style={bannerStyles.lamp} />
        <Text
          style={[bannerStyles.text, { writingDirection, flex: 1 }]}
          numberOfLines={2}
        >
          {t('permissions.banner')}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

function bannerStyle(c: ThemeColors) {
  return StyleSheet.create({
    box: {
      ...hudFrameStyle(),
      alignItems: 'center',
      gap: 8,
      marginHorizontal: spacing.md,
      marginTop: 8,
      backgroundColor: c.surface,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    lamp: {
      width: 6,
      height: 6,
      borderRadius: 3,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: HUD_TEAL,
      backgroundColor: HUD_TEAL,
    },
    text: {
      color: c.warning,
      fontSize: 13,
      fontWeight: '600',
    },
  });
}
