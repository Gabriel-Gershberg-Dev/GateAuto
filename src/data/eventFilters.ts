const MAIN_MONITORING_KINDS = new Set<string>([
  'opened',
  'exit_open',
  'bt_connect_open',
  'eligible_now_open',
  'eligible_now_error',
  'poll_open',
  'poll_error',
  'bt_connect_outside',
  'skipped_bt',
  'exit_skipped_bt',
  'skipped_refine',
  'cooldown',
  'safety_lock',
  'monitoring_armed',
  'error',
]);

const AUTO_TRIGGERS = new Set<string>([
  'enter',
  'exit',
  'bt_connect',
  'eligible_now',
  'poll',
]);

export function isTestEvent(event: {
  kind: string;
  trigger?: string | null;
}): boolean {
  return event.kind.startsWith('test_') || event.trigger === 'manual_test';
}

/** Monitoring screen: real auto-open events only (no test_ / dry-run noise). */
export function isMainMonitoringEvent(event: {
  kind: string;
  trigger?: string | null;
}): boolean {
  if (isTestEvent(event)) return false;
  if (event.kind === 'info') {
    return event.trigger != null && AUTO_TRIGGERS.has(event.trigger);
  }
  return MAIN_MONITORING_KINDS.has(event.kind);
}
