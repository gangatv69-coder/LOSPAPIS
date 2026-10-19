import { describe, expect, it } from 'vitest';

import { createRateLimiter, LOGIN_RATE_LIMIT } from './rate-limit.ts';

const clock = (start = 1_000_000) => {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
};

describe('límite de intentos en memoria', () => {
  it('permite 20 intentos por clave en 15 minutos y rechaza el 21.º con retryAfterSeconds', () => {
    const time = clock();
    const limiter = createRateLimiter({ ...LOGIN_RATE_LIMIT, now: time.now });
    for (let i = 1; i <= 20; i += 1) {
      const result = limiter.hit('ip:usuario');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(20 - i);
    }
    time.advance(5 * 60_000);
    const blocked = limiter.hit('ip:usuario');
    expect(blocked).toEqual({ allowed: false, remaining: 0, retryAfterSeconds: 10 * 60 });
  });

  it('las claves son independientes', () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 1000, now: clock().now });
    expect(limiter.hit('a').allowed).toBe(true);
    expect(limiter.hit('a').allowed).toBe(false);
    expect(limiter.hit('b').allowed).toBe(true);
  });

  it('la ventana se reinicia cuando pasa windowMs desde el primer intento', () => {
    const time = clock();
    const limiter = createRateLimiter({ max: 2, windowMs: 1000, now: time.now });
    limiter.hit('k');
    limiter.hit('k');
    expect(limiter.hit('k').allowed).toBe(false);
    time.advance(999);
    expect(limiter.hit('k').allowed).toBe(false);
    time.advance(1);
    expect(limiter.hit('k')).toEqual({ allowed: true, remaining: 1, retryAfterSeconds: 1 });
  });

  it('reset olvida la clave', () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 1000, now: clock().now });
    limiter.hit('k');
    expect(limiter.hit('k').allowed).toBe(false);
    limiter.reset('k');
    expect(limiter.hit('k').allowed).toBe(true);
  });

  it('retryAfterSeconds nunca baja de 1 y redondea hacia arriba', () => {
    const time = clock();
    const limiter = createRateLimiter({ max: 1, windowMs: 1500, now: time.now });
    limiter.hit('k');
    time.advance(1400);
    expect(limiter.hit('k').retryAfterSeconds).toBe(1);
  });

  it('limpieza perezosa: las entradas caducadas desaparecen cada 100 intentos', () => {
    const time = clock();
    const limiter = createRateLimiter({ max: 5, windowMs: 1000, now: time.now });
    for (let i = 0; i < 50; i += 1) limiter.hit(`vieja-${i}`);
    expect(limiter.size()).toBe(50);
    time.advance(2000);
    for (let i = 0; i < 50; i += 1) limiter.hit(`nueva-${i}`);
    // El intento número 100 barre las 50 caducadas.
    expect(limiter.size()).toBe(50);
  });
});
