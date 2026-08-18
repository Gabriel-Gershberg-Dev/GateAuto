import { NativeModules, Platform } from 'react-native';
import {
  nativeRegionFromGate,
  type NativeGeofenceRegion,
} from './nativeRegion';

export { nativeRegionFromGate, type NativeGeofenceRegion };

type GateAutoKeepAliveNative = {
  setArmed(armed: boolean): Promise<boolean>;
  isArmed?(): Promise<boolean>;
  syncRegions?(json: string): Promise<boolean>;
  scheduleCooldownWake?(delayMs: number): Promise<boolean>;
  syncCredentials?(
    sessionToken: string,
    phoneNumber: number,
    tokenType: number,
  ): Promise<boolean>;
  syncGateCredentialsJson?(json: string): Promise<boolean>;
  clearCredentials?(): Promise<boolean>;
  tryClaimOpen?(gateId: string, cooldownMs: number): Promise<boolean>;
  markOpened?(gateId: string): Promise<boolean>;
  releaseClaim?(gateId: string): Promise<boolean>;
  getLastOpened?(gateId: string): Promise<number>;
  drainNativeEvents?(): Promise<string>;
  getSafetyLocksJson?(): Promise<string>;
  clearSafetyLocks?(): Promise<boolean>;
};

function getNative(): GateAutoKeepAliveNative | null {
  if (Platform.OS !== 'android') return null;
  const mod = NativeModules.GateAutoKeepAlive as
    | GateAutoKeepAliveNative
    | undefined;
  return mod ?? null;
}

export function hasNativeKeepAlive(): boolean {
  return getNative() != null;
}

/** Native KeepAlivePrefs.armed, or null when the module is missing. */
export async function getNativeKeepAliveArmed(): Promise<boolean | null> {
  const native = getNative();
  if (!native?.isArmed) return null;
  try {
    return Boolean(await native.isArmed());
  } catch {
    return null;
  }
}

/** Mirror monitoring-enabled into native AlarmManager (no-op off Android / Expo Go). */
export async function setNativeKeepAliveArmed(armed: boolean): Promise<void> {
  const native = getNative();
  if (!native?.setArmed) return;
  try {
    await native.setArmed(armed);
  } catch (error) {
    console.warn('[GateAuto] setNativeKeepAliveArmed failed', error);
  }
}

/** Exact-while-idle wake so the next open can honor gate.cooldownMs (~20s). */
export async function scheduleCooldownWake(delayMs: number): Promise<void> {
  const native = getNative();
  if (!native?.scheduleCooldownWake) return;
  try {
    await native.scheduleCooldownWake(Math.max(2_000, delayMs));
  } catch (error) {
    console.warn('[GateAuto] scheduleCooldownWake failed', error);
  }
}

export async function writeNativeGateCredentialsJson(json: string): Promise<void> {
  const native = getNative();
  if (!native?.syncGateCredentialsJson) return;
  try {
    await native.syncGateCredentialsJson(json);
  } catch (error) {
    console.warn('[GateAuto] writeNativeGateCredentialsJson failed', error);
  }
}

export async function writeNativeCredentials(creds: {
  sessionToken: string;
  phoneNumber: number;
  tokenType: number;
} | null): Promise<void> {
  const native = getNative();
  if (!native?.syncCredentials && !native?.clearCredentials) return;
  try {
    if (!creds) {
      await native.clearCredentials?.();
      return;
    }
    await native.syncCredentials?.(
      creds.sessionToken,
      creds.phoneNumber,
      creds.tokenType,
    );
  } catch (error) {
    console.warn('[GateAuto] writeNativeCredentials failed', error);
  }
}

export async function tryClaimNativeOpen(
  gateId: string,
  cooldownMs: number,
): Promise<boolean> {
  const native = getNative();
  if (!native?.tryClaimOpen) return true;
  try {
    return await native.tryClaimOpen(gateId, cooldownMs);
  } catch {
    return true;
  }
}

export async function markNativeOpened(gateId: string): Promise<void> {
  const native = getNative();
  if (!native?.markOpened) return;
  try {
    await native.markOpened(gateId);
  } catch {
    // ignore
  }
}

export async function releaseNativeClaim(gateId: string): Promise<void> {
  const native = getNative();
  if (!native?.releaseClaim) return;
  try {
    await native.releaseClaim(gateId);
  } catch {
    // ignore
  }
}

export async function getNativeLastOpened(gateId: string): Promise<number> {
  const native = getNative();
  if (!native?.getLastOpened) return 0;
  try {
    const n = await native.getLastOpened(gateId);
    return typeof n === 'number' && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

type NativeQueuedEvent = {
  kind?: string;
  gateId?: string;
  message?: string;
  trigger?: string;
  ts?: number;
  distanceM?: number;
  accuracyM?: number;
};

/** Merge native auto-opens (poll/geofence/BT) into the in-app Monitoring log. */
export async function importNativeOpenEvents(): Promise<number> {
  const native = getNative();
  if (!native?.drainNativeEvents) return 0;
  try {
    const raw = await native.drainNativeEvents();
    if (!raw || raw === '[]') return 0;
    const parsed = JSON.parse(raw) as NativeQueuedEvent[];
    if (!Array.isArray(parsed) || parsed.length === 0) return 0;
    const { appendEvent } = await import('../data/eventLog');
    // Native stores newest-first; append oldest-first so the log stays newest-first.
    for (let i = parsed.length - 1; i >= 0; i--) {
      const e = parsed[i];
      if (!e || typeof e.message !== 'string' || !e.message.trim()) continue;
      const kind = (e.kind || 'poll_open') as
        | 'opened'
        | 'exit_open'
        | 'bt_connect_open'
        | 'poll_open'
        | 'safety_lock'
        | 'info';
      await appendEvent({
        kind,
        gateId: e.gateId || undefined,
        message: e.message,
        trigger:
          e.trigger === 'enter' ||
          e.trigger === 'exit' ||
          e.trigger === 'bt_connect' ||
          e.trigger === 'poll' ||
          e.trigger === 'eligible_now'
            ? e.trigger
            : 'poll',
        ts: typeof e.ts === 'number' && e.ts > 0 ? e.ts : undefined,
        distanceM: e.distanceM,
        accuracyM: e.accuracyM,
      });
    }
    return parsed.length;
  } catch (error) {
    console.warn('[GateAuto] importNativeOpenEvents failed', error);
    return 0;
  }
}

/** Native per-gate auto safety lockUntil timestamps (epoch ms). */
export async function getNativeSafetyLocks(): Promise<Record<string, number>> {
  const native = getNative();
  if (!native?.getSafetyLocksJson) return {};
  try {
    const raw = await native.getSafetyLocksJson();
    if (!raw || raw === '[]') return {};
    const parsed = JSON.parse(raw) as Array<{ gateId?: string; lockUntil?: number }>;
    if (!Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    const now = Date.now();
    for (const row of parsed) {
      const id = typeof row?.gateId === 'string' ? row.gateId.trim() : '';
      const until = typeof row?.lockUntil === 'number' ? row.lockUntil : 0;
      if (id && until > now) out[id] = until;
    }
    return out;
  } catch (error) {
    console.warn('[GateAuto] getNativeSafetyLocks failed', error);
    return {};
  }
}

export async function clearNativeSafetyLocks(): Promise<void> {
  const native = getNative();
  if (!native?.clearSafetyLocks) return;
  try {
    await native.clearSafetyLocks();
  } catch (error) {
    console.warn('[GateAuto] clearNativeSafetyLocks failed', error);
  }
}

/** Persist pin/radius in native prefs and (re)register Play Services geofences. */
export async function syncNativeMonitoring(
  armed: boolean,
  regions: NativeGeofenceRegion[],
): Promise<boolean> {
  const native = getNative();
  if (!native?.setArmed) return false;
  try {
    if (native.syncRegions) {
      await native.syncRegions(JSON.stringify(regions));
    }
    await native.setArmed(armed);
    return true;
  } catch (error) {
    console.warn('[GateAuto] syncNativeMonitoring failed', error);
    return false;
  }
}
