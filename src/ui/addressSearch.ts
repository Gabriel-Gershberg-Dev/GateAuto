const COUNTRIES = new Set(['israel', 'ישראל', 'израиль']);

export type AddressHit = {
  latitude: number;
  longitude: number;
  street?: string | null;
  streetNumber?: string | null;
  city?: string | null;
  district?: string | null;
  formattedAddress?: string | null;
};

export type AddressSuggestion = {
  key: string;
  title: string;
  subtitle: string;
  latitude: number;
  longitude: number;
};

function clean(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function addressParts(formatted: string): string[] {
  return formatted
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !COUNTRIES.has(part.toLowerCase()));
}

/**
 * One row per distinct place. Same street in two cities stays as two rows —
 * the geocoder's first hit is not a choice.
 */
export function addressSuggestions(hits: AddressHit[]): AddressSuggestion[] {
  const out: AddressSuggestion[] = [];
  const seen = new Set<string>();
  for (const hit of hits) {
    if (!Number.isFinite(hit.latitude) || !Number.isFinite(hit.longitude)) continue;
    const street = [clean(hit.streetNumber), clean(hit.street)]
      .filter(Boolean)
      .join(' ');
    const area = clean(hit.city) || clean(hit.district);
    const parts = addressParts(clean(hit.formattedAddress));
    let title = street;
    let subtitle = area && area !== street ? area : '';
    if (!title) {
      title = parts[0] ?? '';
      if (!subtitle) subtitle = parts.slice(1, 3).join(' · ');
    } else if (!subtitle) {
      subtitle = parts.find((part) => part !== title) ?? '';
    }
    if (!title) continue;
    const label = `${title}\n${subtitle}`.toLocaleLowerCase();
    if (seen.has(label)) continue;
    seen.add(label);
    out.push({
      key: `${label}:${hit.latitude.toFixed(4)}:${hit.longitude.toFixed(4)}`,
      title,
      subtitle,
      latitude: hit.latitude,
      longitude: hit.longitude,
    });
  }
  return out;
}
