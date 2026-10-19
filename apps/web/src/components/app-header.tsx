import type { AuthState } from '@los-papis/shared';
import { Link } from '@tanstack/react-router';
import { Lock, LogOut } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { TricolorStripe } from '@/components/brand/tricolor-stripe';
import { Wordmark } from '@/components/brand/wordmark';
import { LanguageSwitcher } from '@/components/language-switcher';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';

/** Pestañas de la cabecera. `to` está tipado por el registro del router: la ruta tiene que existir. */
const tabs = [
  { to: '/caja', key: 'nav.register' },
  { to: '/cierre', key: 'nav.close' },
  { to: '/panel', key: 'nav.dashboard' },
  { to: '/ajustes', key: 'nav.settings' },
] as const;

const focusRing = 'outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50';

export type AppHeaderProps = {
  /** Estado de acceso (GET /api/auth/me): usuario con "Salir" o nombre del dispositivo de caja. */
  auth?: AuthState | null;
  /** Falso en /acceso y /configurar: sin sesión no hay a dónde ir. */
  showTabs?: boolean;
  onLogout?: () => void;
  loggingOut?: boolean;
};

/**
 * Cabecera de la maqueta: marca, pestañas en píldora (activa = clara en oscuro, amarilla en claro),
 * quién está dentro (o qué dispositivo es), selector de idioma, botón de tema y, debajo, la franja tricolor.
 */
export function AppHeader({
  auth = null,
  showTabs = true,
  onLogout,
  loggingOut = false,
}: AppHeaderProps) {
  const { t } = useTranslation();
  const user = auth?.user ?? null;
  const device = auth?.device ?? null;

  return (
    // Relleno superior = zona segura: en la app instalada en iOS (barra de estado translúcida) el
    // contenido llega hasta el borde y este relleno deja el reloj fuera de la cabecera. En el navegador vale 0.
    <header className="sticky top-0 z-10 bg-background pt-[env(safe-area-inset-top)]">
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
        {showTabs ? (
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
        ) : null}
        <div className="ml-auto flex items-center gap-3">
          {user && !auth?.pendingTotp ? (
            <span data-testid="header-user" className="hidden flex-col leading-tight sm:flex">
              <span className="font-medium">{user.displayName}</span>
              <span className="text-xs text-muted-foreground">{t(`auth.role.${user.role}`)}</span>
            </span>
          ) : device ? (
            <span
              data-testid="header-device"
              className="hidden items-center gap-1.5 text-sm text-muted-foreground sm:flex"
            >
              <Lock className="size-4" aria-hidden="true" />
              {t('auth.deviceMode', { name: device.name })}
            </span>
          ) : null}
          {user && onLogout ? (
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="h-12 px-4"
              data-testid="logout"
              disabled={loggingOut}
              onClick={onLogout}
            >
              <LogOut className="size-4" />
              {t('auth.logout')}
            </Button>
          ) : null}
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
      </div>
      <TricolorStripe />
    </header>
  );
}
