import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth, initializeAuth, type Auth, type Persistence } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { FIRESTORE_DATABASE_ID, firebaseWebConfig } from './config';

const STORAGE_AVAILABLE_KEY = 'firebase-heartbeat-storage-available';

/** AsyncStorage persistence — Firebase web types omit the RN helper. */
function reactNativePersistence(): Persistence {
  return class {
    static type = 'LOCAL' as const;
    async _isAvailable(): Promise<boolean> {
      try {
        await AsyncStorage.setItem(STORAGE_AVAILABLE_KEY, '1');
        await AsyncStorage.removeItem(STORAGE_AVAILABLE_KEY);
        return true;
      } catch {
        return false;
      }
    }
    _set(key: string, value: unknown): Promise<void> {
      return AsyncStorage.setItem(key, JSON.stringify(value));
    }
    async _get<T>(key: string): Promise<T | null> {
      const json = await AsyncStorage.getItem(key);
      return json ? (JSON.parse(json) as T) : null;
    }
    _remove(key: string): Promise<void> {
      return AsyncStorage.removeItem(key);
    }
    _addListener(_key: string, _listener: () => void): void {}
    _removeListener(_key: string, _listener: () => void): void {}
  } as unknown as Persistence;
}

function ensureApp() {
  return getApps().length > 0 ? getApp() : initializeApp(firebaseWebConfig);
}

function ensureAuth(app: ReturnType<typeof ensureApp>): Auth {
  try {
    return initializeAuth(app, {
      persistence: reactNativePersistence(),
    });
  } catch {
    return getAuth(app);
  }
}

const app = ensureApp();
export const firebaseApp = app;
export const auth: Auth = ensureAuth(app);
export const db: Firestore = getFirestore(app, FIRESTORE_DATABASE_ID);
