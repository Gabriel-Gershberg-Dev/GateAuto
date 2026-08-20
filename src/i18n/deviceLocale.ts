import { languageFromTag } from './locale';

/** Sync device tag. Safe in Node tests (no expo-localization). */
export function readDeviceLanguageTag(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Localization = require('expo-localization') as {
      getLocales?: () => Array<{ languageTag?: string; languageCode?: string }>;
    };
    const loc = Localization.getLocales?.()[0];
    return loc?.languageTag || loc?.languageCode || 'en';
  } catch {
    return 'en';
  }
}

export function readDeviceLanguage() {
  return languageFromTag(readDeviceLanguageTag());
}
