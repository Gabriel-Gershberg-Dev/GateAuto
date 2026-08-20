import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  clearEvents,
  isMainMonitoringEvent,
  loadEvents,
  type LogEvent,
} from '../../data/eventLog';
import { importNativeOpenEvents } from '../../platform/keepAliveAlarm';
import { BarrierMark } from '../components/BarrierMark';
import { useTheme } from '../ThemeProvider';
import { radii, spacing, type ThemeColors } from '../theme';
import { useTranslation } from 'react-i18next';

function formatTs(ts: number): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

function kindColor(kind: LogEvent['kind'], c: ThemeColors): string {
  switch (kind) {
    case 'opened':
    case 'exit_open':
    case 'bt_connect_open':
    case 'eligible_now_open':
    case 'poll_open':
    case 'monitoring_armed':
      return c.success;
    case 'error':
    case 'eligible_now_error':
    case 'poll_error':
      return c.danger;
    case 'skipped_bt':
    case 'exit_skipped_bt':
    case 'skipped_refine':
    case 'bt_connect_outside':
    case 'cooldown':
    case 'safety_lock':
      return c.warning;
    default:
      return c.muted;
  }
}

export function MonitoringScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [events, setEvents] = useState<LogEvent[]>([]);

  const refresh = useCallback(async () => {
    await importNativeOpenEvents();
    const all = await loadEvents();
    setEvents(all.filter(isMainMonitoringEvent));
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  return (
    <View style={styles.container}>
      <View style={styles.logHeader}>
        <Text style={styles.section}>{t('log.whatHappened')}</Text>
        <Pressable
          onPress={() => {
            void (async () => {
              await clearEvents();
              setEvents([]);
            })();
          }}
        >
          <Text style={styles.clear}>{t('log.clear')}</Text>
        </Pressable>
      </View>

      <FlatList
        data={events}
        keyExtractor={(e) => e.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <BarrierMark size={48} color={colors.muted} />
            <Text style={styles.meta}>
              {t('log.empty')}
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const geoBits: string[] = [];
          if (item.trigger) geoBits.push(item.trigger);
          if (
            typeof item.distanceM === 'number' &&
            Number.isFinite(item.distanceM)
          ) {
            geoBits.push(t('log.away', { meters: item.distanceM.toFixed(0) }));
          }
          if (
            typeof item.accuracyM === 'number' &&
            Number.isFinite(item.accuracyM)
          ) {
            geoBits.push(`±${item.accuracyM.toFixed(0)}m`);
          }
          return (
            <View style={styles.event}>
              <Text
                style={[styles.kind, { color: kindColor(item.kind, colors) }]}
              >
                {item.kind}
              </Text>
              <Text style={styles.message}>{item.message}</Text>
              {geoBits.length > 0 ? (
                <Text style={styles.ts}>{geoBits.join(' · ')}</Text>
              ) : null}
              <Text style={styles.ts}>
                {formatTs(item.ts)}
                {item.gateId ? ` · ${item.gateId}` : ''}
              </Text>
            </View>
          );
        }}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
      />
    </View>
  );
}

function createStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: c.background,
      padding: spacing.lg,
      gap: spacing.md,
    },
    meta: {
      fontSize: 14,
      color: c.muted,
      lineHeight: 20,
      textAlign: 'center',
    },
    empty: {
      alignItems: 'center',
      gap: spacing.md,
      paddingTop: spacing.lg,
    },
    logHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    section: {
      fontSize: 17,
      fontWeight: '700',
      color: c.text,
    },
    clear: {
      color: c.primary,
      fontWeight: '600',
    },
    list: {
      flexGrow: 1,
      paddingBottom: spacing.lg,
    },
    event: {
      backgroundColor: c.surface,
      borderRadius: radii.sm,
      padding: spacing.md,
      gap: 4,
    },
    kind: {
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 1.1,
      textTransform: 'uppercase',
    },
    message: {
      fontSize: 15,
      color: c.text,
    },
    ts: {
      fontSize: 12,
      color: c.muted,
    },
  });
}
