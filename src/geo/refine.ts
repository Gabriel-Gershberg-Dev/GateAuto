import * as Location from 'expo-location';
import { haversineMeters, type LatLng } from './haversine';
import {
  accuracyAcceptable,
  assertNearGate,
  MAX_LOCATION_AGE_MS,
  type GateProximityTarget,
  type LocationFix,
  type RefineTrigger,
} from './proximity';

export {
  ABSOLUTE_MAX_OPEN_DISTANCE_M,
  accuracyAcceptable,
  assertNearGate,
  EXIT_RADIUS_FACTOR,
  GOOD_REFINE_ACCURACY_M,
  MAX_LOCATION_AGE_MS,
  MAX_REFINE_ACCURACY_M,
  maxOpenDistanceM,
  OPEN_RADIUS_FACTOR,
  REFINE_RADIUS_FACTOR,
  type GateProximityTarget,
  type LocationFix,
  type NearGateFail,
  type NearGateOk,
  type NearGateResult,
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

/**
 * Fresh high-accuracy proximity check before any auto-open.
 * Acquires GPS, rejects stale/poor accuracy, then assertNearGate.
 * Used by ENTER, EXIT, BT-connect, and manual at-gate test — fail closed.
 */
export async function refineArrival(
  pin: LatLng,
  radiusM: number,
  trigger: RefineTrigger = 'enter',
): Promise<RefineResult> {
  const gate: GateProximityTarget = {
    lat: pin.lat,
    lng: pin.lng,
    radiusMeters: radiusM,
  };
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

    const fix = parseFix(position);
    const distanceM = haversineMeters(pin, { lat: fix.lat, lng: fix.lng });

    if (fix.ageMs > MAX_LOCATION_AGE_MS) {
      lastFail = {
        ok: false,
        reason: 'skipped_refine',
        lat: fix.lat,
        lng: fix.lng,
        accuracy: fix.accuracy,
        distanceM,
        ageMs: fix.ageMs,
        trigger,
        detail: `stale fix age ${(fix.ageMs / 1000).toFixed(1)}s > ${MAX_LOCATION_AGE_MS / 1000}s (attempt ${attempt}/${MAX_REFINE_ATTEMPTS})`,
      };
      if (attempt < MAX_REFINE_ATTEMPTS) {
        await sleep(REFINE_RETRY_DELAY_MS);
        continue;
      }
      return lastFail;
    }

    const near = assertNearGate(gate, fix, trigger);
    if (!near.ok) {
      // Distance failures fail immediately — do not leave GPS on retrying "far".
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
      lastFail = {
        ok: false,
        reason: 'skipped_refine',
        lat: fix.lat,
        lng: fix.lng,
        accuracy: fix.accuracy,
        distanceM: near.distanceM,
        ageMs: fix.ageMs,
        trigger,
        detail: `${acc.detail} (attempt ${attempt}/${MAX_REFINE_ATTEMPTS})`,
      };
      if (attempt < MAX_REFINE_ATTEMPTS) {
        await sleep(REFINE_RETRY_DELAY_MS);
        continue;
      }
      return lastFail;
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

  return (
    lastFail ?? {
      ok: false,
      reason: 'skipped_refine',
      trigger,
      detail: 'refine attempts exhausted',
    }
  );
}
