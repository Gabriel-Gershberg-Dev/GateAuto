import { displayGateName, type GateConfig } from '../data/gatesStore';
import { normalizeHoldMs } from '../data/holdNormalize';

export type NativeGeofenceRegion = {
  id: string;
  lat: number;
  lng: number;
  radius: number;
  deviceId?: string;
  /** User-facing label (same as displayName). */
  name?: string;
  /** User display name — native notifications/AA must prefer this over PalGate `name`. */
  displayName?: string;
  cooldownMs?: number;
  holdEnabled?: boolean;
  holdMs?: number;
  btRequired?: boolean;
  btAddresses?: string[];
  btNames?: string[];
  enabled?: boolean;
};

export function nativeRegionFromGate(g: GateConfig): NativeGeofenceRegion {
  const devices = g.bluetooth?.devices ?? [];
  const lat = typeof g.lat === 'number' && Number.isFinite(g.lat) ? g.lat : Number.NaN;
  const lng = typeof g.lng === 'number' && Number.isFinite(g.lng) ? g.lng : Number.NaN;
  const label = displayGateName(g);
  return {
    id: g.id,
    lat,
    lng,
    radius: g.radiusMeters,
    deviceId: String(g.deviceId ?? '').trim(),
    name: label,
    displayName: label,
    cooldownMs: g.cooldownMs > 0 ? g.cooldownMs : 0,
    holdEnabled: Boolean(g.holdEnabled),
    holdMs: normalizeHoldMs(g.holdMs),
    btRequired: Boolean(g.bluetooth?.required),
    btAddresses: devices
      .map((d) => String(d.address ?? '').trim())
      .filter(Boolean),
    btNames: devices.map((d) => String(d.name ?? '').trim()).filter(Boolean),
    enabled: Boolean(g.enabled) && !g.shareDisabled,
  };
}
