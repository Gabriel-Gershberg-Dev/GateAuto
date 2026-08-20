import { loadCredentialsForGate } from '../data/credentials';
import type { GateConfig } from '../data/gatesStore';
import { effectiveHoldMs } from '../data/holdNormalize';
import { openGate } from '../palgate/api';
import {
  hasNativeKeepAlive,
  scheduleCooldownWake,
  startNativeHold,
} from '../platform/keepAliveAlarm';
import { HOLD_PULSE_MIN_MS, holdPulseIntervalMs } from './holdLogic';

const jsHoldUntil = new Map<string, number>();
const jsHoldTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function peekJsHoldUntil(deviceId: string): number {
  return jsHoldUntil.get(deviceId) ?? 0;
}

export function rememberJsHoldUntil(deviceId: string, until: number): void {
  if (!deviceId) return;
  if (until > Date.now()) jsHoldUntil.set(deviceId, until);
  else jsHoldUntil.delete(deviceId);
}

function clearJsHoldTimer(deviceId: string): void {
  const prev = jsHoldTimers.get(deviceId);
  if (prev) clearTimeout(prev);
  jsHoldTimers.delete(deviceId);
}

async function pulseJsHold(gate: GateConfig, until: number): Promise<void> {
  const deviceId = String(gate.deviceId ?? '').trim();
  if (!deviceId) return;
  const remaining = until - Date.now();
  if (remaining < HOLD_PULSE_MIN_MS) {
    jsHoldUntil.delete(deviceId);
    clearJsHoldTimer(deviceId);
    return;
  }
  try {
    const credentials = await loadCredentialsForGate(gate);
    if (credentials) {
      await openGate(credentials, deviceId);
    }
  } catch {
    // Silent — hold pulses never notify or log.
  }
  const interval = holdPulseIntervalMs(gate.holdMs);
  const delay = Math.max(
    HOLD_PULSE_MIN_MS,
    Math.min(interval || HOLD_PULSE_MIN_MS, remaining),
  );
  const timer = setTimeout(() => {
    void pulseJsHold(gate, until);
  }, delay);
  jsHoldTimers.set(deviceId, timer);
}

/**
 * After a successful auto-open: native hold pulses on Android (lock-safe).
 * JS timers are a foreground/iOS fallback only.
 */
export async function beginHoldAfterAutoOpen(gate: GateConfig): Promise<void> {
  const deviceId = String(gate.deviceId ?? '').trim();
  const holdMs = effectiveHoldMs(gate.holdEnabled, gate.holdMs);
  const cooldownMs = gate.cooldownMs > 0 ? gate.cooldownMs : 15_000;
  clearJsHoldTimer(deviceId);
  if (!deviceId || holdMs <= 0) {
    if (deviceId) jsHoldUntil.delete(deviceId);
    void scheduleCooldownWake(cooldownMs + 1_500);
    return;
  }
  const until = Date.now() + holdMs;
  rememberJsHoldUntil(deviceId, until);
  if (hasNativeKeepAlive()) {
    await startNativeHold(deviceId, gate.id, holdMs);
    void scheduleCooldownWake(holdMs + cooldownMs + 1_500);
    return;
  }
  const first = holdPulseIntervalMs(holdMs);
  const timer = setTimeout(() => {
    void pulseJsHold(gate, until);
  }, first);
  jsHoldTimers.set(deviceId, timer);
  void scheduleCooldownWake(holdMs + cooldownMs + 1_500);
}
