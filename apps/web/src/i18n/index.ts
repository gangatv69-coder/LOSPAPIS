import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';

import es from '../locales/es.json';
import it from '../locales/it.json';

export const supportedLanguages = ['es', 'it'] as const;
export type SupportedLanguage = (typeof supportedLanguages)[number];
export const fallbackLanguage: SupportedLanguage = 'es';
export const defaultNS = 'translation';

/** Clave de localStorage donde el detector guarda el idioma elegido. */
export const languageStorageKey = 'i18nextLng';

export const resources = {
  es: { translation: es },
  it: { translation: it },
} as const;

export function isSupportedLanguage(value: string): value is SupportedLanguage {
  return (supportedLanguages as readonly string[]).includes(value);
}

// Mantiene <html lang> (y dir) sincronizados con el idioma activo.
// Se registra ANTES de init() porque init() ya emite 'languageChanged'.
// resolvedLanguage (es | it) por defensa: si algún día se activara load: 'languageOnly'
// o nonExplicitSupportedLngs, el evento recibiría "it-IT".
i18n.on('languageChanged', (lng) => {
  if (typeof document === 'undefined') return;
  const active = i18n.resolvedLanguage ?? lng;
  document.documentElement.lang = active;
  document.documentElement.dir = i18n.dir(active);
});

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    defaultNS,
    // Un "it-IT" del navegador se resuelve a "it" por supportedLngs.
    supportedLngs: supportedLanguages,
    fallbackLng: fallbackLanguage,
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: languageStorageKey,
    },
    interpolation: {
      // React ya escapa los valores; i18next no debe volver a escaparlos.
      escapeValue: false,
    },
    // Una clave sin traducción nunca devuelve null: t() siempre es string.
    returnNull: false,
    debug: import.meta.env.DEV && import.meta.env.MODE !== 'test',
  });

export default i18n;
