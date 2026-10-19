import { randomUUID } from 'node:crypto';

import { createDb, type DbHandle, eq, saleReceipts, sales, withShop } from '@los-papis/db';
import {
  type Barber,
  barberSchema,
  type CreateSaleRequest,
  createSaleResponseSchema,
  daySalesSchema,
  deviceSummarySchema,
  type Product,
  pinVerifyResponseSchema,
  productSchema,
  type Sale,
  type Service,
  saleSchema,
  serviceSchema,
  toRomeIso,
} from '@los-papis/shared';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type * as z from 'zod';

import { signPinAssertion } from '../src/auth/tokens.ts';
import {
  bootstrapManager,
  createAccount,
  createHarness,
  enableTotp,
  type Harness,
  login,
  MINUTE,
  setCookieFor,
  TEST_SECRET,
  type TestClient,
} from './setup/harness.ts';

const UNKNOWN_ID = '00000000-0000-7000-8000-000000000000';
const PIN = '123456';

/** SQLSTATE del error de PostgreSQL, directo o envuelto por Drizzle en `cause`. */
const pgCode = (error: unknown): string | undefined => {
  if (typeof error !== 'object' || error === null) return undefined;
  const { code, cause } = error as { code?: unknown; cause?: unknown };
  return typeof code === 'string' ? code : pgCode(cause);
};

describe('cobro en la caja (LP-09)', () => {
  let h: Harness;
  let appDb: DbHandle;
  /** Sesión del manager sin cookie de dispositivo (el PC de la oficina). */
  let manager: TestClient;
  let managerId = '';
  /** Solo la cookie del dispositivo de caja (el iPad sin nadie dentro). */
  let caja: TestClient;
  let deviceId = '';
  let barber: TestClient;
  let barberUserId = '';
  let barbero: Barber;
  let fade: Service;
  let cera: Product;
  let firstRequest: CreateSaleRequest;
  let firstSale: Sale;
  let raceSaleId = '';
  let cardSaleId = '';
  let deviceSaleId = '';

  const created = async <T extends z.ZodType>(res: Response, schema: T): Promise<z.infer<T>> => {
    expect(res.status).toBe(201);
    return schema.parse(await res.json());
  };

  /** Aserción del PIN del dueño firmada desde `client` (lleva el dispositivo si la petición lo tenía). */
  const assertionFrom = async (client: TestClient): Promise<string> => {
    const res = await client.post('/api/auth/pin/verify', { managerId, pin: PIN });
    expect(res.status).toBe(200);
    return pinVerifyResponseSchema.parse(await res.json()).assertion;
  };

  /** El cobro de la maqueta: Fade ×2 + Cera mate, en efectivo con 50 € entregados (48 € y 2 € de vuelto). */
  const cartRequest = (
    pinAssertion: string,
    overrides: Partial<CreateSaleRequest> = {},
  ): CreateSaleRequest => ({
    id: randomUUID(),
    barberId: barbero.id,
    lines: [
      { kind: 'service', id: fade.id, quantity: 2 },
      { kind: 'product', id: cera.id, quantity: 1 },
    ],
    payment: { method: 'cash', tenderedCents: 5000 },
    expectedTotalCents: 4800,
    pinAssertion,
    ...overrides,
  });

  const createSale = async (client: TestClient, body: CreateSaleRequest) =>
    created(await client.post('/api/sales', body), createSaleResponseSchema);

  const daySalesOf = async (client: TestClient, query = '') => {
    const res = await client.get(`/api/sales/day${query}`);
    expect(res.status).toBe(200);
    return daySalesSchema.parse(await res.json());
  };

  const saleRow = async (id: string) =>
    (await h.owner.db.select().from(sales).where(eq(sales.id, id)))[0];

  beforeAll(async () => {
    h = await createHarness('sales');
    appDb = createDb(inject('db').appUrl, { max: 1 });
    manager = h.client();
    managerId = (await bootstrapManager(manager)).user?.id ?? '';
    // Deja la 2FA reciente: poner el PIN y autorizar el dispositivo la exigen.
    await enableTotp(manager, h.clock);
    expect((await manager.post('/api/auth/pin', { pin: PIN })).status).toBe(200);
    const authorized = await manager.post('/api/devices/authorize', {
      name: 'iPad caja',
      kind: 'ipad',
    });
    deviceId = (await created(authorized, deviceSummarySchema)).id;
    const deviceToken = setCookieFor(authorized, 'lp_device')?.value ?? '';
    // Autorizar deja la cookie del dispositivo también en este cliente: se quita para que la sesión del manager
    // sea la de un PC sin dispositivo de caja (la aserción tiene que llevar deviceId null).
    const sessionToken = manager.cookies().get('lp_session') ?? '';
    manager.clear();
    manager.setCookie('lp_session', sessionToken);
    caja = h.client();
    caja.setCookie('lp_device', deviceToken);

    const account = await createAccount(manager, {
      username: 'barbero1',
      displayName: 'Barbero 1',
      role: 'barber',
    });
    barberUserId = account.user.id;
    barber = h.client();
    await login(barber, 'barbero1', account.temporaryPassword);
    barbero = await created(
      await manager.post('/api/barbers', {
        userId: barberUserId,
        displayName: 'Barbero 1',
        shortCode: 'B1',
        color: 'yellow',
      }),
      barberSchema,
    );
    fade = await created(
      await manager.post('/api/services', {
        nameEs: 'Fade',
        nameIt: 'Fade',
        priceCents: 1800,
        durationMinutes: 40,
      }),
      serviceSchema,
    );
    cera = await created(
      await manager.post('/api/products', { name: 'Cera mate', priceCents: 1200 }),
      productSchema,
    );
  });

  afterAll(async () => {
    await appDb.close();
    await h.close();
  });

  it('cobro en efectivo desde la sesión del manager: 201 con los precios de la base, el vuelto, el día de caja y los nombres', async () => {
    firstRequest = cartRequest(await assertionFrom(manager));
    const { sale, idempotent } = await createSale(manager, firstRequest);
    expect(idempotent).toBe(false);
    expect(sale).toEqual({
      id: firstRequest.id,
      cashDay: '2026-10-19',
      occurredAt: toRomeIso(h.clock.now()),
      barberId: barbero.id,
      barberName: 'Barbero 1',
      managerId,
      managerName: 'Dueño Uno',
      deviceId: null,
      deviceName: null,
      subtotalCents: 4800,
      discountCents: 0,
      totalCents: 4800,
      payment: { method: 'cash', amountCents: 4800, tenderedCents: 5000, changeCents: 200 },
      lines: [
        {
          id: expect.any(String),
          kind: 'service',
          serviceId: fade.id,
          productId: null,
          name: 'Fade',
          unitPriceCents: 1800,
          quantity: 2,
          lineTotalCents: 3600,
        },
        {
          id: expect.any(String),
          kind: 'product',
          serviceId: null,
          productId: cera.id,
          name: 'Cera mate',
          unitPriceCents: 1200,
          quantity: 1,
          lineTotalCents: 1200,
        },
      ],
      receiptNumber: null,
    });
    firstSale = sale;
    // La fila guarda el usuario de la sesión, ningún dispositivo y el hash de la petición.
    expect(await saleRow(sale.id)).toMatchObject({
      shopId: h.shop.id,
      managerId,
      createdByUserId: managerId,
      deviceId: null,
      requestHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    const event = (await h.auditEvents()).find((e) => e.action === 'sale.created');
    expect(event).toMatchObject({
      actorUserId: managerId,
      entityType: 'sale',
      entityId: sale.id,
      deviceId: null,
      after: { totalCents: 4800, method: 'cash', lines: 2, barberId: barbero.id },
    });
  });

  it('la misma petición otra vez (reintento) devuelve el mismo cobro con idempotent: true y no crea otra fila', async () => {
    expect(await createSale(manager, firstRequest)).toEqual({ sale: firstSale, idempotent: true });
    // También con otra aserción (la pantalla volvió a pedir el PIN): el hash no la incluye.
    const fresh = await createSale(manager, {
      ...firstRequest,
      pinAssertion: await assertionFrom(manager),
    });
    expect(fresh).toEqual({ sale: firstSale, idempotent: true });
    const day = await daySalesOf(manager);
    expect(day.sales.map((s) => s.id)).toEqual([firstSale.id]);
    expect(day.totals).toEqual({ count: 1, cashCents: 4800, cardCents: 0, totalCents: 4800 });
    expect((await h.auditActions()).filter((a) => a === 'sale.created')).toHaveLength(1);
  });

  it('dos peticiones iguales a la vez (doble toque): las dos 201, una sola crea y queda una sola fila', async () => {
    h.clock.advance(MINUTE);
    const request = cartRequest(await assertionFrom(manager));
    const responses = await Promise.all([
      manager.post('/api/sales', request),
      manager.post('/api/sales', request),
    ]);
    expect(responses.map((r) => r.status)).toEqual([201, 201]);
    const results = await Promise.all(
      responses.map(async (r) => createSaleResponseSchema.parse(await r.json())),
    );
    expect(results.filter((r) => !r.idempotent)).toHaveLength(1);
    expect(results[0]?.sale).toEqual(results[1]?.sale);
    expect(
      await h.owner.db.select({ id: sales.id }).from(sales).where(eq(sales.id, request.id)),
    ).toHaveLength(1);
    expect((await h.auditActions()).filter((a) => a === 'sale.created')).toHaveLength(2);
    raceSaleId = request.id;
  });

  it('el mismo id con otro contenido → 409 sale_conflict y el cobro guardado no cambia', async () => {
    const res = await manager.post(
      '/api/sales',
      cartRequest(await assertionFrom(manager), {
        id: firstSale.id,
        lines: [{ kind: 'service', id: fade.id, quantity: 1 }],
        expectedTotalCents: 1800,
      }),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'sale_conflict' });
    const detail = await manager.get(`/api/sales/${firstSale.id}`);
    expect(detail.status).toBe(200);
    expect(saleSchema.parse(await detail.json())).toEqual(firstSale);
  });

  it('un total distinto del real (cambió un precio) → 409 total_mismatch con el total real', async () => {
    const res = await manager.post(
      '/api/sales',
      cartRequest(await assertionFrom(manager), { expectedTotalCents: 4700 }),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'total_mismatch',
      expectedTotalCents: 4700,
      totalCents: 4800,
    });
  });

  it('efectivo que no llega al total, o sin importe entregado → 400 tender_too_low; nada se escribe', async () => {
    const assertion = await assertionFrom(manager);
    const low = cartRequest(assertion, { payment: { method: 'cash', tenderedCents: 1000 } });
    const tooLow = await manager.post('/api/sales', low);
    expect(tooLow.status).toBe(400);
    expect(await tooLow.json()).toEqual({
      error: 'tender_too_low',
      totalCents: 4800,
      tenderedCents: 1000,
    });
    const missing = await manager.post(
      '/api/sales',
      cartRequest(assertion, { payment: { method: 'cash' } }),
    );
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({
      error: 'tender_too_low',
      totalCents: 4800,
      tenderedCents: null,
    });
    expect((await manager.get(`/api/sales/${low.id}`)).status).toBe(404);
  });

  it('con tarjeta no hay importe entregado ni vuelto; el día suma cardCents aparte y lista los más recientes primero', async () => {
    h.clock.advance(MINUTE);
    const { sale } = await createSale(
      manager,
      cartRequest(await assertionFrom(manager), {
        lines: [{ kind: 'product', id: cera.id, quantity: 1 }],
        // Lo entregado se ignora con tarjeta.
        payment: { method: 'card', tenderedCents: 5000 },
        expectedTotalCents: 1200,
      }),
    );
    expect(sale.payment).toEqual({
      method: 'card',
      amountCents: 1200,
      tenderedCents: null,
      changeCents: null,
    });
    cardSaleId = sale.id;
    const day = await daySalesOf(manager);
    expect(day.day).toBe('2026-10-19');
    expect(day.sales.map((s) => s.id)).toEqual([cardSaleId, raceSaleId, firstSale.id]);
    expect(day.totals).toEqual({ count: 3, cashCents: 9600, cardCents: 1200, totalCents: 10800 });
  });

  it('servicio desactivado, inexistente o pedido como producto → 404 catalog_item_unavailable; barbero desactivado o inexistente → 404 barber_unavailable', async () => {
    const assertion = await assertionFrom(manager);
    expect((await manager.post(`/api/services/${fade.id}/deactivate`)).status).toBe(200);
    const inactive = await manager.post('/api/sales', cartRequest(assertion));
    expect(inactive.status).toBe(404);
    expect(await inactive.json()).toEqual({
      error: 'catalog_item_unavailable',
      kind: 'service',
      id: fade.id,
    });
    expect((await manager.post(`/api/services/${fade.id}/reactivate`)).status).toBe(200);

    const unknownProduct = await manager.post(
      '/api/sales',
      cartRequest(assertion, {
        lines: [{ kind: 'product', id: UNKNOWN_ID, quantity: 1 }],
        expectedTotalCents: 0,
      }),
    );
    expect(unknownProduct.status).toBe(404);
    expect(await unknownProduct.json()).toEqual({
      error: 'catalog_item_unavailable',
      kind: 'product',
      id: UNKNOWN_ID,
    });
    const wrongKind = await manager.post(
      '/api/sales',
      cartRequest(assertion, {
        lines: [{ kind: 'product', id: fade.id, quantity: 1 }],
        expectedTotalCents: 1800,
      }),
    );
    expect(wrongKind.status).toBe(404);
    expect(await wrongKind.json()).toMatchObject({ kind: 'product', id: fade.id });

    expect((await manager.post(`/api/barbers/${barbero.id}/deactivate`)).status).toBe(200);
    const inactiveBarber = await manager.post('/api/sales', cartRequest(assertion));
    expect(inactiveBarber.status).toBe(404);
    expect(await inactiveBarber.json()).toEqual({ error: 'barber_unavailable' });
    expect((await manager.post(`/api/barbers/${barbero.id}/reactivate`)).status).toBe(200);
    const unknownBarber = await manager.post(
      '/api/sales',
      cartRequest(assertion, { barberId: UNKNOWN_ID }),
    );
    expect(unknownBarber.status).toBe(404);
    expect(await unknownBarber.json()).toEqual({ error: 'barber_unavailable' });
  });

  it('validación del cuerpo: sin líneas, cantidad 0 o sin aserción → 400 validation', async () => {
    const assertion = await assertionFrom(manager);
    for (const body of [
      cartRequest(assertion, { lines: [] }),
      cartRequest(assertion, { lines: [{ kind: 'service', id: fade.id, quantity: 0 }] }),
      cartRequest(''),
      { ...cartRequest(assertion), payment: { method: 'bizum' } },
    ]) {
      const res = await manager.post('/api/sales', body);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: 'validation' });
    }
  });

  it('la aserción caducada (2 minutos) o manipulada → 401 pin_assertion_invalid { reason: "invalid" }', async () => {
    const assertion = await assertionFrom(manager);
    h.clock.advance(3 * MINUTE);
    const expired = await manager.post('/api/sales', cartRequest(assertion));
    expect(expired.status).toBe(401);
    expect(await expired.json()).toEqual({ error: 'pin_assertion_invalid', reason: 'invalid' });
    const forged = await manager.post(
      '/api/sales',
      cartRequest(`${assertion.split('.')[0] ?? ''}.0000`),
    );
    expect(forged.status).toBe(401);
    expect(await forged.json()).toEqual({ error: 'pin_assertion_invalid', reason: 'invalid' });
  });

  it('una aserción del dispositivo no vale desde la sesión sin dispositivo ni al revés (reason: "device"); de otra barbería o de quien no es manager, tampoco', async () => {
    const fromDevice = await assertionFrom(caja);
    const viaSession = await manager.post('/api/sales', cartRequest(fromDevice));
    expect(viaSession.status).toBe(401);
    expect(await viaSession.json()).toEqual({ error: 'pin_assertion_invalid', reason: 'device' });
    const fromSession = await assertionFrom(manager);
    const viaDevice = await caja.post('/api/sales', cartRequest(fromSession));
    expect(viaDevice.status).toBe(401);
    expect(await viaDevice.json()).toEqual({ error: 'pin_assertion_invalid', reason: 'device' });

    // Firmadas con el secreto real pero con otra barbería o con un barbero como "manager".
    const exp = Math.floor(h.clock.now().getTime() / 1000) + 60;
    const otherShop = await manager.post(
      '/api/sales',
      cartRequest(
        signPinAssertion(TEST_SECRET, { managerId, deviceId: null, shopId: UNKNOWN_ID, exp }),
      ),
    );
    expect(otherShop.status).toBe(401);
    expect(await otherShop.json()).toEqual({ error: 'pin_assertion_invalid', reason: 'shop' });
    const notManager = await manager.post(
      '/api/sales',
      cartRequest(
        signPinAssertion(TEST_SECRET, {
          managerId: barberUserId,
          deviceId: null,
          shopId: h.shop.id,
          exp,
        }),
      ),
    );
    expect(notManager.status).toBe(401);
    expect(await notManager.json()).toEqual({ error: 'pin_assertion_invalid', reason: 'manager' });
  });

  it('el dispositivo de caja sin usuario cobra con el PIN del manager: el cobro lleva el dispositivo y ningún usuario de sesión', async () => {
    h.clock.advance(MINUTE);
    const { sale, idempotent } = await createSale(
      caja,
      cartRequest(await assertionFrom(caja), {
        lines: [{ kind: 'service', id: fade.id, quantity: 1 }],
        payment: { method: 'cash', tenderedCents: 2000 },
        expectedTotalCents: 1800,
      }),
    );
    expect(idempotent).toBe(false);
    expect(sale).toMatchObject({
      deviceId,
      deviceName: 'iPad caja',
      managerId,
      managerName: 'Dueño Uno',
      totalCents: 1800,
      payment: { method: 'cash', amountCents: 1800, tenderedCents: 2000, changeCents: 200 },
    });
    deviceSaleId = sale.id;
    expect(await saleRow(sale.id)).toMatchObject({ deviceId, managerId, createdByUserId: null });
    const event = (await h.auditEvents()).find(
      (e) => e.action === 'sale.created' && e.entityId === sale.id,
    );
    expect(event).toMatchObject({ actorUserId: managerId, deviceId });
    // El dispositivo no es un usuario: ni la lista del día ni el detalle.
    expect((await caja.get('/api/sales/day')).status).toBe(401);
    expect((await caja.get(`/api/sales/${sale.id}`)).status).toBe(401);
  });

  it('un barbero no cobra ni ve nada (403 forbidden); sin cookies, 401 device_required al cobrar y unauthenticated al consultar', async () => {
    const asBarber = await barber.post('/api/sales', cartRequest('x'));
    expect(asBarber.status).toBe(403);
    expect(await asBarber.json()).toEqual({ error: 'forbidden' });
    expect((await barber.get('/api/sales/day')).status).toBe(403);
    expect((await barber.get(`/api/sales/${firstSale.id}`)).status).toBe(403);
    expect(
      (await barber.post(`/api/sales/${firstSale.id}/receipt`, { receiptNumber: '1' })).status,
    ).toBe(403);

    const anonymous = h.client();
    const post = await anonymous.post('/api/sales', cartRequest('x'));
    expect(post.status).toBe(401);
    expect(await post.json()).toEqual({ error: 'device_required' });
    const day = await anonymous.get('/api/sales/day');
    expect(day.status).toBe(401);
    expect(await day.json()).toEqual({ error: 'unauthenticated' });
    expect((await anonymous.get(`/api/sales/${firstSale.id}`)).status).toBe(401);
    expect(
      (await anonymous.post(`/api/sales/${firstSale.id}/receipt`, { receiptNumber: '1' })).status,
    ).toBe(401);
  });

  it('GET /api/sales/day?day=2026-10-18 está vacío con los totales a cero; un día imposible o mal escrito → 400 validation', async () => {
    expect(await daySalesOf(manager, '?day=2026-10-18')).toEqual({
      day: '2026-10-18',
      sales: [],
      totals: { count: 0, cashCents: 0, cardCents: 0, totalCents: 0 },
    });
    for (const bad of ['2026-13-01', '2027-02-29', 'hoy', '']) {
      const res = await manager.get(`/api/sales/day?day=${bad}`);
      expect(res.status, `day=${bad}`).toBe(400);
      expect(await res.json()).toMatchObject({ error: 'validation' });
    }
    expect((await manager.get(`/api/sales/${UNKNOWN_ID}`)).status).toBe(404);
    expect((await manager.get('/api/sales/no-es-uuid')).status).toBe(400);
  });

  it('el número de recibo se guarda una vez (recortado); repetirlo → 409 receipt_recorded; el detalle y el día lo traen', async () => {
    h.clock.advance(MINUTE);
    const res = await manager.post(`/api/sales/${firstSale.id}/receipt`, {
      receiptNumber: ' 0042 ',
    });
    expect(res.status).toBe(200);
    expect(saleSchema.parse(await res.json())).toEqual({ ...firstSale, receiptNumber: '0042' });
    const again = await manager.post(`/api/sales/${firstSale.id}/receipt`, {
      receiptNumber: '0043',
    });
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: 'receipt_recorded' });
    const detail = await manager.get(`/api/sales/${firstSale.id}`);
    expect(saleSchema.parse(await detail.json()).receiptNumber).toBe('0042');
    const day = await daySalesOf(manager);
    expect(day.sales.find((s) => s.id === firstSale.id)?.receiptNumber).toBe('0042');

    expect(
      (await manager.post(`/api/sales/${UNKNOWN_ID}/receipt`, { receiptNumber: '1' })).status,
    ).toBe(404);
    expect(
      (await manager.post('/api/sales/no-es-uuid/receipt', { receiptNumber: '1' })).status,
    ).toBe(400);
    const blank = await manager.post(`/api/sales/${cardSaleId}/receipt`, { receiptNumber: '   ' });
    expect(blank.status).toBe(400);
    expect(await blank.json()).toMatchObject({ error: 'validation' });

    // Desde el dispositivo sin usuario también se guarda; la fila y la auditoría no llevan usuario.
    const fromDevice = await caja.post(`/api/sales/${deviceSaleId}/receipt`, {
      receiptNumber: '0043',
    });
    expect(fromDevice.status).toBe(200);
    expect(saleSchema.parse(await fromDevice.json()).receiptNumber).toBe('0043');
    const receipts = await h.owner.db
      .select()
      .from(saleReceipts)
      .where(eq(saleReceipts.saleId, deviceSaleId));
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({
      receiptNumber: '0043',
      recordedByUserId: null,
      recordedAt: h.clock.now(),
    });
    const events = (await h.auditEvents()).filter((e) => e.action === 'sale.receipt_recorded');
    expect(events).toHaveLength(2);
    expect(events.find((e) => e.entityId === firstSale.id)).toMatchObject({
      actorUserId: managerId,
      entityType: 'sale',
      deviceId: null,
      after: { receiptNumber: '0042' },
    });
    expect(events.find((e) => e.entityId === deviceSaleId)).toMatchObject({
      actorUserId: null,
      deviceId,
      after: { receiptNumber: '0043' },
    });
  });

  it('a las 00:30 de Roma (22:30 UTC) el cobro cae en el día de caja siguiente; /day sin parámetro lo lista y el anterior conserva los suyos', async () => {
    h.clock.set(new Date('2026-10-19T22:30:00Z'));
    const { sale } = await createSale(manager, cartRequest(await assertionFrom(manager)));
    expect(sale.cashDay).toBe('2026-10-20');
    expect(sale.occurredAt).toBe('2026-10-20T00:30:00+02:00');
    const today = await daySalesOf(manager);
    expect(today.day).toBe('2026-10-20');
    expect(today.sales.map((s) => s.id)).toEqual([sale.id]);
    expect(today.totals).toEqual({ count: 1, cashCents: 4800, cardCents: 0, totalCents: 4800 });
    const yesterday = await daySalesOf(manager, '?day=2026-10-19');
    expect(yesterday.sales.map((s) => s.id)).toEqual([
      deviceSaleId,
      cardSaleId,
      raceSaleId,
      firstSale.id,
    ]);
    expect(yesterday.totals).toEqual({
      count: 4,
      cashCents: 11400,
      cardCents: 1200,
      totalCents: 12600,
    });
  });

  it('la auditoría lleva sale.created por cada cobro y sale.receipt_recorded por cada recibo', async () => {
    const actions = await h.auditActions();
    expect(actions.filter((a) => a === 'sale.created')).toHaveLength(5);
    expect(actions.filter((a) => a === 'sale.receipt_recorded')).toHaveLength(2);
  });

  it('nada se edita: el rol app no tiene UPDATE sobre sales (42501)', async () => {
    const code = await withShop(appDb.db, h.shop.id, (tx) =>
      tx.update(sales).set({ totalCents: 1 }).where(eq(sales.id, firstSale.id)),
    ).then(
      () => undefined,
      (error: unknown) => pgCode(error),
    );
    expect(code).toBe('42501');
    expect(
      saleSchema.parse(await (await manager.get(`/api/sales/${firstSale.id}`)).json()),
    ).toEqual({ ...firstSale, receiptNumber: '0042' });
  });
});
