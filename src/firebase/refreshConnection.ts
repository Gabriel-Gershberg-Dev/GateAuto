import { disableNetwork, enableNetwork } from 'firebase/firestore';
import { reportStaleNetwork } from '../platform/keepAliveAlarm';
import { db } from './app';
import { withTimeout } from './startupNetwork';

const STEP_MS = 2_500;
/** Android re-probes the network on each report; keep that rare while the splash retries. */
const SYSTEM_REPORT_GAP_MS = 60_000;
let lastSystemReportAt = 0;

/**
 * The phone can be online while this process still holds a dead socket.
 * Ask Android to re-check the current network (at most once a minute), then
 * drop Firestore's channel so the next read opens a new one.
 */
export async function refreshAppConnection(): Promise<void> {
  const now = Date.now();
  if (now - lastSystemReportAt >= SYSTEM_REPORT_GAP_MS) {
    lastSystemReportAt = now;
    await reportStaleNetwork();
  }
  try {
    await withTimeout(disableNetwork(db), STEP_MS);
  } catch {
    // The channel may already be gone. Enabling still starts a fresh one.
  }
  try {
    await withTimeout(enableNetwork(db), STEP_MS);
  } catch {
    // The next startup read opens the channel if this step timed out.
  }
}
