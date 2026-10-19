/**
 * Límite de intentos en memoria, por clave (por ejemplo "ip:usuario"): ventana fija de `windowMs` que empieza
 * con el primer intento. Vale para una sola instancia de la API (la nuestra); se vacía al reiniciar. El bloqueo
 * de cuenta tras 10 fallos vive en la base (users.login_locked_until) y no depende de esto.
 */

export type RateLimiterOptions = {
  /** Intentos permitidos por clave dentro de la ventana. */
  max: number;
  windowMs: number;
  /** Reloj en milisegundos (las pruebas lo inyectan). */
  now?: () => number;
};

export type RateLimitResult = {
  allowed: boolean;
  /** Intentos que quedan en la ventana (0 si ya no se permite). */
  remaining: number;
  /** Segundos hasta que la ventana se reinicia (siempre >= 1). */
  retryAfterSeconds: number;
};

type Entry = { count: number; resetAt: number };

/** Cada cuántos intentos se barren las entradas caducadas (limpieza perezosa, sin temporizadores). */
const SWEEP_EVERY = 100;
const SWEEP_WHEN_OVER = 10_000;

export const createRateLimiter = ({ max, windowMs, now = Date.now }: RateLimiterOptions) => {
  const entries = new Map<string, Entry>();
  let hits = 0;

  const sweep = (at: number): void => {
    for (const [key, entry] of entries) {
      if (entry.resetAt <= at) entries.delete(key);
    }
  };

  return {
    /** Registra un intento y dice si se permite. */
    hit(key: string): RateLimitResult {
      const at = now();
      hits += 1;
      if (hits % SWEEP_EVERY === 0 || entries.size > SWEEP_WHEN_OVER) sweep(at);
      let entry = entries.get(key);
      if (!entry || entry.resetAt <= at) {
        entry = { count: 0, resetAt: at + windowMs };
        entries.set(key, entry);
      }
      entry.count += 1;
      const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - at) / 1000));
      if (entry.count > max) return { allowed: false, remaining: 0, retryAfterSeconds };
      return { allowed: true, remaining: max - entry.count, retryAfterSeconds };
    },
    /** Olvida una clave (por ejemplo, tras un acceso correcto). */
    reset(key: string): void {
      entries.delete(key);
    },
    /** Claves vivas en memoria (para las pruebas de limpieza). */
    size(): number {
      return entries.size;
    },
  };
};

export type RateLimiter = ReturnType<typeof createRateLimiter>;

/** 20 intentos por ip:usuario cada 15 minutos (plan LP-05). */
export const LOGIN_RATE_LIMIT = { max: 20, windowMs: 15 * 60_000 } as const;
