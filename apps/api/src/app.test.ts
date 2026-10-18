import { healthSchema } from '@los-papis/shared';
import { describe, expect, it } from 'vitest';

import { createApp } from './app.ts';

const silentLog = { info: () => {}, error: () => {} };

const makeApp = () => createApp({ version: '1.2.3', uptimeSeconds: () => 42.9, log: silentLog });

describe('GET /api/health', () => {
  it('devuelve estado, versión, hora de Roma y uptime', async () => {
    const res = await makeApp().request('/api/health');
    expect(res.status).toBe(200);
    const body = healthSchema.parse(await res.json());
    expect(body.version).toBe('1.2.3');
    expect(body.uptimeSeconds).toBe(42);
    expect(body.timezone).toBe('Europe/Rome');
    expect(body.time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  });
});

describe('GET /health', () => {
  it('es la misma respuesta en la raíz (criterio literal de LP-01)', async () => {
    const res = await makeApp().request('/health');
    expect(res.status).toBe(200);
    expect(healthSchema.safeParse(await res.json()).success).toBe(true);
  });
});

describe('rutas desconocidas', () => {
  it('responde 404 en JSON', async () => {
    const res = await makeApp().request('/api/no-existe');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });
});
