import type { SettingsStep } from '@/features/auth/auth-guard';

/**
 * Baja hasta una sección de Ajustes (`id="ajustes-<paso>"`) si está en la página. La usan la propia página
 * al abrirse con ?paso= y la cabecera al tocar una pestaña con candado estando ya en Ajustes (la URL no
 * cambia y la página no se vuelve a montar).
 */
export function scrollToSettingsStep(step: SettingsStep, behavior: ScrollBehavior = 'auto'): void {
  document.getElementById(`ajustes-${step}`)?.scrollIntoView({ behavior, block: 'start' });
}
