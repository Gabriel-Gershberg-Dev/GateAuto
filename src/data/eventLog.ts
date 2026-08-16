import AsyncStorage from '@react-native-async-storage/async-storage';

const LOG_KEY = 'gateauto.eventLog';
const MAX_EVENTS = 100;

export type EventKind =
  | 'opened'
  | 'exit_open'
  | 'bt_connect_open'
  | 'eligible_now_open'
  | 'eligible_now_error'
  | 'poll_open'
  | 'poll_error'
  | 'bt_connect_outside'
  | 'skipped_bt'
  | 'exit_skipped_bt'
  | 'skipped_refine'
  | 'cooldown'
  | 'safety_lock'
  | 'monitoring_armed'
  | 'error'
  | 'info'
  /** Manual at-gate checks — excluded from Monitoring event log. */
  | 'test_info'
  | 'test_opened'
  | 'test_skipped_refine'
  | 'test_skipped_bt'
  | 'test_error';

export type EventTrigger =
  | 'enter'
  | 'exit'
  | 'bt_connect'
  | 'eligible_now'
  | 'poll'
  | 'manual_test';

export type LogEvent = {
  id: string;
  ts: number;
  kind: EventKind;
  gateId?: string;
  message: string;
  /** Meters from gate pin when known. */
  distanceM?: number;
  /** Horizontal accuracy (meters) of the fix used. */
  accuracyM?: number;
  /** Which auto-open path produced this event. */
  trigger?: EventTrigger;
};

export { isMainMonitoringEvent, isTestEvent } from './eventFilters';

export async function loadEvents(): Promise<LogEvent[]> {
  const raw = await AsyncStorage.getItem(LOG_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as LogEvent[];
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

export async function appendEvent(
  partial: Omit<LogEvent, 'id' | 'ts'> & { ts?: number },
): Promise<LogEvent[]> {
  const events = await loadEvents();
  const next: LogEvent = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ts: partial.ts ?? Date.now(),
    kind: partial.kind,
    gateId: partial.gateId,
    message: partial.message,
    distanceM: partial.distanceM,
    accuracyM: partial.accuracyM,
    trigger: partial.trigger,
  };
  const merged = [next, ...events].slice(0, MAX_EVENTS);
  await AsyncStorage.setItem(LOG_KEY, JSON.stringify(merged));
  return merged;
}

export async function clearEvents(): Promise<void> {
  await AsyncStorage.removeItem(LOG_KEY);
}
