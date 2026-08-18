import {
  GoogleSignin,
  isCancelledResponse,
  isErrorWithCode,
  isSuccessResponse,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import { googleWebClientId } from '../firebase/config';

let configured = false;

/** Native Play Services Google Sign-In — ID token for Firebase Auth. */
export function configureGoogleSignIn(): void {
  if (configured) return;
  GoogleSignin.configure({
    webClientId: googleWebClientId,
    scopes: ['email', 'profile'],
    offlineAccess: false,
  });
  configured = true;
}

function googleMessage(error: unknown): string {
  if (isErrorWithCode(error)) {
    if (error.code === statusCodes.SIGN_IN_CANCELLED) {
      return '';
    }
    if (error.code === statusCodes.IN_PROGRESS) {
      return 'Google sign-in is already in progress.';
    }
    if (error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
      return 'Google Play services is required for Google sign-in.';
    }
    if (error.code === '10' || error.code === 'DEVELOPER_ERROR') {
      return 'Google sign-in is misconfigured (package SHA-1 / OAuth client).';
    }
  }
  return error instanceof Error ? error.message : 'Google sign-in failed.';
}

/**
 * Native account picker (not Chrome Custom Tabs).
 * Returns an ID token, or null if the user cancelled.
 */
export async function promptGoogleIdToken(): Promise<string | null> {
  configureGoogleSignIn();
  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const response = await GoogleSignin.signIn();
    if (isCancelledResponse(response)) return null;
    if (!isSuccessResponse(response)) {
      throw new Error('Google sign-in did not complete.');
    }
    const idToken = response.data.idToken;
    if (!idToken) {
      throw new Error('Google sign-in did not return a token.');
    }
    return idToken;
  } catch (error) {
    if (isErrorWithCode(error) && error.code === statusCodes.SIGN_IN_CANCELLED) {
      return null;
    }
    const message = googleMessage(error);
    throw new Error(message || 'Google sign-in failed.');
  }
}

/** Native Google session — never await this from sign-out. */
export function signOutGoogleQuietly(): void {
  void Promise.race([
    GoogleSignin.signOut().then(() => undefined),
    new Promise<void>((resolve) => {
      setTimeout(resolve, 800);
    }),
  ]).catch(() => undefined);
}
