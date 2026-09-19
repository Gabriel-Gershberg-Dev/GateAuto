import * as Location from 'expo-location';
import { haversineMeters, type LatLng } from './haversine';
import {
  accuracyAcceptable,
  assertNearGate,
  MAX_LOCATION_AGE_MS,
  shouldWaitForHighGps,
  type GateProximityTarget,
  type LocationFix,
  type RefineTrigger,
} from './proximity';

export {
  ABSOLUTE_MAX_OPEN_DISTANCE_M,
  accuracyAcceptable,
  assertNearGate,
  configuredOpenMaxM,
  EXIT_RADIUS_FACTOR,
  GOOD_REFINE_ACCURACY_M,
  MAX_LOCATION_AGE_MS,
  MAX_REFINE_ACCURACY_M,
  maxOpenDistanceM,
  MIN_PLAY_DETECT_RADIUS_M,
  nativeEnterOpenAllowed,
  nativeExitOpenAllowed,
  nativePlayTransitionOpenAllowed,
  OPEN_RADIUS_FACTOR,
  playDetectRadiusM,
  playOpenAllowed,
  REFINE_RADIUS_FACTOR,
  shouldWaitForHighGps,
  type GateProximityTarget,
  type LocationFix,
  type NearGateFail,
  type NearGateOk,
  type NearGateResult,
  type PlayOpenResult,
  type RefineTrigger,
} from './proximity';

/** Cap high-accuracy GPS attempts after geofence / BT wake (then stop). */
export const MAX_REFINE_ATTEMPTS = 4;

const REFINE_RETRY_DELAY_MS = 900;

export type RefineOk = {
  ok: true;
  lat: number;
  lng: number;
  accuracy: number;
  distanceM: number;
  ageMs: number;
  trigger: RefineTrigger;
};

export type RefineFail = {
  ok: false;
  reason: 'skipped_refine';
  lat?: number;
  lng?: number;
  accuracy?: number;
  distanceM?: number;
  ageMs?: number;
  trigger: RefineTrigger;
  detail?: string;
};

export type RefineResult = RefineOk | RefineFail;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseFix(position: Location.LocationObject): LocationFix {
  const accuracy =
    typeof position.coords.accuracy === 'number' &&
    Number.isFinite(position.coords.accuracy)
      ? position.coords.accuracy
      : Number.POSITIVE_INFINITY;
  return {
    lat: position.coords.latitude,
    lng: position.coords.longitude,
    accuracy,
    ageMs: Math.max(0, Date.now() - position.timestamp),
    timestamp: position.timestamp,
  };
}

function evaluateFix(
  position: Location.LocationObject,
  pin: LatLng,
  radiusM: number,
  trigger: RefineTrigger,
  options?: { ignoreAge?: boolean },
): RefineResult {
  const gate: GateProximityTarget = {
    lat: pin.lat,
    lng: pin.lng,
    radiusMeters: radiusM,
  };
  const fix = parseFix(position);
  const distanceM = haversineMeters(pin, { lat: fix.lat, lng: fix.lng });

  if (!options?.ignoreAge && fix.ageMs > MAX_LOCATION_AGE_MS) {
    return {
      ok: false,
      reason: 'skipped_refine',
      lat: fix.lat,
      lng: fix.lng,
      accuracy: fix.accuracy,
      distanceM,
      ageMs: fix.ageMs,
      trigger,
      detail: `stale fix age ${(fix.ageMs / 1000).toFixed(1)}s > ${MAX_LOCATION_AGE_MS / 1000}s`,
    };
  }

  const near = assertNearGate(gate, fix, trigger);
  if (!near.ok) {
    return {
      ok: false,
      reason: 'skipped_refine',
      lat: fix.lat,
      lng: fix.lng,
      accuracy: fix.accuracy,
      distanceM: near.distanceM,
      ageMs: fix.ageMs,
      trigger,
      detail: near.detail,
    };
  }

  const acc = accuracyAcceptable(fix.accuracy, near.distanceM, radiusM);
  if (!acc.ok) {
    return {
      ok: false,
      reason: 'skipped_refine',
      lat: fix.lat,
      lng: fix.lng,
      accuracy: fix.accuracy,
      distanceM: near.distanceM,
      ageMs: fix.ageMs,
      trigger,
      detail: acc.detail,
    };
  }

  return {
    ok: true,
    lat: fix.lat,
    lng: fix.lng,
    accuracy: fix.accuracy,
    distanceM: near.distanceM,
    ageMs: fix.ageMs,
    trigger,
  };
}

function isInsideConfiguredRadius(
  position: Location.LocationObject,
  pin: LatLng,
  radiusM: number,
  trigger: RefineTrigger,
): boolean {
  const gate: GateProximityTarget = {
    lat: pin.lat,
    lng: pin.lng,
    radiusMeters: radiusM,
  };
  return assertNearGate(gate, parseFix(position), trigger).ok;
}

async function refineOnce(
  pin: LatLng,
  radiusM: number,
  trigger: RefineTrigger,
  accuracy: Location.Accuracy,
): Promise<RefineResult> {
  try {
    const position = await Location.getCurrentPositionAsync({
      accuracy,
      mayShowUserSettingsDialog: false,
    });
    return evaluateFix(position, pin, radiusM, trigger, {
      ignoreAge: trigger === 'poll',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      reason: 'skipped_refine',
      trigger,
      detail: `location unavailable: ${message}`,
    };
  }
}

/**
 * Proximity check before auto-open.
 * Poll never waits for High GPS. Last loc already inside the configured
 * radius also skips High (do not wait to get closer). ENTER/EXIT/BT still
 * use High only when the last fix is outside the pin.
 */
export async function refineArrival(
  pin: LatLng,
  radiusM: number,
  trigger: RefineTrigger = 'enter',
): Promise<RefineResult> {
  try {
    const last = await Location.getLastKnownPositionAsync();
    if (last) {
      const inside = isInsideConfiguredRadius(last, pin, radiusM, trigger);
      if (!shouldWaitForHighGps(trigger, inside)) {
        const evaluated = evaluateFix(last, pin, radiusM, trigger, {
          ignoreAge: trigger === 'poll',
        });
        if (evaluated.ok || trigger === 'poll') {
          return evaluated;
        }
        // Inside but stale last-known: one Balanced fix, never High.
        return refineOnce(pin, radiusM, trigger, Location.Accuracy.Balanced);
      }
    } else if (trigger === 'poll') {
      return refineOnce(pin, radiusM, trigger, Location.Accuracy.Balanced);
    }
  } catch {
    if (trigger === 'poll') {
      return refineOnce(pin, radiusM, trigger, Location.Accuracy.Balanced);
    }
  }

  let lastFail: RefineFail | null = null;

  for (let attempt = 1; attempt <= MAX_REFINE_ATTEMPTS; attempt++) {
    let position: Location.LocationObject;
    try {
      position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
        // Background / headless: never surface a settings dialog.
        mayShowUserSettingsDialog: false,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastFail = {
        ok: false,
        reason: 'skipped_refine',
        trigger,
        detail: `location unavailable: ${message} (attempt ${attempt}/${MAX_REFINE_ATTEMPTS})`,
      };
      if (attempt < MAX_REFINE_ATTEMPTS) {
        await sleep(REFINE_RETRY_DELAY_MS);
        continue;
      }
      return lastFail;
    }

    const evaluated = evaluateFix(position, pin, radiusM, trigger);
    if (evaluated.ok) return evaluated;
    if (!evaluated.ok && evaluated.detail?.includes('distance')) {
      // Distance failures fail immediately — do not leave GPS on retrying "far".
      return evaluated;
    }
    lastFail = evaluated.ok
      ? lastFail
      : evaluated;
    if (attempt < MAX_REFINE_ATTEMPTS) {
      await sleep(REFINE_RETRY_DELAY_MS);
      continue;
    }
    return evaluated;
  }

  return (
    lastFail ?? {
      ok: false,
      reason: 'skipped_refine',
      trigger,
      detail: 'refine attempts exhausted',
    }
  );
}
