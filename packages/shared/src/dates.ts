export const TIMEZONE = 'Europe/Rome' as const;

const romeFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  timeZoneName: 'longOffset',
});

/**
 * Fecha y hora en Europe/Rome en formato ISO 8601 con desfase local,
 * por ejemplo `2026-10-18T14:03:05+02:00`.
 */
export const toRomeIso = (date: Date): string => {
  const parts = romeFormatter.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  const zone = get('timeZoneName'); // "GMT+02:00", o "GMT" si el desfase es cero
  const offset = zone === 'GMT' ? '+00:00' : zone.replace('GMT', '');
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}${offset}`;
};
