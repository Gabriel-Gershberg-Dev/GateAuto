import * as SecureStore from 'expo-secure-store';
import { TokenType, type PalGateCredentials } from '../palgate/types';
import { writeNativeCredentials } from '../platform/keepAliveAlarm';

const KEYS = {
  sessionToken: 'gateauto.sessionToken',
  phoneNumber: 'gateauto.phoneNumber',
  tokenType: 'gateauto.tokenType',
} as const;

/** Readable while the phone is locked, after the first unlock since boot. */
const STORE_OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

export async function saveCredentials(credentials: PalGateCredentials): Promise<void> {
  await SecureStore.setItemAsync(KEYS.sessionToken, credentials.sessionToken, STORE_OPTS);
  await SecureStore.setItemAsync(KEYS.phoneNumber, String(credentials.phoneNumber), STORE_OPTS);
  await SecureStore.setItemAsync(KEYS.tokenType, String(credentials.tokenType), STORE_OPTS);
  await writeNativeCredentials(credentials);
}

export async function loadCredentials(): Promise<PalGateCredentials | null> {
  const [sessionToken, phoneRaw, typeRaw] = await Promise.all([
    SecureStore.getItemAsync(KEYS.sessionToken, STORE_OPTS),
    SecureStore.getItemAsync(KEYS.phoneNumber, STORE_OPTS),
    SecureStore.getItemAsync(KEYS.tokenType, STORE_OPTS),
  ]);

  if (!sessionToken || !phoneRaw || typeRaw === null) {
    return null;
  }

  const phoneNumber = Number(phoneRaw);
  const tokenType = Number(typeRaw) as TokenType;
  if (!Number.isFinite(phoneNumber)) return null;
  if (
    tokenType !== TokenType.SMS &&
    tokenType !== TokenType.PRIMARY &&
    tokenType !== TokenType.SECONDARY
  ) {
    return null;
  }

  return { sessionToken, phoneNumber, tokenType };
}

export async function clearCredentials(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(KEYS.sessionToken, STORE_OPTS),
    SecureStore.deleteItemAsync(KEYS.phoneNumber, STORE_OPTS),
    SecureStore.deleteItemAsync(KEYS.tokenType, STORE_OPTS),
  ]);
  await writeNativeCredentials(null);
}

export async function hasCredentials(): Promise<boolean> {
  return (await loadCredentials()) !== null;
}
