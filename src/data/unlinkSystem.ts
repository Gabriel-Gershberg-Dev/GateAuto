import { loadGates, removeGates } from './gatesStore';
import {
  getSystem,
  listLinkedSystems,
  removeSystem,
} from './palgateSystems';
import { tryStopGeofencing, trySyncGeofences } from '../integrations/optionalNative';

/**
 * Owner unlinks one QR-scanned PalGate. Shared-in systems stay.
 * Outgoing invites for that PalGate are revoked so recipients disable copies.
 */
export async function unlinkLinkedSystem(systemId: string): Promise<void> {
  const sys = await getSystem(systemId);
  if (!sys || sys.origin !== 'linked') return;

  const linked = await listLinkedSystems();
  const gates = await loadGates();
  const deviceIds = gates
    .filter(
      (g) =>
        g.origin !== 'shared' &&
        (g.systemId === sys.id || (!g.systemId && linked.length === 1)),
    )
    .map((g) => g.deviceId);

  try {
    const { revokeOutgoingInvitesForSystem } = await import('../share/invites');
    await revokeOutgoingInvitesForSystem({
      sessionToken: sys.credentials.sessionToken,
      phoneNumber: sys.credentials.phoneNumber,
      deviceIds,
    });
  } catch {
    // Revoke is best-effort when signed out / offline.
  }

  const dropIds = gates
    .filter(
      (g) =>
        g.origin !== 'shared' &&
        (g.systemId === sys.id || (!g.systemId && linked.length === 1)),
    )
    .map((g) => g.id);
  if (dropIds.length > 0) await removeGates(dropIds);
  await removeSystem(sys.id);

  const remaining = await loadGates();
  const stillLinked = await listLinkedSystems();
  if (remaining.length === 0 && stillLinked.length === 0) {
    await tryStopGeofencing();
  } else {
    await trySyncGeofences();
  }
}
