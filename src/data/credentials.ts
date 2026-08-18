import * as SecureStore from 'expo-secure-store';
import { TokenType, type PalGateCredentials } from '../palgate/types';
import {
  clearAllSystems,
  hasAnySystem,
  loadCredentialsForGate as loadCredsForGate,
  primaryCredentials,
  upsertSystem,
} from './palgateSystems';
import type { GateConfig } from './gatesStore';

const KEYS = {
  sessionToken: 'gateauto.sessionToken',
  phoneNumber: 'gateauto.phoneNumber',
  tokenType: 'gateauto.tokenType',
} as const;

/** Readable while the phone is locked, after the first unlock since boot. */
const STORE_OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

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
  if (await hasAnySystem()) return true;
  const [sessionToken, phoneRaw, typeRaw] = await Promise.all([
    SecureStore.getItemAsync(KEYS.sessionToken, STORE_OPTS),
    SecureStore.getItemAsync(KEYS.phoneNumber, STORE_OPTS),
    SecureStore.getItemAsync(KEYS.tokenType, STORE_OPTS),
  ]);
  if (!sessionToken || !phoneRaw || typeRaw === null) return false;
  const phoneNumber = Number(phoneRaw);
  const tokenType = Number(typeRaw) as TokenType;
  if (!Number.isFinite(phoneNumber)) return false;
  return (
    tokenType === TokenType.SMS ||
    tokenType === TokenType.PRIMARY ||
    tokenType === TokenType.SECONDARY
  );
}
