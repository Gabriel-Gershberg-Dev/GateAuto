/** Stable non-secret gate label. PalGate deviceId is hashed, never sent raw. */
export function hashGateId(raw: string | null | undefined): string {
  const s = String(raw ?? '').trim();
  if (!s) return 'g_unknown';
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `g_${(h >>> 0).toString(16).padStart(8, '0')}`;
}

export function clampInt(
  value: number | null | undefined,
  min = 0,
  max = 1_000_000,
): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.max(min, Math.min(max, Math.round(value)));
}

export function flag01(value: boolean | number | null | undefined): 0 | 1 {
  return value ? 1 : 0;
}

const BLOCKED_PARAM = /^(lat|lng|lon|longitude|latitude|email|token|pin|password|mac|deviceid|device_id|invite)/i;

/** Drop anything that looks like a coordinate, secret, or identifier. */
export function sanitizeParams(
  input: Record<string, string | number | undefined>,
): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  const keys = Object.keys(input);
  for (let i = 0; i < keys.length && Object.keys(out).length < 25; i++) {
    const key = keys[i];
    if (!key || BLOCKED_PARAM.test(key)) continue;
    const value = input[key];
    if (value === undefined) continue;
    if (typeof value === 'string') {
      const trimmed = value.slice(0, 100);
      if (!trimmed) continue;
      out[key] = trimmed;
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      out[key] = value;
    }
  }
  return out;
}
