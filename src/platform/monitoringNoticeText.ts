/**
 * Executable spec for the Android monitoring notice.
 *
 * The notification itself is built natively in
 * `src/platform/android-keepalive/MonitoringNotice.java` (a foreground-service
 * notification cannot be posted from JS). These functions mirror the two pieces
 * of that class that are worth pinning down — the live status text and the
 * swipe-restore guard — so `tests/monitoringNotice.test.ts` can cover the
 * wording, pluralization and backoff rules, and fail if the Java literals drift
 * away from them.
 */

const JUST_NOW_MS = 10_000;
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** Matches MonitoringNotice.RESTORE_* in the Java. */
export const RESTORE_WINDOW_MS = 10_000;
export const RESTORE_LIMIT = 5;
export const RESTORE_BACKOFF_MS = 60_000;

function freshness(lastCheckMs: number, now: number): string {
  if (!(lastCheckMs > 0)) return 'starting…';
  // Clock moved backwards (NTP / user change) — never render a negative age.
  const age = Math.max(0, now - lastCheckMs);
  if (age < JUST_NOW_MS) return 'last check just now';
  if (age < MINUTE_MS) return `last check ${Math.floor(age / 1000)}s ago`;
  if (age < HOUR_MS) return `last check ${Math.floor(age / MINUTE_MS)}m ago`;
  return `last check ${Math.floor(age / HOUR_MS)}h ago`;
}

/** e.g. "Monitoring 5 gates · last check 12s ago". */
export function monitoringNoticeText(
  gateCount: number,
  lastCheckMs: number,
  now: number,
): string {
  const gates = Number.isFinite(gateCount) ? Math.floor(gateCount) : 0;
  const base =
    gates <= 0
      ? 'Searching for nearby gates'
      : gates === 1
        ? 'Monitoring 1 gate'
        : `Monitoring ${gates} gates`;
  return `${base} · ${freshness(lastCheckMs, now)}`;
}

export type NoticeRestoreState = {
  windowStartedAt: number;
  restoresInWindow: number;
  backoffUntil: number;
};

export function newNoticeRestoreState(): NoticeRestoreState {
  return { windowStartedAt: 0, restoresInWindow: 0, backoffUntil: 0 };
}

/**
 * Whether a dismissed notice may be re-posted. A dismissal is user-driven and a
 * re-post cannot itself fire another delete intent, so this cannot loop on its
 * own; the window only makes an OEM/listener that keeps cancelling us back off
 * instead of becoming a notify storm.
 *
 * Callers apply the harder guards first (armed, and the owning service still
 * running in this process).
 */
export function shouldAllowNoticeRestore(
  state: NoticeRestoreState,
  now: number,
): boolean {
  if (state.backoffUntil > 0 && now < state.backoffUntil) return false;
  state.backoffUntil = 0;
  if (
    state.windowStartedAt === 0 ||
    now - state.windowStartedAt > RESTORE_WINDOW_MS
  ) {
    state.windowStartedAt = now;
    state.restoresInWindow = 1;
    return true;
  }
  state.restoresInWindow += 1;
  if (state.restoresInWindow > RESTORE_LIMIT) {
    state.backoffUntil = now + RESTORE_BACKOFF_MS;
    state.windowStartedAt = 0;
    state.restoresInWindow = 0;
    return false;
  }
  return true;
}

export type NoticeOwner = {
  armed: boolean;
  monitoringServiceRunning: boolean;
  holdServiceRunning: boolean;
  /** Settings toggle. Missing / true = show and restore. */
  monitorNoticeEnabled?: boolean;
  /** Master shade switch. Missing / true = allowed. */
  noticesEnabled?: boolean;
};

export const MONITORING_NOTIF_ID = 41003;
export const HOLD_NOTIF_ID = 41005;

/**
 * Notification id of the service that currently owns the notice, or 0. Mirrors
 * MonitoringNotice.activeNotifId — the reason a dismissal can never resurrect a
 * notice after Auto-open is turned off or the process was force-stopped.
 */
export function activeNoticeId(owner: NoticeOwner): number {
  if (!owner.armed) return 0;
  if (owner.monitoringServiceRunning) return MONITORING_NOTIF_ID;
  if (owner.holdServiceRunning) return HOLD_NOTIF_ID;
  return 0;
}

export function shouldRepostDismissedNotice(
  owner: NoticeOwner,
  dismissedId: number,
): boolean {
  if (owner.noticesEnabled === false) return false;
  if (owner.monitorNoticeEnabled === false) return false;
  if (!dismissedId) return false;
  return dismissedId === activeNoticeId(owner);
}
