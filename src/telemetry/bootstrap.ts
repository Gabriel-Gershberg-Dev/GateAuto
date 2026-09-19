import { AppState, Platform } from 'react-native';
import { probeAutoOpenPermissions } from '../permissions/autoOpenPermissions';
import { isMonitoringEnabled, loadGates, type GateConfig } from '../data/gatesStore';
import { logPermissionState, setCrashKeys } from './native';

let lastPermKey = '';
let lastPermAt = 0;
const PERM_MIN_MS = 120_000;

function fenceReady(gate: GateConfig): boolean {
  return (
    !gate.shareDisabled &&
    gate.enabled &&
    typeof gate.lat === 'number' &&
    Number.isFinite(gate.lat) &&
    typeof gate.lng === 'number' &&
    Number.isFinite(gate.lng) &&
    Number.isFinite(gate.radiusMeters) &&
    gate.radiusMeters > 0
  );
}

export async function refreshCrashKeys(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    const [armed, gates, probe] = await Promise.all([
      isMonitoringEnabled(),
      loadGates(),
      probeAutoOpenPermissions(),
    ]);
    await setCrashKeys({
      autoOn: armed,
      fenceCount: gates.filter(fenceReady).length,
      alwaysLocation: probe.locationBg,
    });
  } catch {
    // ignore
  }
}

export async function reportPermissionState(force = false): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    const probe = await probeAutoOpenPermissions();
    const key = [
      probe.locationBg ? 1 : 0,
      probe.notifications ? 1 : 0,
      probe.bluetooth ? 1 : 0,
      probe.batteryUnrestricted ? 1 : 0,
    ].join('');
    const now = Date.now();
    if (!force && key === lastPermKey && now - lastPermAt < PERM_MIN_MS) return;
    lastPermKey = key;
    lastPermAt = now;
    logPermissionState({
      alwaysLoc: probe.locationBg,
      notifications: probe.notifications,
      btConnect: probe.bluetooth,
      batteryUnrestricted: probe.batteryUnrestricted,
    });
    await setCrashKeys({ alwaysLocation: probe.locationBg });
  } catch {
    // ignore
  }
}

/** App start: Crashlytics keys + a permission snapshot. */
export function startTelemetryBootstrap(): void {
  void refreshCrashKeys();
  void reportPermissionState(true);
  AppState.addEventListener('change', (next) => {
    if (next === 'active') {
      void refreshCrashKeys();
      void reportPermissionState();
    }
  });
}
