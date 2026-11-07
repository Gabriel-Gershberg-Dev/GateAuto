export type AutoLogLine = {
  t: number;
  v: string;
  kind: string;
  source: string;
  reason: string;
  gate: string;
  name?: string;
  distanceM?: number;
  radiusM?: number;
  walking: number;
  warm: number;
  battery: number;
  car?: string;
  gps?: string;
  hold?: number;
  loc?: number;
};

const KINDS = new Set(['open', 'fail', 'skip', 'boot', 'alarm', 'car', 'stream']);

export function parseAutoLog(raw: string): AutoLogLine[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const lines: AutoLogLine[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const kind = String(row.kind ?? '');
    if (!KINDS.has(kind)) continue;
    const t = Number(row.t);
    if (!Number.isFinite(t)) continue;
    const line: AutoLogLine = {
      t,
      v: String(row.v ?? ''),
      kind,
      source: String(row.source ?? ''),
      reason: String(row.reason ?? ''),
      gate: String(row.gate ?? ''),
      walking: Number(row.walking) ? 1 : 0,
      warm: Number(row.warm) ? 1 : 0,
      battery: Number(row.battery) ? 1 : 0,
    };
    if (typeof row.name === 'string' && row.name.trim()) line.name = row.name.trim();
    if (Number.isFinite(Number(row.distanceM))) line.distanceM = Number(row.distanceM);
    if (Number.isFinite(Number(row.radiusM))) line.radiusM = Number(row.radiusM);
    if (typeof row.car === 'string' && row.car) line.car = row.car;
    if (typeof row.gps === 'string' && row.gps) line.gps = row.gps;
    if (row.hold != null) line.hold = Number(row.hold) ? 1 : 0;
    if (row.loc != null) line.loc = Number(row.loc) ? 1 : 0;
    lines.push(line);
  }
  return lines.slice(-300);
}

/** Cloud copy drops the gate display name. */
export function cloudAutoLogLines(lines: AutoLogLine[]): Omit<AutoLogLine, 'name'>[] {
  return lines.map((line) => {
    const { name: _name, ...rest } = line;
    return rest;
  });
}

export function formatAutoOpenLog(lines: AutoLogLine[]): string {
  if (lines.length === 0) return 'No auto-open checks yet.';
  return lines
    .map((line) => {
      const when = new Date(line.t).toISOString();
      const who = line.name || line.gate || '—';
      const dist =
        line.distanceM == null ? '' : ` ${line.distanceM}m/${line.radiusM ?? '—'}m`;
      const why = line.reason ? ` ${line.reason}` : '';
      const car = line.car ? ` car=${line.car}` : '';
      const gps = line.gps ? ` gps=${line.gps}` : '';
      const hold = line.hold == null ? '' : ` hold=${line.hold}`;
      const loc = line.loc == null ? '' : ` loc=${line.loc}`;
      return `${when} ${line.kind} ${line.source}${why} ${who}${dist}${car}${gps}${hold}${loc} walk=${line.walking} warm=${line.warm} batt=${line.battery} ${line.v}`;
    })
    .join('\n');
}
