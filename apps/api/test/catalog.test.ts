import {
  type Barber,
  barberSchema,
  catalogSchema,
  PHOTO_MAX_BYTES,
  type PhotoSummary,
  type Product,
  photoSummarySchema,
  productSchema,
  type Service,
  serviceSchema,
  toRomeIso,
  userSummarySchema,
} from '@los-papis/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as z from 'zod';

import {
  bootstrapManager,
  createAccount,
  createHarness,
  enableTotp,
  type Harness,
  login,
  MINUTE,
  setCookieFor,
  type TestClient,
} from './setup/harness.ts';
import { gifHeader, pngHeader } from './setup/image-fixtures.ts';

const UNKNOWN_ID = '00000000-0000-7000-8000-000000000000';

const servicesList = z.array(serviceSchema);
const productsList = z.array(productSchema);
const barbersList = z.array(barberSchema);
const usersList = z.array(userSummarySchema);

describe('catálogo y equipo (LP-08)', () => {
  let h: Harness;
  let manager: TestClient;
  let managerId = '';
  let deviceToken = '';
  let barber: TestClient;
  let barberUserId = '';
  let corte: Service;
  let fade: Service;
  let photo: PhotoSummary;
  let photoBytes: Uint8Array;
  let cera: Product;
  let barbero1: Barber;
  let barbero2: Barber;

  /** Cuerpo binario (lo que manda la pantalla tras reducir la foto en el navegador). */
  const upload = (client: TestClient, bytes: Uint8Array, contentType = 'image/png') =>
    client.request('/api/photos', {
      method: 'POST',
      headers: { 'content-type': contentType },
      body: bytes,
    });

  const patch = (client: TestClient, path: string, body: unknown) =>
    client.request(path, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  beforeAll(async () => {
    h = await createHarness('catalog');
    manager = h.client();
    managerId = (await bootstrapManager(manager)).user?.id ?? '';
    // Deja la 2FA reciente: autorizar el dispositivo de caja la exige.
    await enableTotp(manager, h.clock);
    const authorized = await manager.post('/api/devices/authorize', {
      name: 'iPad caja',
      kind: 'ipad',
    });
    expect(authorized.status).toBe(201);
    deviceToken = setCookieFor(authorized, 'lp_device')?.value ?? '';
    const account = await createAccount(manager, {
      username: 'barbero1',
      displayName: 'Barbero 1',
      role: 'barber',
    });
    barberUserId = account.user.id;
    barber = h.client();
    // La contraseña temporal obliga a cambiarla en la pantalla, no en la API.
    expect((await login(barber, 'barbero1', account.temporaryPassword)).user?.role).toBe('barber');
  });

  afterAll(() => h.close());

  describe('servicios', () => {
    it('crear devuelve 201 con el servicio al final de la rejilla; la lista y el catálogo lo enseñan en orden', async () => {
      const created = await manager.post('/api/services', {
        nameEs: '  Corte clásico ',
        nameIt: 'Taglio classico',
        priceCents: 1500,
        durationMinutes: 30,
      });
      expect(created.status).toBe(201);
      corte = serviceSchema.parse(await created.json());
      expect(corte).toMatchObject({
        nameEs: 'Corte clásico',
        nameIt: 'Taglio classico',
        priceCents: 1500,
        durationMinutes: 30,
        active: true,
        sortOrder: 10,
        createdAt: toRomeIso(h.clock.now()),
        updatedAt: toRomeIso(h.clock.now()),
      });
      const second = await manager.post('/api/services', {
        nameEs: 'Fade',
        nameIt: 'Fade',
        priceCents: 1800,
        durationMinutes: 40,
      });
      expect(second.status).toBe(201);
      fade = serviceSchema.parse(await second.json());
      expect(fade.sortOrder).toBe(20);

      const list = await manager.get('/api/services');
      expect(list.status).toBe(200);
      expect(servicesList.parse(await list.json())).toEqual([corte, fade]);
      const catalog = await manager.get('/api/catalog');
      expect(catalog.status).toBe(200);
      expect(catalogSchema.parse(await catalog.json())).toEqual({
        services: [corte, fade],
        products: [],
        barbers: [],
      });

      const event = (await h.auditEvents()).find((e) => e.action === 'service.created');
      expect(event).toMatchObject({
        actorUserId: managerId,
        entityType: 'service',
        entityId: corte.id,
        after: {
          nameEs: 'Corte clásico',
          nameIt: 'Taglio classico',
          priceCents: 1500,
          durationMinutes: 30,
        },
      });
    });

    it('cambiar el precio deja service.price_changed con el valor anterior y el nuevo; otros campos van en service.updated', async () => {
      h.clock.advance(MINUTE);
      const res = await patch(manager, `/api/services/${corte.id}`, { priceCents: 1700 });
      expect(res.status).toBe(200);
      const updated = serviceSchema.parse(await res.json());
      expect(updated).toMatchObject({
        id: corte.id,
        priceCents: 1700,
        updatedAt: toRomeIso(h.clock.now()),
      });
      const priceChanged = (await h.auditEvents()).filter(
        (e) => e.action === 'service.price_changed',
      );
      expect(priceChanged).toHaveLength(1);
      expect(priceChanged[0]).toMatchObject({
        actorUserId: managerId,
        entityType: 'service',
        entityId: corte.id,
        before: { priceCents: 1500 },
        after: { priceCents: 1700 },
      });
      expect((await h.auditActions()).filter((a) => a === 'service.updated')).toHaveLength(0);

      // Nombre y precio a la vez: dos eventos, cada uno con lo suyo.
      const both = await patch(manager, `/api/services/${corte.id}`, {
        nameIt: 'Taglio',
        priceCents: 1600,
        sortOrder: 30,
      });
      expect(both.status).toBe(200);
      corte = serviceSchema.parse(await both.json());
      expect(corte).toMatchObject({ nameIt: 'Taglio', priceCents: 1600, sortOrder: 30 });
      const events = await h.auditEvents();
      expect(events.filter((e) => e.action === 'service.price_changed')).toHaveLength(2);
      const renamed = events.find((e) => e.action === 'service.updated');
      expect(renamed).toMatchObject({
        entityId: corte.id,
        before: { nameIt: 'Taglio classico', sortOrder: 10 },
        after: { nameIt: 'Taglio', sortOrder: 30 },
      });
      expect(renamed?.before).not.toHaveProperty('priceCents');

      // El mismo precio otra vez: nada cambia y no hay rastro.
      const same = await patch(manager, `/api/services/${corte.id}`, { priceCents: 1600 });
      expect(same.status).toBe(200);
      expect((await h.auditEvents()).length).toBe(events.length);

      // El catálogo respeta el orden: Fade (20) antes que Corte (30).
      const catalog = catalogSchema.parse(await (await manager.get('/api/catalog')).json());
      expect(catalog.services.map((s) => s.id)).toEqual([fade.id, corte.id]);
    });

    it('desactivar lo quita del catálogo pero sigue en la lista de gestión (al final, active: false); reactivar lo devuelve', async () => {
      const deactivated = await manager.post(`/api/services/${fade.id}/deactivate`);
      expect(deactivated.status).toBe(200);
      expect(serviceSchema.parse(await deactivated.json())).toMatchObject({
        id: fade.id,
        active: false,
      });
      const catalog = catalogSchema.parse(await (await manager.get('/api/catalog')).json());
      expect(catalog.services.map((s) => s.id)).toEqual([corte.id]);
      const list = servicesList.parse(await (await manager.get('/api/services')).json());
      expect(list.map((s) => [s.id, s.active])).toEqual([
        [corte.id, true],
        [fade.id, false],
      ]);
      // Repetirlo no falla ni añade auditoría.
      expect((await manager.post(`/api/services/${fade.id}/deactivate`)).status).toBe(200);
      expect((await h.auditActions()).filter((a) => a === 'service.deactivated')).toHaveLength(1);

      const reactivated = await manager.post(`/api/services/${fade.id}/reactivate`);
      expect(reactivated.status).toBe(200);
      fade = serviceSchema.parse(await reactivated.json());
      expect(fade.active).toBe(true);
      const again = catalogSchema.parse(await (await manager.get('/api/catalog')).json());
      expect(again.services.map((s) => s.id)).toEqual([fade.id, corte.id]);
      const event = (await h.auditEvents()).find((e) => e.action === 'service.reactivated');
      expect(event).toMatchObject({
        entityId: fade.id,
        before: { active: false },
        after: { active: true },
      });
    });

    it('validación: cuerpo inválido o vacío → 400 validation; id desconocido → 404; id no uuid → 400', async () => {
      const invalid = await manager.post('/api/services', {
        nameEs: '',
        nameIt: 'x',
        priceCents: 10,
        durationMinutes: 3,
      });
      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toMatchObject({ error: 'validation' });
      const empty = await patch(manager, `/api/services/${corte.id}`, {});
      expect(empty.status).toBe(400);
      expect(await empty.json()).toMatchObject({ error: 'validation' });
      const tooExpensive = await patch(manager, `/api/services/${corte.id}`, {
        priceCents: 100_000_01,
      });
      expect(tooExpensive.status).toBe(400);
      const missing = await patch(manager, `/api/services/${UNKNOWN_ID}`, { priceCents: 100 });
      expect(missing.status).toBe(404);
      expect(await missing.json()).toEqual({ error: 'not_found' });
      expect((await manager.post(`/api/services/${UNKNOWN_ID}/deactivate`)).status).toBe(404);
      expect((await manager.post('/api/services/no-es-uuid/reactivate')).status).toBe(400);
    });
  });

  describe('fotos y productos', () => {
    it('sube un PNG (201 con url, medidas y tamaño) y lo sirve con ETag y caché de un año; If-None-Match → 304', async () => {
      photoBytes = pngHeader(2, 2);
      const res = await upload(manager, photoBytes);
      expect(res.status).toBe(201);
      photo = photoSummarySchema.parse(await res.json());
      expect(photo).toMatchObject({
        mime: 'image/png',
        width: 2,
        height: 2,
        sizeBytes: photoBytes.length,
        url: `/api/photos/${photo.id}`,
      });
      const uploaded = (await h.auditEvents()).find((e) => e.action === 'photo.uploaded');
      expect(uploaded).toMatchObject({
        actorUserId: managerId,
        entityType: 'photo',
        entityId: photo.id,
        after: { mime: 'image/png', width: 2, height: 2, sizeBytes: photoBytes.length },
      });

      const served = await manager.get(photo.url);
      expect(served.status).toBe(200);
      expect(served.headers.get('content-type')).toBe('image/png');
      expect(served.headers.get('content-length')).toBe(String(photoBytes.length));
      expect(served.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
      const etag = served.headers.get('etag') ?? '';
      expect(etag).toMatch(/^"[0-9a-f]{64}"$/);
      expect(new Uint8Array(await served.arrayBuffer())).toEqual(photoBytes);

      const cached = await manager.get(photo.url, { 'if-none-match': etag });
      expect(cached.status).toBe(304);
      expect(cached.headers.get('etag')).toBe(etag);
      expect(await cached.text()).toBe('');
      const weak = await manager.get(photo.url, { 'if-none-match': `W/${etag}, "otro"` });
      expect(weak.status).toBe(304);
      const stale = await manager.get(photo.url, { 'if-none-match': '"otro"' });
      expect(stale.status).toBe(200);
    });

    it('rechaza lo que no vale: 500 KB → 413 photo_too_large; text/plain → 400; 2000 px → 400; GIF → 400; id desconocido → 404', async () => {
      const big = await upload(manager, pngHeader(2, 2, 500 * 1024));
      expect(big.status).toBe(413);
      expect(await big.json()).toEqual({ error: 'photo_too_large' });
      const text = await upload(manager, photoBytes, 'text/plain');
      expect(text.status).toBe(400);
      expect(await text.json()).toMatchObject({ error: 'photo_invalid' });
      const wide = await upload(manager, pngHeader(2000, 2));
      expect(wide.status).toBe(400);
      expect(await wide.json()).toMatchObject({ error: 'photo_invalid', reason: 'dimensions' });
      const gif = await upload(manager, gifHeader(), 'image/gif');
      expect(gif.status).toBe(400);
      expect(await gif.json()).toMatchObject({ error: 'photo_invalid', reason: 'format' });
      // El tope justo pasa (la cabecera es válida y los ceros de relleno no importan).
      expect((await upload(manager, pngHeader(2, 2, PHOTO_MAX_BYTES))).status).toBe(201);

      const missing = await manager.get(`/api/photos/${UNKNOWN_ID}`);
      expect(missing.status).toBe(404);
      expect(await missing.json()).toEqual({ error: 'not_found' });
      expect((await manager.get('/api/photos/no-es-uuid')).status).toBe(400);
      expect((await h.auditActions()).filter((a) => a === 'photo.uploaded')).toHaveLength(2);
    });

    it('un producto con foto lleva photoUrl; sin foto, null; photoId inexistente → 404', async () => {
      const created = await manager.post('/api/products', {
        name: 'Cera mate',
        priceCents: 1200,
        photoId: photo.id,
      });
      expect(created.status).toBe(201);
      cera = productSchema.parse(await created.json());
      expect(cera).toMatchObject({
        name: 'Cera mate',
        priceCents: 1200,
        photoId: photo.id,
        photoUrl: photo.url,
        active: true,
        sortOrder: 10,
      });
      const plain = await manager.post('/api/products', { name: 'Champú', priceCents: 1000 });
      expect(plain.status).toBe(201);
      expect(productSchema.parse(await plain.json())).toMatchObject({
        photoId: null,
        photoUrl: null,
        sortOrder: 20,
      });
      const missing = await manager.post('/api/products', {
        name: 'Pomada',
        priceCents: 1400,
        photoId: UNKNOWN_ID,
      });
      expect(missing.status).toBe(404);
      expect(await missing.json()).toEqual({ error: 'not_found', entity: 'photo' });
      expect(
        (await patch(manager, `/api/products/${cera.id}`, { photoId: UNKNOWN_ID })).status,
      ).toBe(404);

      const catalog = catalogSchema.parse(await (await manager.get('/api/catalog')).json());
      expect(catalog.products.map((p) => [p.name, p.photoUrl])).toEqual([
        ['Cera mate', photo.url],
        ['Champú', null],
      ]);
      const list = productsList.parse(await (await manager.get('/api/products')).json());
      expect(list).toHaveLength(2);
    });

    it('el precio de un producto deja product.price_changed; quitar la foto va en product.updated; desactivar y reactivar', async () => {
      const res = await patch(manager, `/api/products/${cera.id}`, {
        priceCents: 1300,
        photoId: null,
      });
      expect(res.status).toBe(200);
      cera = productSchema.parse(await res.json());
      expect(cera).toMatchObject({ priceCents: 1300, photoId: null, photoUrl: null });
      const events = await h.auditEvents();
      expect(events.find((e) => e.action === 'product.price_changed')).toMatchObject({
        entityType: 'product',
        entityId: cera.id,
        before: { priceCents: 1200 },
        after: { priceCents: 1300 },
      });
      expect(events.find((e) => e.action === 'product.updated')).toMatchObject({
        entityId: cera.id,
        before: { photoId: photo.id },
        after: { photoId: null },
      });

      expect((await manager.post(`/api/products/${cera.id}/deactivate`)).status).toBe(200);
      const catalog = catalogSchema.parse(await (await manager.get('/api/catalog')).json());
      expect(catalog.products.map((p) => p.name)).toEqual(['Champú']);
      const list = productsList.parse(await (await manager.get('/api/products')).json());
      expect(list.map((p) => [p.name, p.active])).toEqual([
        ['Champú', true],
        ['Cera mate', false],
      ]);
      const reactivated = await manager.post(`/api/products/${cera.id}/reactivate`);
      expect(reactivated.status).toBe(200);
      expect(productSchema.parse(await reactivated.json()).active).toBe(true);
      expect((await manager.post(`/api/products/${UNKNOWN_ID}/deactivate`)).status).toBe(404);
      const actions = await h.auditActions();
      expect(actions.filter((a) => a === 'product.deactivated')).toHaveLength(1);
      expect(actions.filter((a) => a === 'product.reactivated')).toHaveLength(1);
    });
  });

  describe('barberos', () => {
    it('los candidatos son los usuarios activos con cuenta y sin perfil; el alta devuelve 201 y los quita de la lista', async () => {
      const candidates = await manager.get('/api/barbers/candidates');
      expect(candidates.status).toBe(200);
      expect(usersList.parse(await candidates.json()).map((u) => u.username)).toEqual([
        'barbero1',
        'dueno',
      ]);

      const created = await manager.post('/api/barbers', {
        userId: barberUserId,
        displayName: 'Barbero 1',
        shortCode: 'b1',
        color: 'yellow',
        photoId: photo.id,
      });
      expect(created.status).toBe(201);
      barbero1 = barberSchema.parse(await created.json());
      expect(barbero1).toMatchObject({
        userId: barberUserId,
        displayName: 'Barbero 1',
        shortCode: 'B1',
        color: 'yellow',
        photoId: photo.id,
        photoUrl: photo.url,
        active: true,
        sortOrder: 10,
      });
      const after = usersList.parse(await (await manager.get('/api/barbers/candidates')).json());
      expect(after.map((u) => u.username)).toEqual(['dueno']);
      const list = await manager.get('/api/barbers');
      expect(list.status).toBe(200);
      expect(barbersList.parse(await list.json())).toEqual([barbero1]);
      const catalog = catalogSchema.parse(await (await manager.get('/api/catalog')).json());
      expect(catalog.barbers).toEqual([barbero1]);
      const event = (await h.auditEvents()).find((e) => e.action === 'barber.created');
      expect(event).toMatchObject({
        actorUserId: managerId,
        entityType: 'barber',
        entityId: barbero1.id,
        after: {
          userId: barberUserId,
          displayName: 'Barbero 1',
          shortCode: 'B1',
          color: 'yellow',
          photoId: photo.id,
        },
      });
    });

    it('el mismo usuario otra vez → 409 user_already_barber; usuario desconocido → 404; color fuera de la paleta → 400', async () => {
      const duplicate = await manager.post('/api/barbers', {
        userId: barberUserId,
        displayName: 'Otra vez',
        shortCode: 'B9',
        color: 'blue',
      });
      expect(duplicate.status).toBe(409);
      expect(await duplicate.json()).toEqual({ error: 'user_already_barber' });
      const unknown = await manager.post('/api/barbers', {
        userId: UNKNOWN_ID,
        displayName: 'Nadie',
        shortCode: 'N1',
        color: 'blue',
      });
      expect(unknown.status).toBe(404);
      expect(await unknown.json()).toEqual({ error: 'not_found', entity: 'user' });
      const badColor = await manager.post('/api/barbers', {
        userId: managerId,
        displayName: 'Dueño',
        shortCode: 'D',
        color: 'black',
      });
      expect(badColor.status).toBe(400);
      expect(await badColor.json()).toMatchObject({ error: 'validation' });
    });

    it('el código corto no se repite entre activos (409 short_code_taken); desactivar lo libera y reactivar lo vuelve a exigir', async () => {
      const taken = await manager.post('/api/barbers', {
        userId: managerId,
        displayName: 'Dueño Uno',
        shortCode: 'B1',
        color: 'blue',
      });
      expect(taken.status).toBe(409);
      expect(await taken.json()).toEqual({ error: 'short_code_taken', shortCode: 'B1' });

      const deactivated = await manager.post(`/api/barbers/${barbero1.id}/deactivate`);
      expect(deactivated.status).toBe(200);
      expect(barberSchema.parse(await deactivated.json()).active).toBe(false);
      expect(catalogSchema.parse(await (await manager.get('/api/catalog')).json()).barbers).toEqual(
        [],
      );

      const freed = await manager.post('/api/barbers', {
        userId: managerId,
        displayName: 'Dueño Uno',
        shortCode: 'B1',
        color: 'blue',
      });
      expect(freed.status).toBe(201);
      barbero2 = barberSchema.parse(await freed.json());
      expect(barbero2).toMatchObject({ userId: managerId, shortCode: 'B1', sortOrder: 20 });

      // Barbero 1 no puede volver con B1 mientras lo use el dueño.
      const blocked = await manager.post(`/api/barbers/${barbero1.id}/reactivate`);
      expect(blocked.status).toBe(409);
      expect(await blocked.json()).toEqual({ error: 'short_code_taken', shortCode: 'B1' });
      // Con otro código, sí.
      expect(
        (await patch(manager, `/api/barbers/${barbero1.id}`, { shortCode: 'b2' })).status,
      ).toBe(200);
      const reactivated = await manager.post(`/api/barbers/${barbero1.id}/reactivate`);
      expect(reactivated.status).toBe(200);
      barbero1 = barberSchema.parse(await reactivated.json());
      expect(barbero1).toMatchObject({ shortCode: 'B2', active: true });

      const list = barbersList.parse(await (await manager.get('/api/barbers')).json());
      expect(list.map((b) => b.id)).toEqual([barbero1.id, barbero2.id]);
      const actions = await h.auditActions();
      expect(actions.filter((a) => a === 'barber.deactivated')).toHaveLength(1);
      expect(actions.filter((a) => a === 'barber.reactivated')).toHaveLength(1);
    });

    it('editar: nombre, color y foto van en barber.updated; cambiar al código de otro activo → 409; quitar la foto', async () => {
      const res = await patch(manager, `/api/barbers/${barbero1.id}`, {
        displayName: 'Barbero Uno',
        color: 'red',
        photoId: null,
      });
      expect(res.status).toBe(200);
      barbero1 = barberSchema.parse(await res.json());
      expect(barbero1).toMatchObject({
        displayName: 'Barbero Uno',
        color: 'red',
        photoId: null,
        photoUrl: null,
      });
      const updated = (await h.auditEvents()).filter((e) => e.action === 'barber.updated');
      expect(updated.at(-1)).toMatchObject({
        entityId: barbero1.id,
        before: { displayName: 'Barbero 1', color: 'yellow', photoId: photo.id },
        after: { displayName: 'Barbero Uno', color: 'red', photoId: null },
      });

      const clash = await patch(manager, `/api/barbers/${barbero1.id}`, { shortCode: 'B1' });
      expect(clash.status).toBe(409);
      expect(await clash.json()).toEqual({ error: 'short_code_taken', shortCode: 'B1' });
      // El suyo propio no cuenta como ocupado.
      expect(
        (await patch(manager, `/api/barbers/${barbero1.id}`, { shortCode: 'B2' })).status,
      ).toBe(200);
      expect((await patch(manager, `/api/barbers/${UNKNOWN_ID}`, { color: 'blue' })).status).toBe(
        404,
      );
      expect(
        (await patch(manager, `/api/barbers/${barbero1.id}`, { shortCode: 'abcd' })).status,
      ).toBe(400);
    });
  });

  describe('permisos', () => {
    it('un barbero lee el catálogo y las fotos pero no gestiona nada (403 forbidden)', async () => {
      const catalog = await barber.get('/api/catalog');
      expect(catalog.status).toBe(200);
      expect(catalogSchema.parse(await catalog.json()).barbers.map((b) => b.id)).toEqual([
        barbero1.id,
        barbero2.id,
      ]);
      expect((await barber.get(photo.url)).status).toBe(200);
      for (const [method, path] of [
        ['GET', '/api/services'],
        ['POST', '/api/services'],
        ['PATCH', `/api/services/${corte.id}`],
        ['POST', `/api/services/${corte.id}/deactivate`],
        ['GET', '/api/products'],
        ['POST', '/api/products'],
        ['GET', '/api/barbers'],
        ['GET', '/api/barbers/candidates'],
        ['POST', '/api/barbers'],
        ['PATCH', `/api/barbers/${barbero1.id}`],
        ['POST', `/api/barbers/${barbero1.id}/reactivate`],
      ] as const) {
        const res = await barber.request(path, {
          method,
          headers: { 'content-type': 'application/json' },
          body: method === 'GET' ? undefined : JSON.stringify({}),
        });
        expect(res.status, `${method} ${path}`).toBe(403);
        expect(await res.json()).toEqual({ error: 'forbidden' });
      }
      const photoUpload = await upload(barber, photoBytes);
      expect(photoUpload.status).toBe(403);
      expect(await photoUpload.json()).toEqual({ error: 'forbidden' });
    });

    it('el dispositivo de caja (solo cookie lp_device) lee el catálogo y las fotos; nada más', async () => {
      const caja = h.client();
      caja.setCookie('lp_device', deviceToken);
      const catalog = await caja.get('/api/catalog');
      expect(catalog.status).toBe(200);
      const parsed = catalogSchema.parse(await catalog.json());
      expect(parsed.services.map((s) => s.id)).toEqual([fade.id, corte.id]);
      expect(parsed.products.map((p) => p.name)).toEqual(['Cera mate', 'Champú']);
      const served = await caja.get(photo.url);
      expect(served.status).toBe(200);
      expect(served.headers.get('content-type')).toBe('image/png');
      // El dispositivo no es un usuario: la gestión le responde 401.
      const denied = await caja.post('/api/services', {});
      expect(denied.status).toBe(401);
      expect(await denied.json()).toEqual({ error: 'unauthenticated' });
      expect((await upload(caja, photoBytes)).status).toBe(401);
    });

    it('sin cookies todo es 401 unauthenticated', async () => {
      const anonymous = h.client();
      const catalog = await anonymous.get('/api/catalog');
      expect(catalog.status).toBe(401);
      expect(await catalog.json()).toEqual({ error: 'unauthenticated' });
      const served = await anonymous.get(photo.url);
      expect(served.status).toBe(401);
      expect(await served.json()).toEqual({ error: 'unauthenticated' });
      expect((await anonymous.get('/api/services')).status).toBe(401);
      expect((await anonymous.get('/api/barbers')).status).toBe(401);
      expect((await upload(anonymous, photoBytes)).status).toBe(401);
    });
  });
});
