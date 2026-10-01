import * as Location from 'expo-location';
import { NativeModules } from 'react-native';
import type { AddressHit, PlacePrediction } from './addressSearch';

type PlacesRequest = {
  query?: string;
  placeId?: string;
  session: string;
  lang: string;
  lat?: number;
  lng?: number;
};

type KeepAliveAddresses = {
  searchAddresses?: (query: string) => Promise<AddressHit[]>;
  placesAutocomplete?: (req: PlacesRequest) => Promise<PlacePrediction[]>;
  placeLocation?: (req: PlacesRequest) => Promise<AddressHit>;
};

function native(): KeepAliveAddresses | undefined {
  return NativeModules.GateAutoKeepAlive as KeepAliveAddresses | undefined;
}

/** One token per typing session, closed by the pick's location lookup. */
export function newPlacesSession(): string {
  const rand = () => Math.random().toString(16).slice(2, 10);
  return `${Date.now().toString(16)}-${rand()}-${rand()}`;
}

/**
 * Google Maps-style suggestions while typing: partial words, streets in every
 * city, and places. Null when unavailable so the caller uses the geocoder.
 */
export async function autocompleteAddresses(
  query: string,
  opts: { session: string; lang: string; near?: { lat: number; lng: number } },
): Promise<PlacePrediction[] | null> {
  const q = query.trim();
  if (q.length < 2) return [];
  const mod = native();
  if (!mod?.placesAutocomplete) return null;
  try {
    const rows = await mod.placesAutocomplete({
      query: q,
      session: opts.session,
      lang: opts.lang,
      ...(opts.near ? { lat: opts.near.lat, lng: opts.near.lng } : {}),
    });
    return Array.isArray(rows) ? rows : [];
  } catch {
    return null;
  }
}

export async function placeLocation(
  placeId: string,
  opts: { session: string; lang: string },
): Promise<{ latitude: number; longitude: number } | null> {
  const mod = native();
  if (!mod?.placeLocation) return null;
  try {
    const hit = await mod.placeLocation({ placeId, session: opts.session, lang: opts.lang });
    if (!Number.isFinite(hit?.latitude) || !Number.isFinite(hit?.longitude)) return null;
    return { latitude: hit.latitude, longitude: hit.longitude };
  } catch {
    return null;
  }
}

/**
 * Several labeled matches. Android uses Geocoder directly so a street that
 * exists in more than one city comes back as a list. iOS falls back to the
 * platform geocoder plus a reverse lookup for the label.
 */
export async function lookupAddresses(query: string): Promise<AddressHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const mod = native();
  if (mod?.searchAddresses) {
    const rows = await mod.searchAddresses(q);
    return Array.isArray(rows) ? rows : [];
  }
  const hits = await Location.geocodeAsync(q);
  const labeled = await Promise.all(
    hits.slice(0, 5).map(async (hit) => {
      try {
        const places = await Location.reverseGeocodeAsync({
          latitude: hit.latitude,
          longitude: hit.longitude,
        });
        const place = places[0];
        return {
          latitude: hit.latitude,
          longitude: hit.longitude,
          street: place?.street,
          streetNumber: place?.streetNumber,
          city: place?.city,
          district: place?.district,
          formattedAddress: place?.formattedAddress,
        };
      } catch {
        return { latitude: hit.latitude, longitude: hit.longitude };
      }
    }),
  );
  return labeled;
}
