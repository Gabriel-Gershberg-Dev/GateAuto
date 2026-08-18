import {
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  GoogleAuthProvider,
  linkWithCredential,
  onAuthStateChanged,
  signInAnonymously,
  signInWithCredential,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { auth, db } from '../firebase/app';
import { googleWebClientId } from '../firebase/config';
import { configureGoogleSignIn } from './googleNative';
import { isRealFirebaseAccount } from '../share/inviteLogic';

export type AuthUserView = {
  uid: string;
  email: string | null;
  displayName: string | null;
  isAnonymous: boolean;
  isRealAccount: boolean;
  providers: string[];
};

export type UpgradeResult = {
  /** True when we signed into an existing Google/email user instead of linking. */
  switchedAccount: boolean;
};

type AuthContextValue = {
  user: AuthUserView | null;
  firebaseUser: User | null;
  ready: boolean;
  error: string | null;
  signInGuest: () => Promise<void>;
  signUpEmail: (name: string, email: string, password: string) => Promise<void>;
  signInEmail: (email: string, password: string) => Promise<void>;
  signInGoogle: (idToken: string) => Promise<void>;
  upgradeWithEmail: (
    name: string,
    email: string,
    password: string,
  ) => Promise<UpgradeResult>;
  upgradeWithGoogle: (idToken: string) => Promise<UpgradeResult>;
  signOut: () => Promise<void>;
  googleClientConfigured: boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function providersOf(user: User): string[] {
  return user.providerData.map((p) => p.providerId);
}

function isRealUser(user: User): boolean {
  return isRealFirebaseAccount({
    isAnonymous: user.isAnonymous,
    providers: providersOf(user),
    email: user.email,
  });
}

function viewOf(user: User): AuthUserView {
  const providers = providersOf(user);
  const isRealAccount = isRealFirebaseAccount({
    isAnonymous: user.isAnonymous,
    providers,
    email: user.email,
  });
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    isAnonymous: user.isAnonymous && !isRealAccount,
    isRealAccount,
    providers,
  };
}

async function settleUser(user: User): Promise<User> {
  await user.reload();
  await user.getIdToken(true);
  return auth.currentUser ?? user;
}

function displayNameForProfile(user: User, name?: string): string {
  const explicit = name?.trim();
  if (explicit && explicit.toLowerCase() !== 'guest') return explicit.slice(0, 80);
  const existing = user.displayName?.trim() ?? '';
  if (existing && existing.toLowerCase() !== 'guest') return existing.slice(0, 80);
  const local = user.email?.split('@')[0]?.trim();
  if (local) return local.slice(0, 80);
  return isRealUser(user) ? 'Signed in' : 'Guest';
}

function errorCode(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: string }).code)
    : '';
}

function isCredentialTaken(error: unknown): boolean {
  const code = errorCode(error);
  return (
    code === 'auth/credential-already-in-use' ||
    code === 'auth/email-already-in-use' ||
    code === 'auth/account-exists-with-different-credential'
  );
}

function authMessage(error: unknown): string {
  switch (errorCode(error)) {
    case 'auth/email-already-in-use':
      return 'That email already has an account. Sign in instead.';
    case 'auth/invalid-email':
      return 'That email does not look valid.';
    case 'auth/weak-password':
      return 'Use at least 6 characters for the password.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Email or password did not match.';
    case 'auth/credential-already-in-use':
      return 'That Google or email login is already used on another account.';
    case 'auth/network-request-failed':
      return 'Network error. Check the connection and try again.';
    case 'permission-denied':
      return 'Cloud permissions blocked this. Try again after the app updates.';
    default: {
      const message = error instanceof Error ? error.message : 'Sign-in failed.';
      return message.replace(/^Firebase:\s*/i, '').replace(/\s*\(.*\)\s*$/, '');
    }
  }
}

async function persistProfile(user: User, name?: string): Promise<User> {
  const settled = await settleUser(user);
  const displayName = displayNameForProfile(settled, name);
  if (displayName && settled.displayName !== displayName) {
    await updateProfile(settled, { displayName });
    await settled.reload();
  }
  const latest = auth.currentUser ?? settled;
  const ref = doc(db, 'users', latest.uid);
  const existing = await getDoc(ref);
  await setDoc(
    ref,
    {
      displayName: displayName.slice(0, 80),
      emailLower: latest.email ? latest.email.trim().toLowerCase() : null,
      isAnonymous: !isRealUser(latest),
      updatedAt: serverTimestamp(),
      ...(existing.exists() ? {} : { createdAt: serverTimestamp() }),
    },
    { merge: true },
  );
  return auth.currentUser ?? latest;
}

async function linkOrSignInGoogle(
  idToken: string,
): Promise<{ user: User; switchedAccount: boolean }> {
  const credential = GoogleAuthProvider.credential(idToken);
  const current = auth.currentUser;
  if (current && (current.isAnonymous || !isRealUser(current))) {
    try {
      const cred = await linkWithCredential(current, credential);
      return { user: await persistProfile(cred.user), switchedAccount: false };
    } catch (e) {
      if (!isCredentialTaken(e)) throw e;
      const cred = await signInWithCredential(auth, credential);
      return { user: await persistProfile(cred.user), switchedAccount: true };
    }
  }
  const cred = await signInWithCredential(auth, credential);
  return { user: await persistProfile(cred.user), switchedAccount: false };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    configureGoogleSignIn();
    const unsub = onAuthStateChanged(auth, (next) => {
      if (!next) {
        setFirebaseUser(null);
        setReady(true);
        return;
      }
      void (async () => {
        try {
          const settled = await persistProfile(next);
          setFirebaseUser(auth.currentUser ?? settled);
        } catch {
          setFirebaseUser(auth.currentUser ?? next);
        } finally {
          setReady(true);
        }
      })();
    });
    return unsub;
  }, []);

  const googleClientConfigured = !googleWebClientId.includes('placeholder');

  const value = useMemo<AuthContextValue>(
    () => ({
      user: firebaseUser ? viewOf(firebaseUser) : null,
      firebaseUser,
      ready,
      error,
      googleClientConfigured,
      signInGuest: async () => {
        setError(null);
        try {
          const cred = await signInAnonymously(auth);
          setFirebaseUser(await persistProfile(cred.user));
        } catch (e) {
          const message = authMessage(e);
          setError(message);
          throw new Error(message);
        }
      },
      signUpEmail: async (name, email, password) => {
        setError(null);
        const trimmed = name.trim();
        if (!trimmed) throw new Error('Enter your name.');
        try {
          const cred = await createUserWithEmailAndPassword(
            auth,
            email.trim(),
            password,
          );
          setFirebaseUser(await persistProfile(cred.user, trimmed));
        } catch (e) {
          const message = authMessage(e);
          setError(message);
          throw new Error(message);
        }
      },
      signInEmail: async (email, password) => {
        setError(null);
        try {
          const cred = await signInWithEmailAndPassword(
            auth,
            email.trim(),
            password,
          );
          setFirebaseUser(await persistProfile(cred.user));
        } catch (e) {
          const message = authMessage(e);
          setError(message);
          throw new Error(message);
        }
      },
      signInGoogle: async (idToken) => {
        setError(null);
        try {
          const { user } = await linkOrSignInGoogle(idToken);
          setFirebaseUser(user);
        } catch (e) {
          const message = authMessage(e);
          setError(message);
          throw new Error(message);
        }
      },
      upgradeWithEmail: async (name, email, password) => {
        setError(null);
        const current = auth.currentUser;
        if (!current) throw new Error('Sign in first.');
        const trimmed = name.trim();
        if (!trimmed) throw new Error('Enter your name.');
        try {
          const credential = EmailAuthProvider.credential(email.trim(), password);
          try {
            const cred = await linkWithCredential(current, credential);
            setFirebaseUser(await persistProfile(cred.user, trimmed));
            return { switchedAccount: false };
          } catch (e) {
            if (!isCredentialTaken(e)) throw e;
            const cred = await signInWithEmailAndPassword(
              auth,
              email.trim(),
              password,
            );
            setFirebaseUser(await persistProfile(cred.user, trimmed));
            return { switchedAccount: true };
          }
        } catch (e) {
          const message = authMessage(e);
          setError(message);
          throw new Error(message);
        }
      },
      upgradeWithGoogle: async (idToken) => {
        setError(null);
        if (!auth.currentUser) throw new Error('Sign in first.');
        try {
          const { user, switchedAccount } = await linkOrSignInGoogle(idToken);
          setFirebaseUser(user);
          return { switchedAccount };
        } catch (e) {
          const message = authMessage(e);
          setError(message);
          throw new Error(message);
        }
      },
      signOut: async () => {
        setError(null);
        await firebaseSignOut(auth);
      },
    }),
    [error, firebaseUser, googleClientConfigured, ready],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
