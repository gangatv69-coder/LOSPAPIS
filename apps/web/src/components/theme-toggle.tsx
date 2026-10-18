import { Moon, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/components/theme-provider';
import { Button } from '@/components/ui/button';

/** Botón de la cabecera: alterna claro/oscuro a partir del tema resuelto (48 px para el iPad). */
export function ThemeToggle() {
  const { t } = useTranslation();
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  return (
    <Button
      type="button"
      variant="outline"
      size="icon-lg"
      // icon-lg mide 36 px en radix-nova; 48 px (size-12) para el iPad de la caja.
      className="size-12"
      aria-label={isDark ? t('theme.toLight') : t('theme.toDark')}
      aria-pressed={isDark}
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
    >
      {isDark ? <Sun className="size-5" /> : <Moon className="size-5" />}
    </Button>
  );
}
