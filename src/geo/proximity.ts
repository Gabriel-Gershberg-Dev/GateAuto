import { haversineMeters, type LatLng } from './haversine';

/**
 * Legacy loose factor (logging only). Auto-open must use strict radius —
 * see OPEN_RADIUS_FACTOR / EXIT_RADIUS_FACTOR.
 */
export const REFINE_RADIUS_FACTOR = 1.15;

/** ENTER / BT-connect / eligible-now / poll / manual test: within configured pin radius. */
export const OPEN_RADIUS_FACTOR = 1.0;

/**
 * EXIT uses the same configured radius as ENTER. A 25m pin must not silently
 * open (or log) against 50m. Play may still fire EXIT early; the open check
 * stays fail-closed to the user’s radius (250m is only a garbage cap).
 */
export const EXIT_RADIUS_FACTOR = 1.0;

/** Always reject fixes worse than this (meters). */
export const MAX_REFINE_ACCURACY_M = 60;

/**
 * Fixes at or below this accuracy are accepted when inside the open distance.
 * Between GOOD and MAX, accept only if distance + accuracy <= radius
 * (uncertainty circle still inside the fence).
 */
export const GOOD_REFINE_ACCURACY_M = 50;

/**
 * Absolute sanity cap for garbage fixes (wrong city / hours-old last loc).
 * This is NOT the open threshold — auto-open must still be ≤ configured radius.
 */
export const ABSOLUTE_MAX_OPEN_DISTANCE_M = 250;

/**
 * Play Services geofences smaller than ~100m often never fire while the phone
 * is locked (GPS accuracy is worse than a 25–40m pin). Detect with at least
 * this radius; still only OPEN at the user's configured radius.
 */
export const MIN_PLAY_DETECT_RADIUS_M = 100;

/** Play detect fence: max(user radius, 100m), capped at the 250m city limit. */
export function playDetectRadiusM(userRadiusM: number): number {
  if (!Number.isFinite(userRadiusM) || userRadiusM <= 0) return 0;
  return Math.min(
    ABSOLUTE_MAX_OPEN_DISTANCE_M,
    Math.max(userRadiusM, MIN_PLAY_DETECT_RADIUS_M),
  );
}

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

/**
 * High GPS wait is for ENTER / EXIT / BT / manual test when the last fix is
 * still outside the pin. Poll must never wait — a hung High request from
 * headless JS blocks the 30s check ticker (Samsung). Already-inside last loc
 * also skips High (open at the configured radius edge; do not wait to get closer).
 */
export function shouldWaitForHighGps(
  trigger: RefineTrigger,
  alreadyInsideRadius: boolean,
): boolean {
  if (trigger === 'poll') return false;
  if (alreadyInsideRadius) return false;
  return true;
}

export function maxOpenDistanceM(
  radiusM: number,
  trigger: RefineTrigger,
): number {
  const factor =
    trigger === 'exit' ? EXIT_RADIUS_FACTOR : OPEN_RADIUS_FACTOR;
  return configuredOpenMaxM(radiusM * factor);
}

/** User radius, capped only by the 250m city-garbage limit. */
export function configuredOpenMaxM(radiusM: number): number {
  if (!Number.isFinite(radiusM) || radiusM <= 0) return 0;
  return Math.min(radiusM, ABSOLUTE_MAX_OPEN_DISTANCE_M);
}

export type PlayLocSource = 'triggering' | 'last';

export type PlayOpenOk = {
  ok: true;
  distanceM: number;
  source: PlayLocSource;
  maxDistanceM: number;
};

export type PlayOpenFail = {
  ok: false;
  distanceM?: number;
  source?: PlayLocSource;
  maxDistanceM: number;
  detail: string;
};

export type PlayOpenResult = PlayOpenOk | PlayOpenFail;

function finiteMeters(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Play ENTER/EXIT open gate. 250m is only a far-away sanity cap.
 * Prefer Play triggering location when it is ≤ configured radius.
 * If last loc and triggering loc are both missing or both > radius → skip.
 * Do not open “because Play said ENTER”.
 */
export function playOpenAllowed(
  radiusMeters: number,
  triggeringMeters: number | null | undefined,
  lastMeters: number | null | undefined,
): PlayOpenResult {
  const maxDistanceM = configuredOpenMaxM(radiusMeters);
  const samples: { meters: number; source: PlayLocSource }[] = [];
  const triggering = finiteMeters(triggeringMeters);
  const last = finiteMeters(lastMeters);
  if (triggering != null) samples.push({ meters: triggering, source: 'triggering' });
  if (last != null) samples.push({ meters: last, source: 'last' });

  if (samples.length === 0) {
    return {
      ok: false,
      maxDistanceM,
      detail: `skipped — no location (Play ENTER/EXIT is not enough; need fix ≤ radius ${maxDistanceM.toFixed(1)}m)`,
    };
  }

  const inside = samples.filter((s) => s.meters <= maxDistanceM);
  if (inside.length > 0) {
    const preferred =
      inside.find((s) => s.source === 'triggering') ?? inside[0];
    return {
      ok: true,
      distanceM: preferred.meters,
      source: preferred.source,
      maxDistanceM,
    };
  }

  const closest = samples.reduce((a, b) => (a.meters <= b.meters ? a : b));
  const city = closest.meters > ABSOLUTE_MAX_OPEN_DISTANCE_M;
  const detail = city
    ? `skipped — ${closest.source} loc ${closest.meters.toFixed(1)}m > ${ABSOLUTE_MAX_OPEN_DISTANCE_M}m city cap`
    : `skipped — ${closest.source} loc ${closest.meters.toFixed(1)}m > radius ${maxDistanceM.toFixed(1)}m`;
  return {
    ok: false,
    distanceM: closest.meters,
    source: closest.source,
    maxDistanceM,
    detail,
  };
}

/** @see playOpenAllowed — last-loc only (JS Expo task has no triggering fix). */
export function nativePlayTransitionOpenAllowed(
  radiusMeters: number,
  lastLocMissing: boolean,
  lastLocMeters: number,
  triggeringMeters?: number | null,
): boolean {
  return playOpenAllowed(
    radiusMeters,
    triggeringMeters,
    lastLocMissing ? null : lastLocMeters,
  ).ok;
}

/** @see playOpenAllowed */
export function nativeExitOpenAllowed(
  radiusMeters: number,
  lastLocMissing: boolean,
  lastLocMeters: number,
  triggeringMeters?: number | null,
): boolean {
  return nativePlayTransitionOpenAllowed(
    radiusMeters,
    lastLocMissing,
    lastLocMeters,
    triggeringMeters,
  );
}

/** @see playOpenAllowed */
export function nativeEnterOpenAllowed(
  radiusMeters: number,
  lastLocMissing: boolean,
  lastLocMeters: number,
  triggeringMeters?: number | null,
): boolean {
  return nativePlayTransitionOpenAllowed(
    radiusMeters,
    lastLocMissing,
    lastLocMeters,
    triggeringMeters,
  );
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
