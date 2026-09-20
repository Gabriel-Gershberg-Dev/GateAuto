import { haversineMeters } from '../geo/haversine';

/** A linked gate with a finite map pin — same filter the Android widget uses. */
export type WidgetPin = {
  id: string;
  lat: number;
  lng: number;
  deviceId: string;
  lastOpenedAt: number;
};

export type RankedWidgetGate = {
  id: string;
  meters: number | null;
};

export function isPinnedCoord(lat: unknown, lng: unknown): boolean {
  return typeof lat === 'number' && Number.isFinite(lat)
    && typeof lng === 'number' && Number.isFinite(lng);
}

/**
 * Widget face / tap eligibility. Ignores Auto-open master and per-gate Auto.
 * Unpinned or unlinked gates never appear.
 *
 * Android display refresh (WidgetRefresh) never calls fused getLastLocation /
 * getCurrentLocation. It ranks from a cache written by MonitoringService
 * location callbacks and a user tap's requestCurrentOrLast, or this
 * lastClosest / lastOpened fallback when the cache is empty.
 */
export function isWidgetEligible(input: {
  id?: string;
  lat?: unknown;
  lng?: unknown;
  deviceId?: string;
  hasCredentials?: boolean;
  enabled?: boolean;
}): boolean {
  const id = String(input.id ?? '').trim();
  if (!id) return false;
  if (!isPinnedCoord(input.lat, input.lng)) return false;
  if (!String(input.deviceId ?? '').trim()) return false;
  return input.hasCredentials !== false;
}

export function rankPinnedGates(
  pins: WidgetPin[],
  loc: { lat: number; lng: number } | null,
  lastClosestId: string | null,
): RankedWidgetGate[] {
  const eligible = pins.filter((p) =>
    isWidgetEligible({
      id: p.id,
      lat: p.lat,
      lng: p.lng,
      deviceId: p.deviceId,
      hasCredentials: true,
    }),
  );
  if (eligible.length === 0) return [];

  const hasFix =
    loc != null && Number.isFinite(loc.lat) && Number.isFinite(loc.lng);

  if (hasFix && loc) {
    return eligible
      .map((p) => ({
        id: p.id,
        meters: haversineMeters({ lat: p.lat, lng: p.lng }, loc),
        lastOpenedAt: p.lastOpenedAt,
      }))
      .sort((a, b) => {
        const dm = a.meters - b.meters;
        if (dm !== 0) return dm;
        if (b.lastOpenedAt !== a.lastOpenedAt) return b.lastOpenedAt - a.lastOpenedAt;
        return a.id.localeCompare(b.id);
      })
      .map(({ id, meters }) => ({ id, meters }));
  }

  const last = String(lastClosestId ?? '').trim();
  const preferred = last ? eligible.find((p) => p.id === last) : undefined;
  const rest = eligible
    .filter((p) => p.id !== preferred?.id)
    .sort((a, b) => {
      if (b.lastOpenedAt !== a.lastOpenedAt) return b.lastOpenedAt - a.lastOpenedAt;
      return a.id.localeCompare(b.id);
    });
  const ordered = preferred ? [preferred, ...rest] : rest;
  return ordered.map((p) => ({ id: p.id, meters: null }));
}

export function pickOpenGateId(
  ranked: RankedWidgetGate[],
  requestedId: string | null,
): string | null {
  const want = String(requestedId ?? '').trim();
  if (want && ranked.some((r) => r.id === want)) return want;
  return ranked[0]?.id ?? null;
}
