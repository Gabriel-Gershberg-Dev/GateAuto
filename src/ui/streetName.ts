export type StreetPlace = {
  formattedAddress?: string | null;
  streetNumber?: string | null;
  street?: string | null;
  name?: string | null;
  district?: string | null;
  city?: string | null;
  subregion?: string | null;
};

/** Compact roadside plate: street · area. Empty when nothing useful is known. */
export function formatStreetName(place: StreetPlace): string {
  const street = [place.streetNumber, place.street]
    .filter((part) => Boolean(part && String(part).trim()))
    .join(' ')
    .trim();
  const area = (place.district || place.city || place.subregion || '').trim();
  if (street && area && street !== area) return `${street} · ${area}`;
  if (street) return street;

  const name = (place.name || '').trim();
  const city = (place.city || '').trim();
  if (name && city && name !== city) return `${name} · ${city}`;
  if (name) return name;

  const formatted = (place.formattedAddress || '').trim();
  if (formatted) {
    return formatted
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .slice(0, 2)
      .join(' · ');
  }
  return city;
}

export function formatCoordPair(lat: number, lng: number): string {
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}
