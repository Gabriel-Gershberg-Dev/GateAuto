export const APP_LANGUAGES = ['en', 'he', 'ru'] as const;
export type AppLanguage = (typeof APP_LANGUAGES)[number];
export type LanguagePreference = 'system' | AppLanguage;

export const LANGUAGE_PREF_KEY = '@gateauto/languagePreference';

export function isAppLanguage(value: string | null | undefined): value is AppLanguage {
  return value === 'en' || value === 'he' || value === 'ru';
}

export function parseLanguagePreference(raw: string | null): LanguagePreference {
  if (raw === 'system' || isAppLanguage(raw)) return raw;
  return 'system';
}

export function languageFromTag(tag: string | null | undefined): AppLanguage {
  const lower = String(tag ?? 'en')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-');
  if (lower === 'he' || lower.startsWith('he-') || lower === 'iw' || lower.startsWith('iw-')) {
    return 'he';
  }
  if (lower === 'ru' || lower.startsWith('ru-')) return 'ru';
  return 'en';
}

/**
 * Stored picker value → active catalog.
 * `system` follows the device when it is Hebrew or Russian; otherwise English
 * (the current UI) so existing phones do not jump language until chosen.
 */
export function resolveLanguage(
  preference: LanguagePreference,
  deviceTag: string | null | undefined,
): AppLanguage {
  if (isAppLanguage(preference)) return preference;
  return languageFromTag(deviceTag);
}

export function isRtlLanguage(lang: AppLanguage): boolean {
  return lang === 'he';
}
