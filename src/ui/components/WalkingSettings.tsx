import { useCallback, useMemo, useState } from 'react';
import { PermissionsAndroid, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { isMonitoringEnabled } from '../../data/gatesStore';
import {
  loadWalkingSettings,
  saveWalkingSettings,
  type WalkingSettings,
} from '../../data/walkingSettings';
import type { WalkingLevel } from '../../data/walkingMode';
import { useRtlLayout } from '../../i18n/useRtlLayout';
import { ConfirmSheet, InfoSheet } from './ConfirmSheet';
import { Toggle } from './Toggle';
import { useTheme } from '../ThemeProvider';
import { paddedCardStyle, radii, type ThemeColors } from '../theme';

export function WalkingSettings() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { row, writingDirection, textAlign } = useRtlLayout();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [autoOn, setAutoOn] = useState(false);
  const [settings, setSettings] = useState<WalkingSettings>({
    enabled: false,
    level: 'normal',
    motion: false,
  });
  const [explain, setExplain] = useState(false);
  const [needAuto, setNeedAuto] = useState(false);
  const [motionDenied, setMotionDenied] = useState(false);

  const refresh = useCallback(async () => {
    const [armed, walking] = await Promise.all([
      isMonitoringEnabled(),
      loadWalkingSettings(),
    ]);
    setAutoOn(armed);
    setSettings(walking);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const apply = async (next: Partial<WalkingSettings>) => {
    setSettings(await saveWalkingSettings(next));
  };

  const onToggle = (value: boolean) => {
    if (!autoOn) {
      setNeedAuto(true);
      return;
    }
    if (value) {
      setExplain(true);
      return;
    }
    void apply({ enabled: false });
  };

  const onMotion = (value: boolean) => {
    if (!autoOn) {
      setNeedAuto(true);
      return;
    }
    if (!value) {
      void apply({ motion: false });
      return;
    }
    void (async () => {
      if (Platform.OS === 'android' && Platform.Version >= 29) {
        const perm = PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION;
        const already = await PermissionsAndroid.check(perm);
        if (!already) {
          const result = await PermissionsAndroid.request(perm);
          if (result !== PermissionsAndroid.RESULTS.GRANTED) {
            setMotionDenied(true);
            return;
          }
        }
      }
      void apply({ motion: true });
    })();
  };

  const levelHint =
    settings.level === 'high' ? t('walking.highHint') : t('walking.normalHint');

  return (
    <>
      <View style={[styles.card, !autoOn && styles.dimmed]}>
        <View style={[styles.row, { flexDirection: row }]}>
          <View style={styles.copy}>
            <Text
              style={[styles.title, { writingDirection, textAlign }]}
              numberOfLines={1}
            >
              {t('walking.title')}
            </Text>
            <Text
              style={[styles.meta, { writingDirection, textAlign }]}
              numberOfLines={3}
            >
              {t('walking.detail')}
            </Text>
          </View>
          <Toggle
            value={settings.enabled && autoOn}
            onValueChange={onToggle}
            trackColor={{ false: colors.border, true: colors.primaryMuted }}
            thumbColor={
              settings.enabled && autoOn ? colors.primary : colors.switchThumbOff
            }
          />
        </View>
        {settings.enabled && autoOn ? (
          <>
            <View style={[styles.chips, { flexDirection: row }]}>
              {(['normal', 'high'] as WalkingLevel[]).map((level) => {
                const on = settings.level === level;
                return (
                  <Pressable
                    key={level}
                    onPress={() => void apply({ level })}
                    style={[styles.chip, on && styles.chipOn]}
                  >
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>
                      {t(level === 'high' ? 'walking.high' : 'walking.normal')}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={[styles.hint, { writingDirection, textAlign }]}>
              {levelHint}
            </Text>
          </>
        ) : null}
        <View style={[styles.row, { flexDirection: row }]}>
          <View style={styles.copy}>
            <Text style={[styles.title, { writingDirection, textAlign }]} numberOfLines={1}>
              {t('walking.motion')}
            </Text>
            <Text
              style={[styles.meta, { writingDirection, textAlign }]}
              numberOfLines={3}
            >
              {t('walking.motionDetail')}
            </Text>
          </View>
          <Toggle
            value={settings.motion && autoOn}
            onValueChange={onMotion}
            trackColor={{ false: colors.border, true: colors.primaryMuted }}
            thumbColor={
              settings.motion && autoOn ? colors.primary : colors.switchThumbOff
            }
          />
        </View>
      </View>
      <ConfirmSheet
        visible={explain}
        title={t('walking.explainTitle')}
        message={t('walking.explain')}
        cancelLabel={t('common.cancel')}
        confirmLabel={t('walking.turnOn')}
        onCancel={() => setExplain(false)}
        onConfirm={() => {
          setExplain(false);
          void apply({ enabled: true });
        }}
      />
      <InfoSheet
        visible={needAuto}
        title={t('walking.title')}
        message={t('walking.needAuto')}
        onDismiss={() => setNeedAuto(false)}
      />
      <InfoSheet
        visible={motionDenied}
        title={t('walking.motion')}
        message={t('walking.motionDenied')}
        onDismiss={() => setMotionDenied(false)}
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
    dimmed: {
      opacity: 0.55,
    },
    row: {
      alignItems: 'center',
      gap: 12,
    },
    copy: {
      flex: 1,
      minWidth: 0,
      gap: 2,
    },
    title: {
      fontSize: 17,
      fontWeight: '600',
      color: c.text,
      letterSpacing: -0.2,
    },
    meta: {
      fontSize: 13,
      color: c.muted,
    },
    chips: {
      gap: 8,
    },
    chip: {
      minWidth: 72,
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.background,
    },
    chipOn: {
      backgroundColor: c.primary,
      borderColor: c.primary,
    },
    chipText: {
      fontSize: 14,
      fontWeight: '700',
      color: c.text,
      textAlign: 'center',
    },
    chipTextOn: {
      color: c.primaryOn,
    },
    hint: {
      fontSize: 13,
      color: c.muted,
    },
  });
}
