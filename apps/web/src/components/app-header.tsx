import type { AuthState } from '@los-papis/shared';
import { Link } from '@tanstack/react-router';
import { Lock, LogOut } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { TricolorStripe } from '@/components/brand/tricolor-stripe';
import { Wordmark } from '@/components/brand/wordmark';
import { LanguageSwitcher } from '@/components/language-switcher';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import {
  isBarberSession,
  isManagerSession,
  pendingSetupStep,
  type SetupStep,
} from '@/features/auth/auth-guard';

/** Pestañas de la cabecera (modo caja: dispositivo sin usuario). `to` está tipado por el registro del router. */
const baseTabs = [
  { to: '/caja', key: 'nav.register' },
  { to: '/cierre', key: 'nav.close' },
  { to: '/panel', key: 'nav.dashboard' },
  { to: '/ajustes', key: 'nav.settings' },
] as const;

/** Un manager gestiona además el catálogo y el equipo (LP-08) y revisa la auditoría (LP-10). */
const managerTabs = [
  { to: '/caja', key: 'nav.register' },
  { to: '/cierre', key: 'nav.close' },
  { to: '/catalogo', key: 'nav.catalog' },
  { to: '/equipo', key: 'nav.team' },
  { to: '/panel', key: 'nav.dashboard' },
  { to: '/auditoria', key: 'nav.audit' },
  { to: '/ajustes', key: 'nav.settings' },
] as const;

/** Un barbero no cobra ni cierra (LP-09): solo su panel y sus ajustes. */
const barberTabs = [
  { to: '/panel', key: 'nav.dashboard' },
  { to: '/ajustes', key: 'nav.settings' },
] as const;

function tabsFor(auth: AuthState | null) {
  if (auth && isManagerSession(auth)) return managerTabs;
  if (auth && isBarberSession(auth)) return barberTabs;
  return baseTabs;
}

const focusRing = 'outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50';

const tabClass = `inline-flex h-12 shrink-0 items-center rounded-lg px-4 font-medium text-muted-foreground transition-colors ${focusRing}`;

export type AppHeaderProps = {
  /** Estado de acceso (GET /api/auth/me): usuario con "Salir" o nombre del dispositivo de caja. */
  auth?: AuthState | null;
  /** Falso en /acceso y /configurar: sin sesión no hay a dónde ir. */
  showTabs?: boolean;
  onLogout?: () => void;
  loggingOut?: boolean;
  /** Toque en una pestaña con candado (falta un paso obligatorio de la cuenta): se explica cuál. */
  onLockedTab?: (step: SetupStep) => void;
};

/**
 * Cabecera de la maqueta: marca, pestañas en píldora (activa = clara en oscuro, amarilla en claro),
 * quién está dentro (o qué dispositivo es), selector de idioma, botón de tema y, debajo, la franja tricolor.
 * Mientras a la cuenta le falte un paso obligatorio (contraseña temporal, 2FA del manager) el guardia solo
 * deja entrar en Ajustes: las demás pestañas salen con candado y, al tocarlas, `onLockedTab` dice qué falta.
 */
export function AppHeader({
  auth = null,
  showTabs = true,
  onLogout,
  loggingOut = false,
  onLockedTab,
}: AppHeaderProps) {
  const { t } = useTranslation();
  const lockedHintId = useId();
  const user = auth?.user ?? null;
  const device = auth?.device ?? null;
  const tabs = tabsFor(auth);
  const setupStep = auth ? pendingSetupStep(auth) : null;

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
            {tabs.map((tab) =>
              setupStep && tab.to !== '/ajustes' ? (
                // No es un botón desactivado: al tocarlo explica qué falta y baja hasta ese paso.
                <button
                  key={tab.to}
                  type="button"
                  aria-describedby={lockedHintId}
                  data-testid="nav-tab-locked"
                  onClick={() => onLockedTab?.(setupStep)}
                  className={`${tabClass} gap-1.5 opacity-60`}
                >
                  <Lock className="size-4" aria-hidden="true" />
                  {t(tab.key)}
                </button>
              ) : (
                <Link
                  key={tab.to}
                  to={tab.to}
                  className={`${tabClass} hover:text-foreground data-[status=active]:bg-primary data-[status=active]:text-primary-foreground dark:data-[status=active]:bg-foreground dark:data-[status=active]:text-background`}
                >
                  {t(tab.key)}
                </Link>
              ),
            )}
            {setupStep ? (
              <span id={lockedHintId} className="sr-only">
                {t('nav.lockedHint')}
              </span>
            ) : null}
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
