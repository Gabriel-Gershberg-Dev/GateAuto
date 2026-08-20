import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { readDeviceLanguageTag } from './deviceLocale';
import { resolveLanguage } from './locale';
import en from './locales/en.json';
import he from './locales/he.json';
import ru from './locales/ru.json';

const initialLanguage = resolveLanguage('system', readDeviceLanguageTag());

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    he: { translation: he },
    ru: { translation: ru },
  },
  lng: initialLanguage,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;
