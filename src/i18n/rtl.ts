import { I18nManager, Platform } from 'react-native';
import { readDeviceLanguageTag } from './deviceLocale';
import {
  isRtlLanguage,
  resolveLanguage,
  type AppLanguage,
  type LanguagePreference,
} from './locale';

/** Align I18nManager with Hebrew. Returns true if a reopen may be needed. */
export function syncRtl(lang: AppLanguage): boolean {
  const wantRtl = isRtlLanguage(lang);
  I18nManager.allowRTL(true);
  if (I18nManager.isRTL === wantRtl) return false;
  I18nManager.forceRTL(wantRtl);
  return Platform.OS !== 'web';
}

/**
 * True when adopting `pref` crosses the LTR↔RTL boundary versus the direction
 * the app is laid out in right now. Only these switches need a full reload;
 * same-direction switches (e.g. English↔Russian) apply live.
 */
export function preferenceFlipsDirection(pref: LanguagePreference): boolean {
  if (Platform.OS === 'web') return false;
  const target = resolveLanguage(pref, readDeviceLanguageTag());
  return isRtlLanguage(target) !== I18nManager.isRTL;
}
