import type { PalGateCredentials } from '../palgate/types';
import {
  clearAllSystems,
  hasAnySystem,
  loadCredentialsForGate as loadCredsForGate,
  primaryCredentials,
  upsertSystem,
} from './palgateSystems';
import type { GateConfig } from './gatesStore';

export async function saveCredentials(
  credentials: PalGateCredentials,
): Promise<void> {
  await upsertSystem(credentials, { origin: 'linked' });
}

export async function loadCredentials(): Promise<PalGateCredentials | null> {
  return primaryCredentials();
}

export async function loadCredentialsForGate(
  gate: Pick<GateConfig, 'id' | 'systemId' | 'origin'>,
): Promise<PalGateCredentials | null> {
  return loadCredsForGate(gate);
}

export async function clearCredentials(): Promise<void> {
  await clearAllSystems();
}

export async function hasCredentials(): Promise<boolean> {
  return hasAnySystem();
}
