import AsyncStorage from '@react-native-async-storage/async-storage';
import { normalizeWalkingLevel, type WalkingLevel } from './walkingMode';

const KEY = 'gateauto.walking.v1';

export type WalkingSettings = {
  enabled: boolean;
  level: WalkingLevel;
  /** Motion hint. Off leaves Walking in charge. */
  motion: boolean;
};

const DEFAULTS: WalkingSettings = {
  enabled: false,
  level: 'normal',
  motion: false,
};

let cached: WalkingSettings | null = null;

function parse(raw: string | null): WalkingSettings {
  if (!raw) return { ...DEFAULTS };
  try {
    const parsed = JSON.parse(raw) as Partial<WalkingSettings>;
    return {
      enabled: Boolean(parsed.enabled),
      level: normalizeWalkingLevel(parsed.level),
      motion: Boolean(parsed.motion),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function loadWalkingSettings(): Promise<WalkingSettings> {
  if (cached) return cached;
  const raw = await AsyncStorage.getItem(KEY);
  cached = parse(raw);
  return cached;
}

export async function saveWalkingSettings(
  next: Partial<WalkingSettings>,
): Promise<WalkingSettings> {
  const prev = await loadWalkingSettings();
  const settings: WalkingSettings = {
    enabled: next.enabled ?? prev.enabled,
    level: next.level ? normalizeWalkingLevel(next.level) : prev.level,
    motion: next.motion ?? prev.motion,
  };
  cached = settings;
  await AsyncStorage.setItem(KEY, JSON.stringify(settings));
  const { writeNativeWalking } = await import('../platform/keepAliveAlarm');
  await writeNativeWalking(settings.enabled, settings.level, settings.motion);
  return settings;
}
