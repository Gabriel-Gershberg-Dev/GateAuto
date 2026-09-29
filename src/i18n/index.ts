import i18n, { type PostProcessorModule } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { withRtlMark } from './bidi';
import { readDeviceLanguageTag } from './deviceLocale';
import { isRtlLanguage, resolveLanguage, type AppLanguage } from './locale';
import en from './locales/en.json';
import he from './locales/he.json';
import ru from './locales/ru.json';

const initialLanguage = resolveLanguage('system', readDeviceLanguageTag());

const rtlMark: PostProcessorModule = {
  type: 'postProcessor',
  name: 'rtlMark',
  process(value, _key, _options, translator: { language?: string } | undefined) {
    const lng = translator?.language as AppLanguage | undefined;
    return typeof value === 'string' && lng && isRtlLanguage(lng)
      ? withRtlMark(value)
      : value;
  },
};

void i18n.use(rtlMark).use(initReactI18next).init({
  resources: {
    en: { translation: en },
    he: { translation: he },
    ru: { translation: ru },
  },
  lng: initialLanguage,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
  postProcess: ['rtlMark'],
});

export default i18n;
