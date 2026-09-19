import type { LogEvent } from '../data/eventLog';
import { mapLogEvent } from './mapLogEvent';

/**
 * Fire-and-forget Analytics from an in-app log row. Native-imported rows
 * pass skipTelemetry so we do not double-count.
 */
export function reportFromLogEvent(event: LogEvent): void {
  const mapped = mapLogEvent(event);
  if (!mapped) return;
  void (async () => {
    let next = mapped;
    if (event.gateId && (next.radiusM == null || next.type === 'auto_open')) {
      try {
        const { loadGates } = await import('../data/gatesStore');
        const gates = await loadGates();
        const gate = gates.find((g) => g.id === event.gateId);
        if (gate) {
          next = {
            ...next,
            radiusM: next.radiusM ?? gate.radiusMeters,
            ...(next.type === 'auto_open'
              ? { btRequired: Boolean(gate.bluetooth?.required) }
              : {}),
          };
        }
      } catch {
        // Best-effort enrich; still send the event.
      }
    }
    const native = await import('./native');
    native.emitMapped(next);
  })().catch(() => undefined);
}
