/**
 * On-foot Auto-open. The saved gate radius and car Bluetooth stay as stored.
 * A listed car that is connected uses that saved path. Walking only applies
 * when the person is not in that car.
 *
 * Numbers are mirrored in PalGateNativeOpen.java.
 */

export type WalkingLevel = 'normal' | 'high';

export const WALKING_NORMAL_MAX_M = 7;
export const WALKING_NORMAL_FLOOR_M = 5;
export const WALKING_HIGH_MAX_M = 12;
export const WALKING_HIGH_FLOOR_M = 8;

/** Below this speed, GPS bearing is noise. Missing bearing never blocks. */
export const WALKING_HEADING_MIN_SPEED_MPS = 1.2;
/** Heading more than this many degrees off the pin delays the open. */
export const WALKING_HEADING_AWAY_DEG = 100;
/**
 * A 5–7 m ring never contains a 15 m GPS blob under the normal accuracy
 * rule. Accept a fix this loose when the point itself is inside the ring.
 */
export const WALKING_MAX_ACCURACY_M = 25;

export function normalizeWalkingLevel(raw: unknown): WalkingLevel {
  return raw === 'high' ? 'high' : 'normal';
}

/**
 * On-foot open distance. Never larger than the saved radius.
 * 50 m pin → 7 m normal / 12 m high. 10 m pin → 7 / 10 m.
 */
export function walkingOpenMaxM(savedRadius: number, level: WalkingLevel): number {
  if (!Number.isFinite(savedRadius) || savedRadius <= 0) return 0;
  const cap = level === 'high' ? WALKING_HIGH_MAX_M : WALKING_NORMAL_MAX_M;
  const floor = level === 'high' ? WALKING_HIGH_FLOOR_M : WALKING_NORMAL_FLOOR_M;
  if (savedRadius < floor) return savedRadius;
  return Math.max(Math.min(savedRadius, cap), Math.min(savedRadius, floor));
}

/** "on_foot" | "in_vehicle" | "unknown". Motion off ignores this. */
export type WalkActivityKind = 'on_foot' | 'in_vehicle' | 'unknown';

/** True when this open should use the walking radius and skip car Bluetooth. */
export function footOpenApplies(input: {
  walkingEnabled: boolean;
  motionEnabled?: boolean;
  activity?: WalkActivityKind;
  btRequired: boolean;
  listedCarConnected: boolean;
}): boolean {
  const activity = input.motionEnabled ? input.activity ?? 'unknown' : 'unknown';
  if (activity === 'in_vehicle') return false;
  if (activity === 'on_foot') return true;
  if (!input.walkingEnabled) return false;
  if (input.btRequired && input.listedCarConnected) return false;
  return true;
}

export function angleDeltaDegrees(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** Initial bearing from one point to another, degrees clockwise from north. */
export function bearingDegrees(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
): number | null {
  if (
    ![fromLat, fromLng, toLat, toLng].every(
      (n) => typeof n === 'number' && Number.isFinite(n),
    )
  ) {
    return null;
  }
  const lat1 = (fromLat * Math.PI) / 180;
  const lat2 = (toLat * Math.PI) / 180;
  const dLng = ((toLng - fromLng) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  const deg = (Math.atan2(y, x) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/**
 * Delay only. Missing speed or bearing allows the open.
 * A clear "walking away" heading does not.
 */
export function walkingHeadingAllows(input: {
  speedMps: number | null | undefined;
  bearingDeg: number | null | undefined;
  bearingToPinDeg: number | null | undefined;
}): boolean {
  const speed = input.speedMps;
  const bearing = input.bearingDeg;
  const toPin = input.bearingToPinDeg;
  if (speed == null || bearing == null || toPin == null) return true;
  if (!Number.isFinite(speed) || speed < WALKING_HEADING_MIN_SPEED_MPS) return true;
  if (!Number.isFinite(bearing) || !Number.isFinite(toPin)) return true;
  return angleDeltaDegrees(bearing, toPin) <= WALKING_HEADING_AWAY_DEG;
}

/** Unknown accuracy does not block. A very loose fix does. */
export function walkingAccuracyOk(accuracyM: number): boolean {
  if (!Number.isFinite(accuracyM) || accuracyM <= 0) return true;
  return accuracyM <= WALKING_MAX_ACCURACY_M;
}
