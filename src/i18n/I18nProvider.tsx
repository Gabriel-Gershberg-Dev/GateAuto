import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { I18nManager } from 'react-native';
import { readDeviceLanguageTag } from './deviceLocale';
import i18n from './index';
import {
  LANGUAGE_PREF_KEY,
  isRtlLanguage,
  parseLanguagePreference,
  resolveLanguage,
  type AppLanguage,
  type LanguagePreference,
} from './locale';
import { syncRtl } from './rtl';

type I18nContextValue = {
  preference: LanguagePreference;
  language: AppLanguage;
  isRtl: boolean;
  ready: boolean;
  setPreference: (pref: LanguagePreference) => Promise<boolean>;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] =
    useState<LanguagePreference>('system');
  const [language, setLanguage] = useState<AppLanguage>(() => {
    const lng = i18n.language;
    return lng === 'he' || lng === 'ru' ? lng : 'en';
  });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(LANGUAGE_PREF_KEY);
        if (cancelled) return;
        const pref = parseLanguagePreference(raw);
        const next = resolveLanguage(pref, readDeviceLanguageTag());
        setPreferenceState(pref);
        setLanguage(next);
        if (i18n.language !== next) {
          await i18n.changeLanguage(next);
        }
        syncRtl(next);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setPreference = useCallback(async (pref: LanguagePreference) => {
    const next = resolveLanguage(pref, readDeviceLanguageTag());
    setPreferenceState(pref);
    setLanguage(next);
    await AsyncStorage.setItem(LANGUAGE_PREF_KEY, pref);
    if (i18n.language !== next) {
      await i18n.changeLanguage(next);
    }
    return syncRtl(next);
  }, []);

  const isRtl = isRtlLanguage(language) || I18nManager.isRTL;

  const value = useMemo(
    () => ({
      preference,
      language,
      isRtl,
      ready,
      setPreference,
    }),
    [preference, language, isRtl, ready, setPreference],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useAppI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error('useAppI18n must be used within I18nProvider');
  }
  return ctx;
}
