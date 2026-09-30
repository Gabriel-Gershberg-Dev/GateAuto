import * as Location from 'expo-location';
import { NativeModules } from 'react-native';
import type { AddressHit } from './addressSearch';

type KeepAliveAddresses = {
  searchAddresses?: (query: string) => Promise<AddressHit[]>;
};

/**
 * Several labeled matches. Android uses Geocoder directly so a street that
 * exists in more than one city comes back as a list. iOS falls back to the
 * platform geocoder plus a reverse lookup for the label.
 */
export async function lookupAddresses(query: string): Promise<AddressHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const native = NativeModules.GateAutoKeepAlive as KeepAliveAddresses | undefined;
  if (native?.searchAddresses) {
    const rows = await native.searchAddresses(q);
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
