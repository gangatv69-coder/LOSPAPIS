import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import { TricolorStripe } from '@/components/brand/tricolor-stripe';
import { Wordmark } from '@/components/brand/wordmark';
import { LanguageSwitcher } from '@/components/language-switcher';
import { ThemeToggle } from '@/components/theme-toggle';

/** Pestañas de la cabecera. `to` está tipado por el registro del router: la ruta tiene que existir. */
const tabs = [
  { to: '/caja', key: 'nav.register' },
  { to: '/cierre', key: 'nav.close' },
  { to: '/panel', key: 'nav.dashboard' },
  { to: '/ajustes', key: 'nav.settings' },
] as const;

const focusRing = 'outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50';

/**
 * Cabecera de la maqueta: marca, pestañas en píldora (activa = clara en oscuro, amarilla en claro),
 * selector de idioma, botón de tema y, debajo, la franja tricolor.
 */
export function AppHeader() {
  const { t } = useTranslation();

  return (
    <header className="sticky top-0 z-10 bg-background">
      <a
        href="#main"
        className={`sr-only rounded-md bg-card px-3 py-2 font-medium focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-20 ${focusRing}`}
      >
        {t('nav.skipToContent')}
      </a>
      <div className="mx-auto flex min-h-20 w-full max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2 sm:px-6">
        <Link to="/" className={`shrink-0 rounded-md ${focusRing}`}>
          <Wordmark />
        </Link>
        <nav
          aria-label={t('nav.label')}
          className="flex items-center gap-1 overflow-x-auto rounded-xl bg-card p-1"
        >
          {tabs.map((tab) => (
            <Link
              key={tab.to}
              to={tab.to}
              className={`inline-flex h-12 shrink-0 items-center rounded-lg px-4 font-medium text-muted-foreground transition-colors hover:text-foreground data-[status=active]:bg-primary data-[status=active]:text-primary-foreground dark:data-[status=active]:bg-foreground dark:data-[status=active]:text-background ${focusRing}`}
            >
              {t(tab.key)}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
      </div>
      <TricolorStripe />
    </header>
  );
}
