import { TIMEZONE } from '@los-papis/shared';

/** Fechas de la API (ISO con desfase) en pantalla, siempre en hora de Roma. Un valor raro se enseña tal cual. */
export function formatDateTime(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: TIMEZONE,
  }).format(date);
}

/** Solo la hora ("10:05"), por ejemplo "bloqueado hasta las 10:05". */
export function formatTime(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, { timeStyle: 'short', timeZone: TIMEZONE }).format(date);
}
