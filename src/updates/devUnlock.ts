import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import {
  DEV_UNLOCK_HASH,
  DEV_UNLOCK_SALT,
  hashesEqual,
} from './unlockLogic';

const UNLOCK_KEY = 'gateauto.devOptions.unlocked';

export async function loadDevOptionsUnlocked(): Promise<boolean> {
  const value = await AsyncStorage.getItem(UNLOCK_KEY);
  return value === '1';
}

export async function setDevOptionsUnlocked(on: boolean): Promise<void> {
  if (on) {
    await AsyncStorage.setItem(UNLOCK_KEY, '1');
    return;
  }
  await AsyncStorage.removeItem(UNLOCK_KEY);
}

export async function verifyDevUnlockPassword(password: string): Promise<boolean> {
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    DEV_UNLOCK_SALT + password,
  );
  return hashesEqual(digest, DEV_UNLOCK_HASH);
}
