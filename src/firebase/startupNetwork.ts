/** How long one startup read may sit on a dead socket before we treat it as stuck. */
export const STARTUP_READ_TIMEOUT_MS = 8_000;
/** Pause between automatic retries once the user has been asked to reset mobile data. */
export const STARTUP_RETRY_GAP_MS = 8_000;
/**
 * The opening animation must not run forever when the stuck step is not the
 * network read (sign-in restore, or the gates saved on the phone).
 */
export const SPLASH_ESCAPE_MS = 12_000;

export type StartupNetPhase = 'quiet' | 'refreshing' | 'needsRefresh';
export type StartupStop = 'cancel' | 'continue';

const TIMEOUT = 'startup-network-timeout';

export class StartupAttemptCancelled extends Error {
  constructor() {
    super('cancelled');
    this.name = 'StartupAttemptCancelled';
  }
}

export class StartupContinued extends Error {
  constructor() {
    super('continued');
    this.name = 'StartupContinued';
  }
}

export function isStartupTimeout(error: unknown): boolean {
  return error instanceof Error && error.message === TIMEOUT;
}

export function isStartupStop(error: unknown): boolean {
  return (
    error instanceof StartupAttemptCancelled ||
    error instanceof StartupContinued
  );
}

/**
 * First timeout: refresh immediately and try again.
 * Later timeouts: the in-app refresh was not enough, so ask for a radio reset.
 */
export function phaseAfterStartupFailure(failedAttempts: number): StartupNetPhase {
  return failedAttempts <= 1 ? 'refreshing' : 'needsRefresh';
}

/** Once the splash has waited long enough, always offer a way in. */
export function splashConnection(
  escape: boolean,
  connection: StartupNetPhase,
): StartupNetPhase {
  return escape ? 'needsRefresh' : connection;
}

export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  isStopped?: () => StartupStop | null,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(poll);
      settle();
    };
    const timer = setTimeout(() => {
      finish(() => reject(new Error(TIMEOUT)));
    }, ms);
    const poll = setInterval(() => {
      const stop = isStopped?.() ?? null;
      if (!stop) return;
      finish(() => {
        reject(
          stop === 'continue'
            ? new StartupContinued()
            : new StartupAttemptCancelled(),
        );
      });
    }, 200);
    promise.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });
}

export type StartupGate = {
  isStopped: () => StartupStop | null;
  cancel: () => void;
  continue: () => void;
  kick: () => void;
  wait: (ms: number) => Promise<void>;
};

/** Shared cancel / continue / refresh-now signal for one startup attempt. */
export function createStartupGate(): StartupGate {
  let stop: StartupStop | null = null;
  let wake: (() => void) | null = null;
  let pendingKick = false;

  const signal = (next: StartupStop) => {
    stop = next;
    wake?.();
  };

  return {
    isStopped: () => stop,
    cancel: () => signal('cancel'),
    continue: () => signal('continue'),
    kick: () => {
      if (wake) wake();
      else pendingKick = true;
    },
    wait: (ms: number) =>
      new Promise((resolve) => {
        if (stop || pendingKick) {
          pendingKick = false;
          resolve();
          return;
        }
        const timer = setTimeout(finish, ms);
        function finish() {
          clearTimeout(timer);
          wake = null;
          pendingKick = false;
          resolve();
        }
        wake = finish;
      }),
  };
}

let waived = false;

/** Open with the gates already on the phone. The next sign-in tries the network again. */
export function waiveStartupNetwork(): void {
  waived = true;
}

export function startupNetworkWaived(): boolean {
  return waived;
}

export function resetStartupNetworkWaiver(): void {
  waived = false;
}

function throwIfStopped(isStopped?: () => StartupStop | null): void {
  const stop = isStopped?.() ?? null;
  if (stop === 'cancel') throw new StartupAttemptCancelled();
  if (stop === 'continue') throw new StartupContinued();
}

/**
 * Runs `read` until it finishes. A hung socket refreshes the app connection
 * and tries again. The first failure refreshes immediately. Later failures
 * pause so the splash can ask for a mobile-data toggle, unless Refresh is tapped.
 */
export async function recoverStartupRead<T>(args: {
  read: () => Promise<T>;
  refresh: () => Promise<void>;
  timeoutMs?: number;
  retryGapMs?: number;
  refreshBudgetMs?: number;
  isStopped?: () => StartupStop | null;
  onPhase: (phase: StartupNetPhase) => void;
  wait?: (ms: number) => Promise<void>;
}): Promise<T> {
  const timeoutMs = args.timeoutMs ?? STARTUP_READ_TIMEOUT_MS;
  const retryGapMs = args.retryGapMs ?? STARTUP_RETRY_GAP_MS;
  const refreshBudgetMs = args.refreshBudgetMs ?? 6_000;
  const wait = args.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  let failures = 0;

  for (;;) {
    throwIfStopped(args.isStopped);
    try {
      return await withTimeout(args.read(), timeoutMs, args.isStopped);
    } catch (error) {
      if (isStartupStop(error)) throw error;
      throwIfStopped(args.isStopped);
      if (!isStartupTimeout(error)) throw error;
      failures += 1;
      const phase = phaseAfterStartupFailure(failures);
      args.onPhase(phase);
      try {
        await withTimeout(args.refresh(), refreshBudgetMs, args.isStopped);
      } catch (refreshError) {
        if (isStartupStop(refreshError)) throw refreshError;
      }
      throwIfStopped(args.isStopped);
      if (phase === 'needsRefresh') await wait(retryGapMs);
    }
  }
}
