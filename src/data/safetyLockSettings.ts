import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  clampBurstCount,
  clampLockMinutes,
  DEFAULT_BURST_COUNT,
  DEFAULT_GATE_LOCK_MINUTES,
  lockMsFromMinutes,
} from './safetyBurst';

const SETTINGS_KEY = 'gateauto.safetyLockSettings';

export type SafetyLockSettings = {
  burstCount: number;
  lockMinutes: number;
};

const DEFAULTS: SafetyLockSettings = {
  burstCount: DEFAULT_BURST_COUNT,
  lockMinutes: DEFAULT_GATE_LOCK_MINUTES,
};

let cached: SafetyLockSettings | null = null;
let writeChain: Promise<void> = Promise.resolve();

export function clampSafetyLockSettings(
  raw: Partial<SafetyLockSettings> | null | undefined,
): SafetyLockSettings {
  return {
    burstCount: clampBurstCount(raw?.burstCount ?? DEFAULT_BURST_COUNT),
    lockMinutes: clampLockMinutes(raw?.lockMinutes ?? DEFAULT_GATE_LOCK_MINUTES),
  };
}

function parseSettings(raw: string | null): SafetyLockSettings {
  if (!raw) return { ...DEFAULTS };
  try {
    const parsed = JSON.parse(raw) as Partial<SafetyLockSettings>;
    return clampSafetyLockSettings(parsed);
  } catch {
    return { ...DEFAULTS };
  }
}

export async function loadSafetyLockSettings(): Promise<SafetyLockSettings> {
  if (cached) return cached;
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    cached = parseSettings(raw);
  } catch {
    cached = { ...DEFAULTS };
  }
  return cached;
}

async function writeNative(settings: SafetyLockSettings): Promise<void> {
  try {
    const { writeNativeSafetyLockSettings } = await import(
      '../platform/keepAliveAlarm'
    );
    await writeNativeSafetyLockSettings(
      settings.burstCount,
      lockMsFromMinutes(settings.lockMinutes),
    );
  } catch {
    // Expo Go / missing native module
  }
}

export async function saveSafetyLockSettings(
  next: Partial<SafetyLockSettings>,
): Promise<SafetyLockSettings> {
  const settings = clampSafetyLockSettings({
    ...(cached ?? DEFAULTS),
    ...next,
  });
  cached = settings;
  const run = writeChain.then(async () => {
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    await writeNative(settings);
  });
  writeChain = run.then(
    () => undefined,
    () => undefined,
  );
  await run;
  return settings;
}

/** Push JS settings into KeepAlivePrefs so locked/background auto-open matches. */
export async function hydrateSafetyLockSettingsToNative(): Promise<void> {
  const settings = await loadSafetyLockSettings();
  await writeNative(settings);
}

export function burstConfigFromSettings(settings: SafetyLockSettings): {
  burstCount: number;
  lockMs: number;
} {
  return {
    burstCount: settings.burstCount,
    lockMs: lockMsFromMinutes(settings.lockMinutes),
  };
}
