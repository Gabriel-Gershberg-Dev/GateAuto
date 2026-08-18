/** Client Firebase config. API keys are restricted by package / SHA in Console. */
export const firebaseWebConfig = {
  apiKey: 'AIzaSyCZ3GFYZeZagwHs0HUZnkQ9mVl1jmxsBlE',
  authDomain: 'gateauto-app.firebaseapp.com',
  projectId: 'gateauto-app',
  storageBucket: 'gateauto-app.firebasestorage.app',
  messagingSenderId: '312116795772',
  appId: '1:312116795772:web:7bef8b25c0b4664c90acf9',
};

/** Named Enterprise Firestore database (not `(default)`). */
export const FIRESTORE_DATABASE_ID = 'gateauto';

/**
 * Web OAuth client for Google ID tokens (filled after Auth Google provider
 * deploy if empty — see googleWebClientId).
 */
export const googleWebClientId =
  '312116795772-2ihc48g9hrln7jsr2jo2o96ghoistea5.apps.googleusercontent.com';

export const googleAndroidClientId =
  '312116795772-g1b39g4059kti2bnobd0vi4lh2302e8p.apps.googleusercontent.com';

export const FIREBASE_PROJECT_ID = 'gateauto-app';
export const ANDROID_PACKAGE_NAME = 'com.gateauto.app';
export const ANDROID_SHA1 = '5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25';
