import type { User } from 'firebase/auth';
import { isRealFirebaseAccount } from '../share/inviteLogic';
import { applyCloudVaultToLocal, recoverOwnerVaultOnDevice } from './vaultRecover';
import { currentCloudUid, pullCloudVault, pushCloudVault } from './cloudVault';
import { loadGates } from './gatesStore';
import { listSystems, syncNativeFromSystems } from './palgateSystems';

let cloudPushPaused = 0;
let pushTimer: ReturnType<typeof setTimeout> | null = null;

function providersOf(user: User): string[] {
  return user.providerData.map((p) => p.providerId);
}

export function pauseCloudPush(): void {
  cloudPushPaused += 1;
}

export function resumeCloudPush(): void {
  cloudPushPaused = Math.max(0, cloudPushPaused - 1);
}

async function pushLocalVaultToCloud(uid: string): Promise<void> {
  const [gates, systems] = await Promise.all([loadGates(), listSystems()]);
  await pushCloudVault(uid, { gates, systems });
}

export function scheduleCloudPush(): void {
  if (cloudPushPaused > 0) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    if (cloudPushPaused > 0) return;
    const uid = requireUidIfCloud();
    if (!uid) return;
    void pushLocalVaultToCloud(uid).catch(() => undefined);
  }, 450);
}

function requireUidIfCloud(): string | null {
  return currentCloudUid();
}

/**
 * After login: cloud wins when present; otherwise recover leftover device data
 * and upload. Anonymous guests stay local-only.
 */
export async function hydrateSignedInAccount(user: User): Promise<void> {
  const real = isRealFirebaseAccount({
    isAnonymous: user.isAnonymous,
    providers: providersOf(user),
    email: user.email,
  });
  pauseCloudPush();
  try {
    if (!real) return;

    let cloud;
    try {
      cloud = await pullCloudVault(user.uid);
    } catch {
      cloud = { gates: [], systems: [] };
    }

    if (cloud.gates.length > 0 || cloud.systems.length > 0) {
      await applyCloudVaultToLocal(cloud);
    } else {
      await recoverOwnerVaultOnDevice({
        isRealAccount: true,
        providers: providersOf(user),
      });
      await pushLocalVaultToCloud(user.uid).catch(() => undefined);
    }

    const gates = await loadGates();
    if (gates.length > 0 || (await listSystems()).length > 0) {
      await syncNativeFromSystems();
    }
  } finally {
    resumeCloudPush();
  }
}
