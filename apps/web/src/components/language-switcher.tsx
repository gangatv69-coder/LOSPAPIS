import { useTranslation } from 'react-i18next';

import { fallbackLanguage, isSupportedLanguage, supportedLanguages } from '@/i18n';

/**
 * Selector de idioma: <select> nativo (teclado y lectores de pantalla sin trabajo extra;
 * en el iPad abre el selector del sistema). 48 px de alto. La elección la guarda el detector
 * de i18next en localStorage.
 */
export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const current = i18n.resolvedLanguage ?? fallbackLanguage;

  return (
    <select
      name="language"
      aria-label={t('language.label')}
      value={current}
      onChange={(event) => {
        const next = event.target.value;
        if (isSupportedLanguage(next)) {
          void i18n.changeLanguage(next);
        }
      }}
      className="h-12 rounded-md border border-input bg-card px-3 text-sm text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      {supportedLanguages.map((lng) => (
        <option key={lng} value={lng} lang={lng}>
          {t(`language.${lng}`)}
        </option>
      ))}
    </select>
  );
}
