import { I18nManager, Platform } from 'react-native';
import { isRtlLanguage, type AppLanguage } from './locale';

/** Align I18nManager with Hebrew. Returns true if a reopen may be needed. */
export function syncRtl(lang: AppLanguage): boolean {
  const wantRtl = isRtlLanguage(lang);
  I18nManager.allowRTL(true);
  if (I18nManager.isRTL === wantRtl) return false;
  I18nManager.forceRTL(wantRtl);
  return Platform.OS !== 'web';
}
