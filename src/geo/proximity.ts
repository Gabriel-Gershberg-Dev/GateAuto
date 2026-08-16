import { haversineMeters, type LatLng } from './haversine';

/**
 * Legacy loose factor (logging only). Auto-open must use strict radius —
 * see OPEN_RADIUS_FACTOR / EXIT_RADIUS_FACTOR.
 */
export const REFINE_RADIUS_FACTOR = 1.15;

/** ENTER / BT-connect / eligible-now / poll / manual test: within configured pin radius. */
export const OPEN_RADIUS_FACTOR = 1.0;

/**
 * EXIT: allow a small overshoot past the fence edge (just left the circle).
 * Far-away protection still comes from ABSOLUTE_MAX_OPEN_DISTANCE_M.
 */
export const EXIT_RADIUS_FACTOR = 1.1;

/** Always reject fixes worse than this (meters). */
export const MAX_REFINE_ACCURACY_M = 60;

/**
 * Fixes at or below this accuracy are accepted when inside the open distance.
 * Between GOOD and MAX, accept only if distance + accuracy <= radius
 * (uncertainty circle still inside the fence).
 */
export const GOOD_REFINE_ACCURACY_M = 50;

/**
 * Absolute sanity cap: never auto-open if GPS says you are farther than this
 * from the pin, regardless of a misconfigured huge radius.
 */
export const ABSOLUTE_MAX_OPEN_DISTANCE_M = 250;

/**
 * Reject fixes older than this. Background wakes often return a slightly aged
 * high-accuracy sample; 25s is still far from hours-old lastKnown abuse.
 */
export const MAX_LOCATION_AGE_MS = 25_000;

export type RefineTrigger =
  | 'enter'
  | 'exit'
  | 'bt_connect'
  | 'eligible_now'
  | 'poll'
  | 'manual_test';

export type LocationFix = {
  lat: number;
  lng: number;
  accuracy: number;
  ageMs: number;
  timestamp: number;
};

export type NearGateOk = {
  ok: true;
  distanceM: number;
  maxDistanceM: number;
};

export type NearGateFail = {
  ok: false;
  reason: 'skipped_refine';
  distanceM: number;
  maxDistanceM: number;
  detail: string;
};

export type NearGateResult = NearGateOk | NearGateFail;

export type GateProximityTarget = {
  lat: number;
  lng: number;
  radiusMeters: number;
};

export function maxOpenDistanceM(
  radiusM: number,
  trigger: RefineTrigger,
): number {
  const factor =
    trigger === 'exit' ? EXIT_RADIUS_FACTOR : OPEN_RADIUS_FACTOR;
  return Math.min(radiusM * factor, ABSOLUTE_MAX_OPEN_DISTANCE_M);
}

/**
 * Accuracy gate for a fix that already passed distance.
 * - ≤ GOOD: accept
 * - GOOD..MAX: accept only when distance + accuracy <= radius (clearly inside)
 * - > MAX: reject
 */
export function accuracyAcceptable(
  accuracyM: number,
  distanceM: number,
  radiusM: number,
): { ok: true } | { ok: false; detail: string } {
  if (!Number.isFinite(accuracyM)) {
    return { ok: false, detail: 'accuracy unknown / non-finite' };
  }
  if (accuracyM > MAX_REFINE_ACCURACY_M) {
    return {
      ok: false,
      detail: `accuracy ${accuracyM.toFixed(1)}m > ${MAX_REFINE_ACCURACY_M}m`,
    };
  }
  if (accuracyM <= GOOD_REFINE_ACCURACY_M) {
    return { ok: true };
  }
  // Marginal 50–60m: only if the uncertainty ball still fits inside the fence.
  if (distanceM + accuracyM <= radiusM) {
    return { ok: true };
  }
  return {
    ok: false,
    detail: `accuracy ${accuracyM.toFixed(1)}m marginal; distance+accuracy ${(distanceM + accuracyM).toFixed(1)}m > radius ${radiusM.toFixed(1)}m`,
  };
}

/**
 * Pure proximity gate: distance must be within configured radius (or EXIT
 * factor) and under the absolute sanity cap. Call only with a fresh fix.
 */
export function assertNearGate(
  gate: GateProximityTarget,
  fix: LocationFix,
  trigger: RefineTrigger,
): NearGateResult {
  const pin: LatLng = { lat: gate.lat, lng: gate.lng };
  const distanceM = haversineMeters(pin, { lat: fix.lat, lng: fix.lng });
  const maxDistanceM = maxOpenDistanceM(gate.radiusMeters, trigger);

  if (distanceM > maxDistanceM) {
    const absoluteNote =
      distanceM > ABSOLUTE_MAX_OPEN_DISTANCE_M
        ? ` (absolute cap ${ABSOLUTE_MAX_OPEN_DISTANCE_M}m)`
        : '';
    return {
      ok: false,
      reason: 'skipped_refine',
      distanceM,
      maxDistanceM,
      detail: `distance ${distanceM.toFixed(1)}m > ${maxDistanceM.toFixed(1)}m${absoluteNote}`,
    };
  }

  return { ok: true, distanceM, maxDistanceM };
}
