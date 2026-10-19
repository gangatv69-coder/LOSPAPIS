import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { csrfGuard } from './csrf.ts';

const PUBLIC_ORIGIN = 'https://pruebas.example.test';

const app = new Hono()
  .use('/api/*', csrfGuard({ publicOrigin: PUBLIC_ORIGIN }))
  .get('/api/x', (c) => c.json({ ok: true }))
  .post('/api/x', (c) => c.json({ ok: true }))
  .put('/api/x', (c) => c.json({ ok: true }))
  .delete('/api/x', (c) => c.json({ ok: true }));

const send = (method: string, headers: Record<string, string> = {}) =>
  app.request('http://localhost:3000/api/x', { method, headers });

describe('guardia CSRF', () => {
  it('GET pasa siempre, incluso cross-site', async () => {
    expect((await send('GET', { 'sec-fetch-site': 'cross-site' })).status).toBe(200);
  });

  it('POST con Sec-Fetch-Site same-origin o none pasa', async () => {
    expect((await send('POST', { 'sec-fetch-site': 'same-origin' })).status).toBe(200);
    expect((await send('POST', { 'sec-fetch-site': 'none' })).status).toBe(200);
  });

  it('POST, PUT y DELETE cross-site (o same-site) responden 403 csrf', async () => {
    for (const method of ['POST', 'PUT', 'DELETE']) {
      const res = await send(method, { 'sec-fetch-site': 'cross-site' });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: 'csrf' });
    }
    expect((await send('POST', { 'sec-fetch-site': 'same-site' })).status).toBe(403);
  });

  it('sin Sec-Fetch-Site, Origin igual a PUBLIC_URL o al propio Host pasa', async () => {
    expect((await send('POST', { origin: PUBLIC_ORIGIN })).status).toBe(200);
    expect((await send('POST', { origin: 'http://localhost:3000' })).status).toBe(200);
  });

  it('sin Sec-Fetch-Site, un Origin distinto (o "null") responde 403', async () => {
    expect((await send('POST', { origin: 'https://malicioso.example' })).status).toBe(403);
    expect((await send('POST', { origin: 'null' })).status).toBe(403);
    expect((await send('POST', { origin: 'https://pruebas.example.test.evil' })).status).toBe(403);
  });

  it('sin ninguna de las dos cabeceras (curl, pruebas) pasa: no es un navegador', async () => {
    expect((await send('POST')).status).toBe(200);
  });

  it('Sec-Fetch-Site manda sobre Origin cuando vienen las dos', async () => {
    expect(
      (await send('POST', { 'sec-fetch-site': 'cross-site', origin: PUBLIC_ORIGIN })).status,
    ).toBe(403);
  });
});
