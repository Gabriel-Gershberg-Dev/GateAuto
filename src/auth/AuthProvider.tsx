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
import { isRealFirebaseAccount } from '../share/inviteLogic';

export type AuthUserView = {
  uid: string;
  email: string | null;
  displayName: string | null;
  isAnonymous: boolean;
  isRealAccount: boolean;
  providers: string[];
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
  ) => Promise<void>;
  upgradeWithGoogle: (idToken: string) => Promise<void>;
  signOut: () => Promise<void>;
  googleClientConfigured: boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function viewOf(user: User): AuthUserView {
  const providers = user.providerData.map((p) => p.providerId);
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    isAnonymous: user.isAnonymous,
    isRealAccount: isRealFirebaseAccount({
      isAnonymous: user.isAnonymous,
      providers,
    }),
    providers,
  };
}

function authMessage(error: unknown): string {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: string }).code)
      : '';
  switch (code) {
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
    default: {
      const message = error instanceof Error ? error.message : 'Sign-in failed.';
      return message.replace(/^Firebase:\s*/i, '').replace(/\s*\(.*\)\s*$/, '');
    }
  }
}

async function upsertProfile(user: User, name?: string): Promise<void> {
  const displayName =
    name?.trim() || user.displayName?.trim() || (user.isAnonymous ? 'Guest' : '');
  if (displayName && user.displayName !== displayName) {
    await updateProfile(user, { displayName });
  }
  const ref = doc(db, 'users', user.uid);
  const existing = await getDoc(ref);
  await setDoc(
    ref,
    {
      displayName: (displayName || 'Guest').slice(0, 80),
      emailLower: user.email ? user.email.trim().toLowerCase() : null,
      isAnonymous: user.isAnonymous,
      updatedAt: serverTimestamp(),
      ...(existing.exists() ? {} : { createdAt: serverTimestamp() }),
    },
    { merge: true },
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (next) => {
      setFirebaseUser(next);
      setReady(true);
      if (next) {
        void upsertProfile(next).catch(() => undefined);
      }
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
          await upsertProfile(cred.user);
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
          await upsertProfile(cred.user, trimmed);
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
          await upsertProfile(cred.user);
        } catch (e) {
          const message = authMessage(e);
          setError(message);
          throw new Error(message);
        }
      },
      signInGoogle: async (idToken) => {
        setError(null);
        try {
          const credential = GoogleAuthProvider.credential(idToken);
          const cred = await signInWithCredential(auth, credential);
          await upsertProfile(cred.user);
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
          const cred = await linkWithCredential(current, credential);
          await upsertProfile(cred.user, trimmed);
        } catch (e) {
          const message = authMessage(e);
          setError(message);
          throw new Error(message);
        }
      },
      upgradeWithGoogle: async (idToken) => {
        setError(null);
        const current = auth.currentUser;
        if (!current) throw new Error('Sign in first.');
        try {
          const credential = GoogleAuthProvider.credential(idToken);
          const cred = await linkWithCredential(current, credential);
          await upsertProfile(cred.user);
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
