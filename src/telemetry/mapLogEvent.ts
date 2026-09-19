import { isTestEvent } from '../data/eventFilters';
import type { EventKind, EventTrigger, LogEvent } from '../data/eventLog';
import { hashGateId } from './privacy';
import type { AutoOpenSource, AutoSkipReason, MappedTelemetry } from './types';

const OPEN_KIND_SOURCE: Partial<Record<EventKind, AutoOpenSource>> = {
  opened: 'play_enter',
  exit_open: 'play_exit',
  bt_connect_open: 'bt',
  poll_open: 'poll',
  eligible_now_open: 'recover',
};

const SKIP_KIND_REASON: Partial<Record<EventKind, AutoSkipReason>> = {
  skipped_refine: 'outside_radius',
  bt_connect_outside: 'outside_radius',
  skipped_bt: 'bt_missing',
  exit_skipped_bt: 'bt_missing',
  cooldown: 'cooldown',
  safety_lock: 'safety_lock',
  error: 'other',
  poll_error: 'other',
  eligible_now_error: 'other',
};

function sourceFromTrigger(
  trigger: EventTrigger | undefined,
  fallback: AutoOpenSource,
): AutoOpenSource {
  if (trigger === 'enter') return 'play_enter';
  if (trigger === 'exit') return 'play_exit';
  if (trigger === 'bt_connect') return 'bt';
  if (trigger === 'poll') return 'poll';
  if (trigger === 'eligible_now') return 'recover';
  return fallback;
}

/**
 * Map an in-app Monitoring event to Analytics. Never uses message text
 * (messages may contain PalGate deviceId).
 */
export function mapLogEvent(
  event: Pick<LogEvent, 'kind' | 'gateId' | 'distanceM' | 'trigger'>,
): MappedTelemetry | null {
  if (isTestEvent(event)) return null;

  const gateHash = event.gateId ? hashGateId(event.gateId) : undefined;
  const distanceM =
    typeof event.distanceM === 'number' && Number.isFinite(event.distanceM)
      ? event.distanceM
      : undefined;

  const openSource = OPEN_KIND_SOURCE[event.kind];
  if (openSource) {
    return {
      type: 'auto_open',
      source: sourceFromTrigger(event.trigger, openSource),
      gateHash,
      distanceM,
      // JS open path only runs while JS is alive → warm by definition. Native
      // cold-wake opens report their own warm=0 via GateAutoTelemetry.
      warm: true,
    };
  }

  const skipReason = SKIP_KIND_REASON[event.kind];
  if (skipReason) {
    return {
      type: 'auto_skip',
      reason: skipReason,
      source: event.trigger
        ? sourceFromTrigger(event.trigger, 'poll')
        : undefined,
      gateHash,
      distanceM,
    };
  }

  return null;
}
