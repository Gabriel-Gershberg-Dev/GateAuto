import Constants from 'expo-constants';

type Extra = {
  firebaseWebApiKey?: string;
};

function extra(): Extra {
  return (Constants.expoConfig?.extra ?? {}) as Extra;
}

function firebaseWebApiKey(): string {
  const fromExtra = String(extra().firebaseWebApiKey ?? '').trim();
  if (fromExtra) return fromExtra;
  return String(process.env.FIREBASE_WEB_API_KEY ?? '').trim();
}

/**
 * JS Firebase client config. The API key is a project identifier (not a
 * server secret). Load it from env / app extra — do not commit the key.
 * Authorization is Auth + Firestore rules. The Android key is restricted
 * to `com.gateauto.app` + the upload SHA-1 in Google Cloud.
 */
export const firebaseWebConfig = {
  apiKey: firebaseWebApiKey(),
  authDomain: 'gateauto-app.firebaseapp.com',
  projectId: 'gateauto-app',
  storageBucket: 'gateauto-app.firebasestorage.app',
  messagingSenderId: '312116795772',
  appId: '1:312116795772:web:7bef8b25c0b4664c90acf9',
};

/** Named Enterprise Firestore database (not `(default)`). */
export const FIRESTORE_DATABASE_ID = 'gateauto';

/**
 * Web OAuth client — required as `webClientId` for native Google Sign-In
 * ID tokens (Firebase Auth). Do not pass the Android client ID here.
 */
export const googleWebClientId =
  '312116795772-2ihc48g9hrln7jsr2jo2o96ghoistea5.apps.googleusercontent.com';

/** Android OAuth client in google-services.json (package + SHA-1). */
export const googleAndroidClientId =
  '312116795772-g1b39g4059kti2bnobd0vi4lh2302e8p.apps.googleusercontent.com';

export const FIREBASE_PROJECT_ID = 'gateauto-app';
export const ANDROID_PACKAGE_NAME = 'com.gateauto.app';
export const ANDROID_SHA1 = '5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25';
