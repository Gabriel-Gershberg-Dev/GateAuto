export type StreetViewPinSource = 'pano' | 'fallback';

export type StreetViewPin = {
  lat: number;
  lng: number;
  source: StreetViewPinSource;
};

function finiteCoord(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Prefer the Street View panorama the user is looking at. If the camera never
 * reported a position, keep the pin they opened from.
 */
export function resolveStreetViewPin(
  panoLat: number | null | undefined,
  panoLng: number | null | undefined,
  fallbackLat: number,
  fallbackLng: number,
): StreetViewPin {
  if (finiteCoord(panoLat) && finiteCoord(panoLng)) {
    return { lat: panoLat, lng: panoLng, source: 'pano' };
  }
  return { lat: fallbackLat, lng: fallbackLng, source: 'fallback' };
}

export const STREET_VIEW_FALLBACK_HINT =
  'Street camera position wasn’t available — using the pin you opened from.';
