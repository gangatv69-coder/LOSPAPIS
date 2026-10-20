import { randomUUID } from 'node:crypto';

import { createDb, type DbHandle, eq, saleTips, withShop } from '@los-papis/db';
import {
  auditPageSchema,
  type Barber,
  barberSchema,
  type CreateSaleRequest,
  changeAfterTip,
  createSaleResponseSchema,
  type DaySales,
  daySalesSchema,
  deviceSummarySchema,
  pinVerifyResponseSchema,
  type Sale,
  type Service,
  saleSchema,
  serviceSchema,
  terminalCents,
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

/** SQLSTATE del error de PostgreSQL, directo o envuelto por Drizzle en `cause`. */
const pgCode = (error: unknown): string | undefined => {
  if (typeof error !== 'object' || error === null) return undefined;
  const { code, cause } = error as { code?: unknown; cause?: unknown };
  return typeof code === 'string' ? code : pgCode(cause);
};

describe('propinas para los barberos (LP-23)', () => {
  let h: Harness;
  let appDb: DbHandle;
  /** Sesión del manager sin cookie de dispositivo (el PC de la oficina). */
  let manager: TestClient;
  let managerId = '';
  /** Solo la cookie del dispositivo de caja (el iPad sin nadie dentro). */
  let caja: TestClient;
  let deviceId = '';
  let barber: TestClient;
  let barbero: Barber;
  let corte: Service;
  let fade: Service;
  /** Cobro en efectivo con "quédate el vuelto" (lo reutilizan las pruebas siguientes). */
  let cashSale: Sale;

  const assertionFrom = async (client: TestClient): Promise<string> => {
    const res = await client.post('/api/auth/pin/verify', { managerId, pin: PIN });
    expect(res.status).toBe(200);
    return pinVerifyResponseSchema.parse(await res.json()).assertion;
  };

  /** Corte (15 €) + Fade (18 €) = 33 € en efectivo con 50 € entregados; `overrides` cambia el resto. */
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

  const createSale = async (client: TestClient, body: CreateSaleRequest): Promise<Sale> => {
    const res = await client.post('/api/sales', body);
    expect(res.status).toBe(201);
    return createSaleResponseSchema.parse(await res.json()).sale;
  };

  const tip = (client: TestClient, id: string, body: Record<string, unknown>) =>
    client.post(`/api/sales/${id}/tip`, body);

  const tipped = async (res: Response): Promise<Sale> => {
    expect(res.status).toBe(200);
    return saleSchema.parse(await res.json());
  };

  const daySales = async (): Promise<DaySales> => {
    const res = await manager.get('/api/sales/day');
    expect(res.status).toBe(200);
    return daySalesSchema.parse(await res.json());
  };

  const tipRows = (saleId: string) =>
    h.owner.db.select().from(saleTips).where(eq(saleTips.saleId, saleId));

  beforeAll(async () => {
    h = await createHarness('tips');
    appDb = createDb(inject('db').appUrl, { max: 1 });
    manager = h.client();
    managerId = (await bootstrapManager(manager)).user?.id ?? '';
    await enableTotp(manager, h.clock);
    expect((await manager.post('/api/auth/pin', { pin: PIN })).status).toBe(200);
    const authorized = await manager.post('/api/devices/authorize', {
      name: 'iPad caja',
      kind: 'ipad',
    });
    expect(authorized.status).toBe(201);
    deviceId = deviceSummarySchema.parse(await authorized.json()).id;
    const deviceToken = setCookieFor(authorized, 'lp_device')?.value ?? '';
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
    barber = h.client();
    await login(barber, 'barbero1', account.temporaryPassword);
    const created = async (path: string, body: unknown) => {
      const res = await manager.post(path, body);
      expect(res.status).toBe(201);
      return res.json();
    };
    barbero = barberSchema.parse(
      await created('/api/barbers', {
        userId: account.user.id,
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
  });

  afterAll(async () => {
    await appDb.close();
    await h.close();
  });

  it('"quédate el vuelto": la aserción del cobro firma también la propina; es del barbero del cobro, el cobro no cambia y queda sale.tip_recorded', async () => {
    const assertion = await assertionFrom(manager);
    const sale = await createSale(manager, saleRequest(assertion));
    expect(sale.payment).toEqual({
      method: 'cash',
      amountCents: 3300,
      tenderedCents: 5000,
      changeCents: 1700,
    });
    expect(sale.tip).toBeNull();

    h.clock.advance(MINUTE);
    const result = await tipped(
      await tip(manager, sale.id, { amountCents: 1700, method: 'cash', pinAssertion: assertion }),
    );
    expect(result.tip).toEqual({
      amountCents: 1700,
      method: 'cash',
      barberId: barbero.id,
      barberName: 'Barbero 1',
      byId: managerId,
      byName: 'Dueño Uno',
      occurredAt: toRomeIso(h.clock.now()),
    });
    // El cobro (lo que marca el registratore) sigue igual; el vuelto que se da de verdad baja a 0.
    expect({ ...result, tip: null }).toEqual(sale);
    expect(changeAfterTip(result)).toBe(0);
    expect(terminalCents(result)).toBeNull();
    expect(await tipRows(sale.id)).toEqual([
      expect.objectContaining({
        barberId: barbero.id,
        amountCents: 1700,
        method: 'cash',
        recordedByUserId: managerId,
        deviceId: null,
        createdByUserId: managerId,
        cashDay: sale.cashDay,
      }),
    ]);
    expect(
      (await h.auditEvents()).find(
        (e) => e.action === 'sale.tip_recorded' && e.entityId === sale.id,
      ),
    ).toMatchObject({
      actorUserId: managerId,
      entityType: 'sale',
      after: { amountCents: 1700, method: 'cash', barberId: barbero.id, barberName: 'Barbero 1' },
    });
    cashSale = result;
  });

  it('una sola propina por cobro: otra → 409 tip_recorded; dos a la vez → una 200 y otra 409, con una sola fila', async () => {
    const again = await tip(manager, cashSale.id, {
      amountCents: 100,
      method: 'cash',
      pinAssertion: await assertionFrom(manager),
    });
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: 'tip_recorded' });

    const assertion = await assertionFrom(manager);
    const sale = await createSale(manager, saleRequest(assertion, { payment: { method: 'card' } }));
    const body = { amountCents: 200, method: 'card', pinAssertion: assertion };
    const results = await Promise.all([tip(manager, sale.id, body), tip(caja, sale.id, body)]);
    const statuses = results.map((res) => res.status).sort();
    // La de la caja lleva una aserción de otro sitio (401) o pierde la carrera: nunca hay dos filas.
    expect(statuses[0]).toBe(200);
    expect(await tipRows(sale.id)).toHaveLength(1);
    const [winner] = results.filter((res) => res.status === 200);
    const card = saleSchema.parse(await winner?.json());
    expect(terminalCents(card)).toBe(3500);

    const raced = await createSale(manager, saleRequest(await assertionFrom(manager)));
    const fresh = await assertionFrom(manager);
    const both = await Promise.all([
      tip(manager, raced.id, { amountCents: 300, method: 'cash', pinAssertion: fresh }),
      tip(manager, raced.id, { amountCents: 500, method: 'cash', pinAssertion: fresh }),
    ]);
    expect(both.map((res) => res.status).sort()).toEqual([200, 409]);
    expect(await tipRows(raced.id)).toHaveLength(1);
  });

  it('GET /api/sales/day: los totales del cobro no cuentan las propinas; van aparte (efectivo, tarjeta y por barbero) y las de un cobro anulado no cuentan', async () => {
    const before = await daySales();
    // Un cobro con propina que después se anula: ni el cobro ni su propina cuentan.
    const assertion = await assertionFrom(manager);
    const doomed = await createSale(manager, saleRequest(assertion));
    await tipped(
      await tip(manager, doomed.id, { amountCents: 900, method: 'cash', pinAssertion: assertion }),
    );
    const voided = await manager.post(`/api/sales/${doomed.id}/void`, {
      reason: 'cobro duplicado',
      pinAssertion: await assertionFrom(manager),
    });
    expect(voided.status).toBe(200);

    const day = await daySales();
    const counted = day.sales.filter((sale) => !sale.voided);
    expect(day.totals.totalCents).toBe(counted.reduce((sum, sale) => sum + sale.totalCents, 0));
    expect(day.totals.cashCents + day.totals.cardCents).toBe(day.totals.totalCents);
    expect(day.totals).toMatchObject({ voidedCount: before.totals.voidedCount + 1 });
    const tipsOf = (method: 'cash' | 'card') =>
      counted
        .filter((sale) => sale.tip?.method === method)
        .reduce((sum, sale) => sum + (sale.tip?.amountCents ?? 0), 0);
    expect(day.tips).toEqual({
      count: counted.filter((sale) => sale.tip).length,
      totalCents: tipsOf('cash') + tipsOf('card'),
      cashCents: tipsOf('cash'),
      cardCents: tipsOf('card'),
      byBarber: [
        {
          barberId: barbero.id,
          barberName: 'Barbero 1',
          count: counted.filter((sale) => sale.tip).length,
          totalCents: tipsOf('cash') + tipsOf('card'),
        },
      ],
    });
    // La propina del anulado sigue en el libro (y en el cobro), solo deja de contar.
    expect(day.sales.find((sale) => sale.id === doomed.id)?.tip?.amountCents).toBe(900);
    expect(day.tips.totalCents).toBe(before.tips.totalCents);
  });

  it('aserción caducada → 401; cobro inexistente → 404; importe 0, de más de 100 €, con decimales o forma desconocida → 400; un cobro anulado → 409 sale_voided', async () => {
    const assertion = await assertionFrom(manager);
    const sale = await createSale(manager, saleRequest(assertion));
    h.clock.advance(3 * MINUTE);
    const expired = await tip(manager, sale.id, {
      amountCents: 200,
      method: 'cash',
      pinAssertion: assertion,
    });
    expect(expired.status).toBe(401);
    expect(await expired.json()).toEqual({ error: 'pin_assertion_invalid', reason: 'invalid' });

    const fresh = await assertionFrom(manager);
    const missing = await tip(manager, UNKNOWN_ID, {
      amountCents: 200,
      method: 'cash',
      pinAssertion: fresh,
    });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'not_found' });
    for (const body of [
      { amountCents: 0, method: 'cash', pinAssertion: fresh },
      { amountCents: 10_001, method: 'cash', pinAssertion: fresh },
      { amountCents: 1.5, method: 'cash', pinAssertion: fresh },
      { amountCents: 200, method: 'bizum', pinAssertion: fresh },
      { amountCents: 200, method: 'cash' },
    ]) {
      const res = await tip(manager, sale.id, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(await res.json()).toMatchObject({ error: 'validation' });
    }
    expect(await tipRows(sale.id)).toEqual([]);

    expect(
      (
        await manager.post(`/api/sales/${sale.id}/void`, {
          reason: 'error',
          pinAssertion: fresh,
        })
      ).status,
    ).toBe(200);
    const onVoided = await tip(manager, sale.id, {
      amountCents: 200,
      method: 'cash',
      pinAssertion: fresh,
    });
    expect(onVoided.status).toBe(409);
    expect(await onVoided.json()).toEqual({ error: 'sale_voided' });
  });

  it('un barbero no apunta propinas (403); sin cookies, 401; el dispositivo de caja sin usuario sí, con la aserción de su PIN', async () => {
    const asBarber = await tip(barber, cashSale.id, {
      amountCents: 100,
      method: 'cash',
      pinAssertion: 'x',
    });
    expect(asBarber.status).toBe(403);
    expect(await asBarber.json()).toEqual({ error: 'forbidden' });
    const anonymous = await tip(h.client(), cashSale.id, {
      amountCents: 100,
      method: 'cash',
      pinAssertion: 'x',
    });
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toEqual({ error: 'device_required' });

    const assertion = await assertionFrom(caja);
    const sale = await createSale(caja, saleRequest(assertion, { payment: { method: 'card' } }));
    // Desde la caja, la aserción de la sesión del manager no vale (es de otro sitio).
    const fromSession = await tip(caja, sale.id, {
      amountCents: 200,
      method: 'card',
      pinAssertion: await assertionFrom(manager),
    });
    expect(fromSession.status).toBe(401);
    expect(await fromSession.json()).toEqual({ error: 'pin_assertion_invalid', reason: 'device' });
    const result = await tipped(
      await tip(caja, sale.id, { amountCents: 200, method: 'card', pinAssertion: assertion }),
    );
    expect(result.tip).toMatchObject({ amountCents: 200, method: 'card', byId: managerId });
    expect(await tipRows(sale.id)).toEqual([
      expect.objectContaining({ deviceId, createdByUserId: null, recordedByUserId: managerId }),
    ]);
  });

  it('nada se borra ni se cambia: ni el rol app (42501) ni el dueño de la base (LP001) tocan sale_tips', async () => {
    const appCode = await withShop(appDb.db, h.shop.id, (tx) =>
      tx.update(saleTips).set({ amountCents: 1 }).where(eq(saleTips.saleId, cashSale.id)),
    ).then(
      () => undefined,
      (error: unknown) => pgCode(error),
    );
    expect(appCode).toBe('42501');
    const ownerCode = await h.owner.db
      .delete(saleTips)
      .where(eq(saleTips.saleId, cashSale.id))
      .then(
        () => undefined,
        (error: unknown) => pgCode(error),
      );
    expect(ownerCode).toBe('LP001');
    expect((await tipRows(cashSale.id))[0]?.amountCents).toBe(1700);
  });

  it('el visor de auditoría filtra las propinas (type=tips), de la más reciente a la más antigua', async () => {
    const res = await manager.get('/api/audit?type=tips');
    expect(res.status).toBe(200);
    const page = auditPageSchema.parse(await res.json());
    expect(page.entries.length).toBeGreaterThanOrEqual(4);
    expect(new Set(page.entries.map((entry) => entry.action))).toEqual(
      new Set(['sale.tip_recorded']),
    );
    expect(page.entries.at(-1)).toMatchObject({
      entityId: cashSale.id,
      actorName: 'Dueño Uno',
      after: { amountCents: 1700, method: 'cash', barberName: 'Barbero 1' },
    });
  });

  it('un cobro de ayer ya no admite propina: 409 sale_day_closed con el día del cobro', async () => {
    h.clock.set(new Date('2026-10-19T21:50:00Z')); // 23:50 en Roma: todavía el 19
    const sale = await createSale(
      manager,
      saleRequest(await assertionFrom(manager), { payment: { method: 'card' } }),
    );
    expect(sale.cashDay).toBe('2026-10-19');
    h.clock.set(new Date('2026-10-19T22:10:00Z')); // 00:10 en Roma: ya es el 20
    const res = await tip(manager, sale.id, {
      amountCents: 200,
      method: 'card',
      pinAssertion: await assertionFrom(manager),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'sale_day_closed', cashDay: '2026-10-19' });
    expect(await tipRows(sale.id)).toEqual([]);
  });
});
