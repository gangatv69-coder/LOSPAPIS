import { randomUUID } from 'node:crypto';

import {
  createDb,
  type DbHandle,
  eq,
  saleDiscounts,
  sales,
  saleVoids,
  withShop,
} from '@los-papis/db';
import {
  type AuditEntry,
  type AuditPage,
  auditPageSchema,
  type Barber,
  barberSchema,
  type CreateSaleRequest,
  type CreateSaleResponse,
  cashDayRange,
  createSaleResponseSchema,
  daySalesSchema,
  deviceSummarySchema,
  type Product,
  pinVerifyResponseSchema,
  productSchema,
  type Sale,
  type SaleDiscountInput,
  type Service,
  saleSchema,
  serviceSchema,
  toRomeIso,
} from '@los-papis/shared';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

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

const UNKNOWN_ID = '00000000-0000-7000-8000-000000000000';
const PIN = '123456';
const WRONG_PIN = '654321';

/** SQLSTATE del error de PostgreSQL, directo o envuelto por Drizzle en `cause`. */
const pgCode = (error: unknown): string | undefined => {
  if (typeof error !== 'object' || error === null) return undefined;
  const { code, cause } = error as { code?: unknown; cause?: unknown };
  return typeof code === 'string' ? code : pgCode(cause);
};

/** Fidelidad del 10 % sobre todo el cobro (la fila "Fidelidad −10 %" de la maqueta). */
const LOYALTY_10: SaleDiscountInput = {
  kind: 'loyalty',
  mode: 'percent',
  value: 1000,
  line: null,
  reason: 'cliente habitual',
};

describe('descuentos, cortes gratis, anulaciones y visor de auditoría (LP-10)', () => {
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
  let corte: Service;
  let fade: Service;
  let cera: Product;
  /** Cobros que las pruebas siguientes reutilizan (anular, auditoría). */
  let loyaltyRequest: CreateSaleRequest;
  let loyaltySale: Sale;
  let courtesySale: Sale;
  let managerSale: Sale;
  let raceSale: Sale;
  let deviceSale: Sale;

  /** Aserción del PIN del dueño firmada desde `client` (lleva el dispositivo si la petición lo tenía). */
  const assertionFrom = async (client: TestClient): Promise<string> => {
    const res = await client.post('/api/auth/pin/verify', { managerId, pin: PIN });
    expect(res.status).toBe(200);
    return pinVerifyResponseSchema.parse(await res.json()).assertion;
  };

  /** Corte (15 €) + Fade (18 €) en efectivo con 50 € entregados y sin descuentos; `overrides` cambia el resto. */
  const saleRequest = (
    pinAssertion: string,
    overrides: Partial<CreateSaleRequest> = {},
  ): CreateSaleRequest => ({
    id: randomUUID(),
    barberId: barbero.id,
    lines: [
      { kind: 'service', id: corte.id, quantity: 1 },
      { kind: 'service', id: fade.id, quantity: 1 },
    ],
    discounts: [],
    payment: { method: 'cash', tenderedCents: 5000 },
    expectedTotalCents: 3300,
    pinAssertion,
    ...overrides,
  });

  const createSale = async (
    client: TestClient,
    body: CreateSaleRequest,
  ): Promise<CreateSaleResponse> => {
    const res = await client.post('/api/sales', body);
    expect(res.status).toBe(201);
    return createSaleResponseSchema.parse(await res.json());
  };

  const voidSale = (client: TestClient, id: string, body: Record<string, unknown>) =>
    client.post(`/api/sales/${id}/void`, body);

  const voidedSale = async (res: Response): Promise<Sale> => {
    expect(res.status).toBe(200);
    return saleSchema.parse(await res.json());
  };

  const findSale = async (id: string): Promise<Sale> => {
    const res = await manager.get(`/api/sales/${id}`);
    expect(res.status).toBe(200);
    return saleSchema.parse(await res.json());
  };

  const daySalesOf = async (query = '') => {
    const res = await manager.get(`/api/sales/day${query}`);
    expect(res.status).toBe(200);
    return daySalesSchema.parse(await res.json());
  };

  const auditPage = async (query: string): Promise<AuditPage> => {
    const res = await manager.get(`/api/audit${query}`);
    expect(res.status, query).toBe(200);
    return auditPageSchema.parse(await res.json());
  };

  /** Todas las entradas de una consulta del visor, siguiendo `nextCursor` página a página. */
  const auditAll = async (params: Record<string, string>): Promise<AuditEntry[]> => {
    const entries: AuditEntry[] = [];
    let cursor: string | null = null;
    for (let pages = 0; pages < 100; pages += 1) {
      const query = new URLSearchParams({ limit: '100', ...params });
      if (cursor) query.set('cursor', cursor);
      const page = await auditPage(`?${query.toString()}`);
      entries.push(...page.entries);
      cursor = page.nextCursor;
      if (!cursor) return entries;
    }
    throw new Error('El visor no termina de paginar');
  };

  /** Ids de los eventos de la base (como owner) de lo más reciente a lo más antiguo, como los ordena el visor. */
  const newestFirst = (events: readonly { id: string }[]): string[] =>
    events.map((event) => event.id).toReversed();

  beforeAll(async () => {
    h = await createHarness('adjustments');
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
    expect(authorized.status).toBe(201);
    deviceId = deviceSummarySchema.parse(await authorized.json()).id;
    const deviceToken = setCookieFor(authorized, 'lp_device')?.value ?? '';
    // La sesión del manager queda sin la cookie del dispositivo (su aserción lleva deviceId null).
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
    const created = async (path: string, body: unknown) => {
      const res = await manager.post(path, body);
      expect(res.status).toBe(201);
      return res.json();
    };
    barbero = barberSchema.parse(
      await created('/api/barbers', {
        userId: barberUserId,
        displayName: 'Barbero 1',
        shortCode: 'B1',
        color: 'yellow',
      }),
    );
    corte = serviceSchema.parse(
      await created('/api/services', {
        nameEs: 'Corte',
        nameIt: 'Taglio',
        priceCents: 1500,
        durationMinutes: 30,
      }),
    );
    fade = serviceSchema.parse(
      await created('/api/services', {
        nameEs: 'Fade',
        nameIt: 'Fade',
        priceCents: 1800,
        durationMinutes: 40,
      }),
    );
    cera = productSchema.parse(
      await created('/api/products', { name: 'Cera mate', priceCents: 1200 }),
    );
  });

  afterAll(async () => {
    await appDb.close();
    await h.close();
  });

  describe('descuentos y cortes gratis', () => {
    it('fidelidad del 10 % sobre todo el cobro: Corte 15 € + Fade 18 € → 29,70 € (1,50 € y 1,80 € por línea), con quién lo autorizó y sale.discount_applied con el motivo', async () => {
      h.clock.advance(MINUTE);
      loyaltyRequest = saleRequest(await assertionFrom(manager), {
        discounts: [LOYALTY_10],
        payment: { method: 'cash', tenderedCents: 3000 },
        expectedTotalCents: 2970,
      });
      const { sale, idempotent } = await createSale(manager, loyaltyRequest);
      expect(idempotent).toBe(false);
      expect(sale).toMatchObject({
        cashDay: '2026-10-19',
        subtotalCents: 3300,
        discountCents: 330,
        totalCents: 2970,
        payment: { method: 'cash', amountCents: 2970, tenderedCents: 3000, changeCents: 30 },
        voided: null,
      });
      expect(
        sale.lines.map((line) => [
          line.name,
          line.lineTotalCents,
          line.discountCents,
          line.netCents,
        ]),
      ).toEqual([
        ['Corte', 1500, 150, 1350],
        ['Fade', 1800, 180, 1620],
      ]);
      expect(sale.discounts).toEqual([
        {
          id: expect.any(String),
          kind: 'loyalty',
          mode: 'percent',
          value: 1000,
          amountCents: 330,
          lineId: null,
          reason: 'cliente habitual',
          authorizedById: managerId,
          authorizedByName: 'Dueño Uno',
        },
      ]);
      loyaltySale = sale;

      // En la base: la fila del descuento con quién lo autorizó y el reparto en las líneas.
      expect(
        await h.owner.db.select().from(saleDiscounts).where(eq(saleDiscounts.saleId, sale.id)),
      ).toEqual([
        expect.objectContaining({
          shopId: h.shop.id,
          saleLineId: null,
          position: 0,
          kind: 'loyalty',
          mode: 'percent',
          value: 1000,
          amountCents: 330,
          reason: 'cliente habitual',
          authorizedByUserId: managerId,
        }),
      ]);
      const events = (await h.auditEvents()).filter((e) => e.entityId === sale.id);
      expect(events.map((e) => e.action).toSorted()).toEqual([
        'sale.created',
        'sale.discount_applied',
      ]);
      expect(events.find((e) => e.action === 'sale.created')).toMatchObject({
        after: { totalCents: 2970, discountCents: 330, method: 'cash', lines: 2 },
      });
      expect(events.find((e) => e.action === 'sale.discount_applied')).toMatchObject({
        actorUserId: managerId,
        entityType: 'sale',
        reason: 'cliente habitual',
        deviceId: null,
        after: {
          kind: 'loyalty',
          mode: 'percent',
          value: 1000,
          amountCents: 330,
          lineName: null,
          saleTotalCents: 2970,
        },
      });
    });

    it('corte gratis (cortesía del 100 %) en el servicio con un producto: el total es el producto, el corte sigue en el cobro a 0 € y deja sale.courtesy', async () => {
      h.clock.advance(MINUTE);
      const { sale } = await createSale(
        manager,
        saleRequest(await assertionFrom(manager), {
          lines: [
            { kind: 'service', id: corte.id, quantity: 1 },
            { kind: 'product', id: cera.id, quantity: 1 },
          ],
          discounts: [
            {
              kind: 'courtesy',
              mode: 'percent',
              value: 10000,
              line: { kind: 'service', id: corte.id },
              reason: 'cumpleaños',
            },
          ],
          payment: { method: 'card' },
          expectedTotalCents: 1200,
        }),
      );
      expect(sale).toMatchObject({
        subtotalCents: 2700,
        discountCents: 1500,
        totalCents: 1200,
        payment: { method: 'card', amountCents: 1200, tenderedCents: null, changeCents: null },
      });
      const [corteLine, ceraLine] = sale.lines;
      // Cuenta como corte: la línea del servicio está, con su precio, y se cobra a 0 €.
      expect(corteLine).toMatchObject({
        kind: 'service',
        serviceId: corte.id,
        quantity: 1,
        lineTotalCents: 1500,
        discountCents: 1500,
        netCents: 0,
      });
      expect(ceraLine).toMatchObject({ kind: 'product', discountCents: 0, netCents: 1200 });
      expect(sale.discounts).toEqual([
        expect.objectContaining({
          kind: 'courtesy',
          mode: 'percent',
          value: 10000,
          amountCents: 1500,
          lineId: corteLine?.id,
          reason: 'cumpleaños',
          authorizedById: managerId,
          authorizedByName: 'Dueño Uno',
        }),
      ]);
      courtesySale = sale;
      const events = (await h.auditEvents()).filter((e) => e.entityId === sale.id);
      expect(events.map((e) => e.action).toSorted()).toEqual(['sale.courtesy', 'sale.created']);
      expect(events.find((e) => e.action === 'sale.courtesy')).toMatchObject({
        actorUserId: managerId,
        entityType: 'sale',
        reason: 'cumpleaños',
        after: {
          kind: 'courtesy',
          mode: 'percent',
          value: 10000,
          amountCents: 1500,
          lineName: 'Corte',
          saleTotalCents: 1200,
        },
      });
    });

    it('un importe de manager no pasa de lo que vale su línea: 20 € sobre la cera de 12 € descuentan 12 €', async () => {
      h.clock.advance(MINUTE);
      const { sale } = await createSale(
        manager,
        saleRequest(await assertionFrom(manager), {
          lines: [
            { kind: 'service', id: fade.id, quantity: 1 },
            { kind: 'product', id: cera.id, quantity: 1 },
          ],
          discounts: [
            {
              kind: 'manager',
              mode: 'amount',
              value: 2000,
              line: { kind: 'product', id: cera.id },
              reason: 'cera defectuosa',
            },
          ],
          payment: { method: 'card' },
          expectedTotalCents: 1800,
        }),
      );
      expect(sale).toMatchObject({ subtotalCents: 3000, discountCents: 1200, totalCents: 1800 });
      expect(sale.lines.map((line) => [line.name, line.discountCents, line.netCents])).toEqual([
        ['Fade', 0, 1800],
        ['Cera mate', 1200, 0],
      ]);
      expect(sale.discounts).toEqual([
        expect.objectContaining({
          kind: 'manager',
          mode: 'amount',
          value: 2000,
          amountCents: 1200,
          lineId: sale.lines[1]?.id,
        }),
      ]);
      managerSale = sale;
      const event = (await h.auditEvents()).find(
        (e) => e.action === 'sale.discount_applied' && e.entityId === sale.id,
      );
      expect(event).toMatchObject({
        reason: 'cera defectuosa',
        after: {
          kind: 'manager',
          mode: 'amount',
          value: 2000,
          amountCents: 1200,
          lineName: 'Cera mate',
          saleTotalCents: 1800,
        },
      });
    });

    it('un total esperado que no resta el descuento → 409 total_mismatch con el total real; no se cobra', async () => {
      const request = saleRequest(await assertionFrom(manager), {
        discounts: [LOYALTY_10],
        expectedTotalCents: 3300,
      });
      const res = await manager.post('/api/sales', request);
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({
        error: 'total_mismatch',
        expectedTotalCents: 3300,
        totalCents: 2970,
      });
      expect((await manager.get(`/api/sales/${request.id}`)).status).toBe(404);
    });

    it('el mismo cobro con sus descuentos otra vez → idempotent: true; el mismo id con otro descuento, otro motivo o sin él → 409 sale_conflict', async () => {
      expect(
        await createSale(manager, {
          ...loyaltyRequest,
          pinAssertion: await assertionFrom(manager),
        }),
      ).toEqual({ sale: loyaltySale, idempotent: true });
      // El motivo llega recortado por el esquema: con espacios alrededor es el mismo contenido.
      const spaced = await createSale(manager, {
        ...loyaltyRequest,
        discounts: [{ ...LOYALTY_10, reason: '  cliente habitual ' }],
        pinAssertion: await assertionFrom(manager),
      });
      expect(spaced).toEqual({ sale: loyaltySale, idempotent: true });

      const assertion = await assertionFrom(manager);
      for (const body of [
        {
          ...loyaltyRequest,
          discounts: [{ ...LOYALTY_10, value: 2000 }],
          expectedTotalCents: 2640,
        },
        { ...loyaltyRequest, discounts: [{ ...LOYALTY_10, reason: 'otro motivo' }] },
        { ...loyaltyRequest, discounts: [], expectedTotalCents: 3300 },
      ]) {
        const res = await manager.post('/api/sales', { ...body, pinAssertion: assertion });
        expect(res.status).toBe(409);
        expect(await res.json()).toEqual({ error: 'sale_conflict' });
      }
      expect(
        await h.owner.db
          .select()
          .from(saleDiscounts)
          .where(eq(saleDiscounts.saleId, loyaltySale.id)),
      ).toHaveLength(1);
      expect(
        (await h.auditEvents()).filter(
          (e) => e.action === 'sale.discount_applied' && e.entityId === loyaltySale.id,
        ),
      ).toHaveLength(1);
    });

    it('dos descuentos en la misma línea o en todo el cobro, uno de una línea que no está, una cortesía sobre un producto o que no es el 100 %, más del 100 % o sin motivo → 400 validation', async () => {
      const assertion = await assertionFrom(manager);
      const onCorte: SaleDiscountInput = {
        kind: 'manager',
        mode: 'amount',
        value: 100,
        line: { kind: 'service', id: corte.id },
        reason: 'ajuste',
      };
      const invalid: SaleDiscountInput[][] = [
        [onCorte, { ...onCorte, value: 200 }],
        [LOYALTY_10, { ...LOYALTY_10, kind: 'manager' }],
        [{ ...onCorte, line: { kind: 'product', id: UNKNOWN_ID } }],
        [
          {
            kind: 'courtesy',
            mode: 'percent',
            value: 10000,
            line: { kind: 'product', id: cera.id },
            reason: 'regalo',
          },
        ],
        [{ kind: 'courtesy', mode: 'percent', value: 5000, line: onCorte.line, reason: 'regalo' }],
        [{ ...LOYALTY_10, value: 10001 }],
        [{ ...LOYALTY_10, reason: '   ' }],
      ];
      for (const discounts of invalid) {
        const request = saleRequest(assertion, {
          lines: [
            { kind: 'service', id: corte.id, quantity: 1 },
            { kind: 'service', id: fade.id, quantity: 1 },
            { kind: 'product', id: cera.id, quantity: 1 },
          ],
          discounts,
          expectedTotalCents: 0,
        });
        const res = await manager.post('/api/sales', request);
        expect(res.status, JSON.stringify(discounts)).toBe(400);
        expect(await res.json()).toMatchObject({ error: 'validation' });
        expect((await manager.get(`/api/sales/${request.id}`)).status).toBe(404);
      }
    });
  });

  describe('anulaciones', () => {
    it('anular con motivo y PIN: 200 con voided; /day lo sigue listando pero sus totales no lo cuentan (voidedCount y voidedCents aparte)', async () => {
      h.clock.advance(MINUTE);
      const before = await daySalesOf();
      expect(before.sales.map((s) => s.id)).toEqual([
        managerSale.id,
        courtesySale.id,
        loyaltySale.id,
      ]);
      expect(before.totals).toEqual({
        count: 3,
        cashCents: 2970,
        cardCents: 3000,
        totalCents: 5970,
        discountCents: 3030,
        voidedCount: 0,
        voidedCents: 0,
      });

      const sale = await voidedSale(
        await voidSale(manager, loyaltySale.id, {
          reason: ' cobro duplicado ',
          pinAssertion: await assertionFrom(manager),
        }),
      );
      const voided = {
        reason: 'cobro duplicado',
        byId: managerId,
        byName: 'Dueño Uno',
        occurredAt: toRomeIso(h.clock.now()),
        cashDay: '2026-10-19',
      };
      // El cobro no cambia: solo trae su anulación.
      expect(sale).toEqual({ ...loyaltySale, voided });
      expect(await findSale(loyaltySale.id)).toEqual(sale);

      const day = await daySalesOf();
      expect(day.sales.map((s) => [s.id, s.voided?.reason ?? null])).toEqual([
        [managerSale.id, null],
        [courtesySale.id, null],
        [loyaltySale.id, 'cobro duplicado'],
      ]);
      expect(day.totals).toEqual({
        count: 2,
        cashCents: 0,
        cardCents: 3000,
        totalCents: 3000,
        discountCents: 2700,
        voidedCount: 1,
        voidedCents: 2970,
      });

      // Una fila nueva con quién, desde dónde y cuándo, y su rastro en la auditoría.
      expect(
        await h.owner.db.select().from(saleVoids).where(eq(saleVoids.saleId, loyaltySale.id)),
      ).toEqual([
        expect.objectContaining({
          shopId: h.shop.id,
          reason: 'cobro duplicado',
          voidedByUserId: managerId,
          deviceId: null,
          createdByUserId: managerId,
          cashDay: '2026-10-19',
          occurredAt: h.clock.now(),
        }),
      ]);
      expect((await h.auditEvents()).find((e) => e.action === 'sale.voided')).toMatchObject({
        actorUserId: managerId,
        entityType: 'sale',
        entityId: loyaltySale.id,
        before: { totalCents: 2970, method: 'cash' },
        reason: 'cobro duplicado',
        deviceId: null,
      });
    });

    it('anular otra vez → 409 sale_voided; dos anulaciones a la vez → una 200 y otra 409, con una sola fila', async () => {
      const again = await voidSale(manager, loyaltySale.id, {
        reason: 'otra vez',
        pinAssertion: await assertionFrom(manager),
      });
      expect(again.status).toBe(409);
      expect(await again.json()).toEqual({ error: 'sale_voided' });

      h.clock.advance(MINUTE);
      const { sale } = await createSale(manager, saleRequest(await assertionFrom(manager)));
      const assertion = await assertionFrom(manager);
      const responses = await Promise.all([
        voidSale(manager, sale.id, { reason: 'doble toque', pinAssertion: assertion }),
        voidSale(manager, sale.id, { reason: 'doble toque', pinAssertion: assertion }),
      ]);
      expect(responses.map((r) => r.status).toSorted((a, b) => a - b)).toEqual([200, 409]);
      expect(await responses.find((r) => r.status === 409)?.json()).toEqual({
        error: 'sale_voided',
      });
      expect(
        await h.owner.db.select().from(saleVoids).where(eq(saleVoids.saleId, sale.id)),
      ).toHaveLength(1);
      expect(
        (await h.auditEvents()).filter((e) => e.action === 'sale.voided' && e.entityId === sale.id),
      ).toHaveLength(1);
      raceSale = sale;
    });

    it('aserción caducada o de otro sitio → 401 pin_assertion_invalid; cobro inexistente → 404; sin motivo, sin aserción o id que no es UUID → 400; nada se anula', async () => {
      const assertion = await assertionFrom(manager);
      h.clock.advance(3 * MINUTE);
      const expired = await voidSale(manager, courtesySale.id, {
        reason: 'error',
        pinAssertion: assertion,
      });
      expect(expired.status).toBe(401);
      expect(await expired.json()).toEqual({ error: 'pin_assertion_invalid', reason: 'invalid' });
      const fromDevice = await voidSale(manager, courtesySale.id, {
        reason: 'error',
        pinAssertion: await assertionFrom(caja),
      });
      expect(fromDevice.status).toBe(401);
      expect(await fromDevice.json()).toEqual({ error: 'pin_assertion_invalid', reason: 'device' });

      const fresh = await assertionFrom(manager);
      const missing = await voidSale(manager, UNKNOWN_ID, { reason: 'error', pinAssertion: fresh });
      expect(missing.status).toBe(404);
      expect(await missing.json()).toEqual({ error: 'not_found' });
      for (const [path, body] of [
        [`/api/sales/${courtesySale.id}/void`, { reason: '   ', pinAssertion: fresh }],
        [`/api/sales/${courtesySale.id}/void`, { reason: 'error' }],
        ['/api/sales/no-es-uuid/void', { reason: 'error', pinAssertion: fresh }],
      ] as const) {
        const res = await manager.post(path, body);
        expect(res.status, path).toBe(400);
        expect(await res.json()).toMatchObject({ error: 'validation' });
      }
      expect((await findSale(courtesySale.id)).voided).toBeNull();
    });

    it('un barbero no anula (403 forbidden); sin cookies, 401 device_required', async () => {
      const asBarber = await voidSale(barber, courtesySale.id, { reason: 'x', pinAssertion: 'x' });
      expect(asBarber.status).toBe(403);
      expect(await asBarber.json()).toEqual({ error: 'forbidden' });
      const anonymous = await voidSale(h.client(), courtesySale.id, {
        reason: 'x',
        pinAssertion: 'x',
      });
      expect(anonymous.status).toBe(401);
      expect(await anonymous.json()).toEqual({ error: 'device_required' });
    });

    it('el dispositivo de caja sin usuario cobra con un descuento y lo anula con la aserción de su PIN: todo lleva el dispositivo y ningún usuario de sesión', async () => {
      h.clock.advance(MINUTE);
      const { sale } = await createSale(
        caja,
        saleRequest(await assertionFrom(caja), {
          lines: [{ kind: 'service', id: fade.id, quantity: 1 }],
          discounts: [
            { kind: 'manager', mode: 'amount', value: 300, line: null, reason: 'promoción' },
          ],
          payment: { method: 'cash', tenderedCents: 1500 },
          expectedTotalCents: 1500,
        }),
      );
      expect(sale).toMatchObject({
        deviceId,
        deviceName: 'iPad caja',
        discountCents: 300,
        totalCents: 1500,
        payment: { method: 'cash', amountCents: 1500, tenderedCents: 1500, changeCents: 0 },
      });
      expect(sale.discounts).toEqual([
        expect.objectContaining({
          kind: 'manager',
          amountCents: 300,
          lineId: null,
          authorizedById: managerId,
          authorizedByName: 'Dueño Uno',
        }),
      ]);

      h.clock.advance(MINUTE);
      const result = await voidedSale(
        await voidSale(caja, sale.id, {
          reason: 'el cliente se arrepintió',
          pinAssertion: await assertionFrom(caja),
        }),
      );
      expect(result.voided).toEqual({
        reason: 'el cliente se arrepintió',
        byId: managerId,
        byName: 'Dueño Uno',
        occurredAt: toRomeIso(h.clock.now()),
        cashDay: '2026-10-19',
      });
      expect(
        await h.owner.db.select().from(saleVoids).where(eq(saleVoids.saleId, sale.id)),
      ).toEqual([
        expect.objectContaining({ voidedByUserId: managerId, deviceId, createdByUserId: null }),
      ]);
      expect(
        (await h.auditEvents()).find((e) => e.action === 'sale.voided' && e.entityId === sale.id),
      ).toMatchObject({
        actorUserId: managerId,
        deviceId,
        before: { totalCents: 1500, method: 'cash' },
        reason: 'el cliente se arrepintió',
      });
      deviceSale = sale;
    });

    it('nada se borra ni se cambia: ni el rol app (42501) ni el dueño de la base (LP001) tocan anulaciones, descuentos o cobros; el anulado sigue entero', async () => {
      const appCode = (statement: Parameters<typeof withShop>[2]) =>
        withShop(appDb.db, h.shop.id, statement).then(
          () => undefined,
          (error: unknown) => pgCode(error),
        );
      expect(
        await appCode((tx) => tx.delete(saleVoids).where(eq(saleVoids.saleId, loyaltySale.id))),
      ).toBe('42501');
      expect(
        await appCode((tx) =>
          tx
            .update(saleDiscounts)
            .set({ amountCents: 0 })
            .where(eq(saleDiscounts.saleId, loyaltySale.id)),
        ),
      ).toBe('42501');
      expect(await appCode((tx) => tx.delete(sales).where(eq(sales.id, loyaltySale.id)))).toBe(
        '42501',
      );
      const ownerCode = await h.owner.db
        .delete(saleVoids)
        .where(eq(saleVoids.saleId, loyaltySale.id))
        .then(
          () => undefined,
          (error: unknown) => pgCode(error),
        );
      expect(ownerCode).toBe('LP001');

      expect(await findSale(loyaltySale.id)).toEqual({
        ...loyaltySale,
        voided: expect.objectContaining({ reason: 'cobro duplicado' }),
      });
      expect(
        await h.owner.db.select().from(saleVoids).where(eq(saleVoids.shopId, h.shop.id)),
      ).toHaveLength(3);
    });

    it('un cobro de ayer no se anula: 409 sale_day_closed con el día del cobro, y sigue sin anular', async () => {
      h.clock.set(new Date('2026-10-19T21:50:00Z')); // 23:50 en Roma: todavía el 19
      const { sale } = await createSale(
        manager,
        saleRequest(await assertionFrom(manager), { payment: { method: 'card' } }),
      );
      expect(sale.cashDay).toBe('2026-10-19');
      h.clock.set(new Date('2026-10-19T22:10:00Z')); // 00:10 en Roma: ya es el 20
      const res = await voidSale(manager, sale.id, {
        reason: 'tarde',
        pinAssertion: await assertionFrom(manager),
      });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: 'sale_day_closed', cashDay: '2026-10-19' });
      expect((await findSale(sale.id)).voided).toBeNull();
      expect(
        (await h.auditEvents()).filter((e) => e.action === 'sale.voided' && e.entityId === sale.id),
      ).toHaveLength(0);
    });
  });

  describe('visor de auditoría', () => {
    it('type=discounts trae los descuentos con su motivo y quién; type=courtesy los cortes gratis; type=voids las anulaciones', async () => {
      const discounts = await auditPage('?type=discounts');
      expect(discounts.nextCursor).toBeNull();
      expect(discounts.entries.map((e) => [e.action, e.entityId])).toEqual([
        ['sale.discount_applied', deviceSale.id],
        ['sale.discount_applied', managerSale.id],
        ['sale.discount_applied', loyaltySale.id],
      ]);
      expect(discounts.entries.at(-1)).toEqual({
        id: expect.any(String),
        occurredAt: loyaltySale.occurredAt,
        action: 'sale.discount_applied',
        entityType: 'sale',
        entityId: loyaltySale.id,
        entityName: null,
        actorId: managerId,
        actorName: 'Dueño Uno',
        deviceId: null,
        deviceName: null,
        before: null,
        after: {
          kind: 'loyalty',
          mode: 'percent',
          value: 1000,
          amountCents: 330,
          lineName: null,
          saleTotalCents: 2970,
        },
        reason: 'cliente habitual',
      });
      expect(discounts.entries[0]).toMatchObject({
        actorName: 'Dueño Uno',
        deviceId,
        deviceName: 'iPad caja',
        reason: 'promoción',
        after: { kind: 'manager', mode: 'amount', value: 300, amountCents: 300, lineName: null },
      });

      const courtesy = await auditPage('?type=courtesy');
      expect(courtesy).toEqual({
        entries: [
          expect.objectContaining({
            action: 'sale.courtesy',
            entityId: courtesySale.id,
            actorName: 'Dueño Uno',
            reason: 'cumpleaños',
            after: {
              kind: 'courtesy',
              mode: 'percent',
              value: 10000,
              amountCents: 1500,
              lineName: 'Corte',
              saleTotalCents: 1200,
            },
          }),
        ],
        nextCursor: null,
      });

      const voids = await auditPage('?type=voids');
      expect(voids.entries.map((e) => [e.action, e.entityId, e.reason])).toEqual([
        ['sale.voided', deviceSale.id, 'el cliente se arrepintió'],
        ['sale.voided', raceSale.id, 'doble toque'],
        ['sale.voided', loyaltySale.id, 'cobro duplicado'],
      ]);
      expect(voids.entries[0]).toMatchObject({
        actorId: managerId,
        actorName: 'Dueño Uno',
        deviceName: 'iPad caja',
        before: { totalCents: 1500, method: 'cash' },
        after: null,
      });
    });

    it('type=prices tras cambiar el precio de un servicio: antes, después y el nombre del servicio', async () => {
      h.clock.advance(MINUTE);
      const res = await manager.request(`/api/services/${corte.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ priceCents: 1600 }),
      });
      expect(res.status).toBe(200);
      expect(await auditPage('?type=prices')).toEqual({
        entries: [
          expect.objectContaining({
            occurredAt: toRomeIso(h.clock.now()),
            action: 'service.price_changed',
            entityType: 'service',
            entityId: corte.id,
            entityName: 'Corte',
            actorId: managerId,
            actorName: 'Dueño Uno',
            before: { priceCents: 1500 },
            after: { priceCents: 1600 },
          }),
        ],
        nextCursor: null,
      });
    });

    it('type=pin tras un PIN mal tecleado en la caja: pin.failed sobre el manager (con su nombre) desde el dispositivo; los PIN correctos no entran', async () => {
      h.clock.advance(MINUTE);
      const res = await caja.post('/api/auth/pin/verify', { managerId, pin: WRONG_PIN });
      expect(res.status).toBe(401);
      expect(await auditPage('?type=pin')).toEqual({
        entries: [
          expect.objectContaining({
            action: 'pin.failed',
            entityType: 'user',
            entityId: managerId,
            entityName: 'Dueño Uno',
            actorId: null,
            actorName: null,
            deviceId,
            deviceName: 'iPad caja',
            reason: 'wrong_pin',
            after: { failures: 1, attemptsLeft: 4 },
          }),
        ],
        nextCursor: null,
      });
    });

    it('limit=2 devuelve nextCursor y la página siguiente no repite; todas las páginas juntas son la auditoría entera, de lo más reciente a lo más antiguo, con los nombres resueltos', async () => {
      const first = await auditPage('?limit=2');
      expect(first.entries).toHaveLength(2);
      expect(first.nextCursor).toEqual(expect.any(String));
      const second = await auditPage(
        `?limit=2&cursor=${encodeURIComponent(first.nextCursor ?? '')}`,
      );
      expect(second.entries).toHaveLength(2);
      const firstIds = first.entries.map((e) => e.id);
      expect(second.entries.filter((e) => firstIds.includes(e.id))).toEqual([]);

      const all = await auditAll({ limit: '7' });
      const expected = newestFirst(await h.auditEvents());
      expect(all.map((e) => e.id)).toEqual(expected);
      expect(new Set(expected).size).toBe(expected.length);
      expect(all.slice(0, 4).map((e) => e.id)).toEqual([
        ...firstIds,
        ...second.entries.map((e) => e.id),
      ]);
      // Un nombre por tipo de entidad, resueltos en lote; lo que no es una entidad con nombre, null.
      const nameOf = (action: string) => all.find((e) => e.action === action)?.entityName;
      expect(nameOf('device.authorized')).toBe('iPad caja');
      expect(nameOf('user.created')).toBe('Barbero 1');
      expect(nameOf('barber.created')).toBe('Barbero 1');
      expect(nameOf('service.price_changed')).toBe('Corte');
      expect(nameOf('product.created')).toBe('Cera mate');
      expect(nameOf('sale.created')).toBeNull();
    });

    it('actorId: solo lo que hizo esa persona (también combinado con el tipo)', async () => {
      const events = await h.auditEvents();
      const byBarber = newestFirst(events.filter((e) => e.actorUserId === barberUserId));
      expect(byBarber.length).toBeGreaterThan(0);
      const entries = await auditAll({ actorId: barberUserId });
      expect(entries.map((e) => e.id)).toEqual(byBarber);
      expect(entries.every((e) => e.actorName === 'Barbero 1')).toBe(true);
      expect((await auditPage(`?type=voids&actorId=${managerId}`)).entries).toHaveLength(3);
      expect(await auditPage(`?type=voids&actorId=${barberUserId}`)).toEqual({
        entries: [],
        nextCursor: null,
      });
    });

    it('from y to son días de caja de Roma, los dos incluidos', async () => {
      const events = await h.auditEvents();
      const startOf20 = cashDayRange('2026-10-20').start.getTime();
      const on19 = newestFirst(events.filter((e) => e.occurredAt.getTime() < startOf20));
      const on20 = newestFirst(events.filter((e) => e.occurredAt.getTime() >= startOf20));
      expect(on19.length).toBeGreaterThan(0);
      expect(on20.length).toBeGreaterThan(0);

      const from20 = await auditAll({ from: '2026-10-20' });
      expect(from20.map((e) => e.id)).toEqual(on20);
      expect(from20.every((e) => e.occurredAt.startsWith('2026-10-20T'))).toBe(true);
      const to19 = await auditAll({ to: '2026-10-19' });
      expect(to19.map((e) => e.id)).toEqual(on19);
      expect(to19.every((e) => e.occurredAt.startsWith('2026-10-19T'))).toBe(true);
      expect((await auditAll({ from: '2026-10-19', to: '2026-10-20' })).length).toBe(events.length);
      // El 19 entero con un tipo: las tres anulaciones. Un día sin nada, o un rango al revés: vacío.
      expect((await auditPage('?type=voids&from=2026-10-19&to=2026-10-19')).entries).toHaveLength(
        3,
      );
      expect(await auditPage('?from=2026-10-21')).toEqual({ entries: [], nextCursor: null });
      expect(await auditPage('?from=2026-10-20&to=2026-10-19')).toEqual({
        entries: [],
        nextCursor: null,
      });
    });

    it('cursor roto, tipo, día, límite o persona mal escritos → 400 validation; un barbero → 403; la caja sin sesión o sin cookies → 401', async () => {
      const cursorOf = (text: string) => Buffer.from(text, 'utf8').toString('base64url');
      for (const query of [
        '?cursor=roto',
        `?cursor=${cursorOf(`2026-02-30T08:00:00.000000Z|${UNKNOWN_ID}`)}`,
        `?cursor=${cursorOf(`2026-10-19T08:00:00Z|${UNKNOWN_ID}`)}`,
        `?cursor=${cursorOf('2026-10-19T08:00:00.000000Z|no-es-uuid')}`,
        `?cursor=${cursorOf(`2026-10-19T08:00:00.000000Z|${UNKNOWN_ID}|x`)}`,
        '?type=logins',
        '?from=2026-02-30',
        '?limit=0',
        '?limit=101',
        '?actorId=dueno',
      ]) {
        const res = await manager.get(`/api/audit${query}`);
        expect(res.status, query).toBe(400);
        expect(await res.json()).toMatchObject({ error: 'validation' });
      }
      const broken = await manager.get('/api/audit?cursor=roto');
      expect(await broken.json()).toMatchObject({
        issues: [expect.objectContaining({ path: ['cursor'] })],
      });
      // Un cursor bien formado vale aunque no venga de una página: devuelve lo anterior a ese punto.
      const before = await auditPage(
        `?cursor=${cursorOf(`2026-10-19T08:00:00.000000Z|${UNKNOWN_ID}`)}`,
      );
      expect(before).toEqual({ entries: [], nextCursor: null });

      const asBarber = await barber.get('/api/audit');
      expect(asBarber.status).toBe(403);
      expect(await asBarber.json()).toEqual({ error: 'forbidden' });
      for (const client of [caja, h.client()]) {
        const res = await client.get('/api/audit');
        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ error: 'unauthenticated' });
      }
    });
  });
});
