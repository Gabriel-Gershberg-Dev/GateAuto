import { AppState } from 'react-native';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from '../firebase/app';
import { getNativeAutoOpenLog, setNativeAutoLogAuth } from '../platform/keepAliveAlarm';
import {
  cloudAutoLogLines,
  parseAutoLog,
  type AutoLogLine,
} from './autoOpenLogFormat';

export {
  cloudAutoLogLines,
  formatAutoOpenLog,
  parseAutoLog,
  type AutoLogLine,
} from './autoOpenLogFormat';

export async function readAutoOpenLog(): Promise<AutoLogLine[]> {
  try {
    return parseAutoLog(await getNativeAutoOpenLog());
  } catch {
    return [];
  }
}

export async function syncAutoOpenLog(user: User | null): Promise<void> {
  if (!user) {
    await setNativeAutoLogAuth('', '', 0);
    return;
  }
  const token = await user.getIdTokenResult();
  const exp = new Date(token.expirationTime).getTime();
  await setNativeAutoLogAuth(user.uid, token.token, exp);
  const lines = cloudAutoLogLines(await readAutoOpenLog());
  if (lines.length === 0) return;
  await setDoc(doc(db, 'users', user.uid, 'autoLog', 'recent'), {
    lines,
    updatedAt: serverTimestamp(),
  });
}

/** Refresh the upload token while the signed-in app is in use. */
export function watchAutoOpenLog(user: User): () => void {
  const run = () => {
    void syncAutoOpenLog(user).catch(() => undefined);
  };
  run();
  const sub = AppState.addEventListener('change', (next) => {
    if (next === 'active') run();
  });
  const timer = setInterval(run, 30 * 60 * 1000);
  return () => {
    sub.remove();
    clearInterval(timer);
  };
}
