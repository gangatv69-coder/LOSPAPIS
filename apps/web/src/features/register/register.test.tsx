import {
  type AuthState,
  type Catalog,
  type CreateSaleRequest,
  createSaleRequestSchema,
  type DaySales,
  type ManagerSummary,
  type Sale,
} from '@los-papis/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Register } from '@/features/register/register';
import i18n from '@/i18n';
import { errorResponse, jsonResponse, mockFetch, type RouteHandler } from '@/test/fetch-mock';

const ANA_ID = '0f6a8d3e-3d0c-4a0b-9c3e-1b2c3d4e5f60';
const B1_ID = '3b241101-e2bb-4255-8caf-4136c566a962';
const B2_ID = '9f1b7c2d-4a5e-4f60-8b1c-2d3e4f5a6b7c';
const CLASSIC_ID = '5a2f1c3e-9b7d-4e21-8c6a-0f1e2d3c4b5a';
const WAX_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const LINE_IDS = [
  'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
  'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e',
] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const manager: AuthState = {
  bootstrapNeeded: false,
  user: {
    id: ANA_ID,
    username: 'ana',
    displayName: 'Ana Pérez',
    role: 'manager',
    totpEnabled: true,
    pinSet: true,
    mustChangePassword: false,
    recentTotp: false,
  },
  pendingTotp: false,
  device: null,
};

const managers: ManagerSummary[] = [
  { id: ANA_ID, displayName: 'Ana Pérez', initials: 'AP', pinSet: true, pinLocked: false },
];

const verified = {
  managerId: ANA_ID,
  managerName: 'Ana Pérez',
  assertion: 'firma.hmac',
  expiresAt: '2026-10-19T10:02:00+02:00',
};

const stamp = { createdAt: '2026-10-19T09:00:00+02:00', updatedAt: '2026-10-19T09:00:00+02:00' };

const catalog: Catalog = {
  services: [
    {
      id: CLASSIC_ID,
      nameEs: 'Corte clásico',
      nameIt: 'Taglio classico',
      priceCents: 1500,
      durationMinutes: 30,
      active: true,
      sortOrder: 10,
      ...stamp,
    },
  ],
  products: [
    {
      id: WAX_ID,
      name: 'Cera mate',
      priceCents: 1200,
      photoId: null,
      photoUrl: null,
      active: true,
      sortOrder: 10,
      ...stamp,
    },
  ],
  barbers: [
    {
      id: B1_ID,
      userId: 'c3d4e5f6-a7b8-4c9d-8e0f-2a3b4c5d6e7f',
      displayName: 'Barbero 1',
      shortCode: 'B1',
      color: 'yellow',
      photoId: null,
      photoUrl: null,
      active: true,
      sortOrder: 10,
      ...stamp,
    },
    {
      id: B2_ID,
      userId: 'd4e5f6a7-b8c9-4d0e-9f1a-3b4c5d6e7f8a',
      displayName: 'Barbero 2',
      shortCode: 'B2',
      color: 'blue',
      photoId: null,
      photoUrl: null,
      active: true,
      sortOrder: 20,
      ...stamp,
    },
  ],
};

const emptyDay: DaySales = {
  day: '2026-10-19',
  sales: [],
  totals: {
    count: 0,
    cashCents: 0,
    cardCents: 0,
    totalCents: 0,
    discountCents: 0,
    voidedCount: 0,
    voidedCents: 0,
  },
};

/** Lo que guardaría la API para esa petición (precios de la base, vuelto calculado). */
function saleFor(body: CreateSaleRequest, catalogNow: Catalog = catalog): Sale {
  const lines = body.lines.map((line, index) => {
    const price =
      line.kind === 'service'
        ? (catalogNow.services.find((s) => s.id === line.id)?.priceCents ?? 0)
        : (catalogNow.products.find((p) => p.id === line.id)?.priceCents ?? 0);
    return {
      id: LINE_IDS[index] ?? LINE_IDS[0],
      kind: line.kind,
      serviceId: line.kind === 'service' ? line.id : null,
      productId: line.kind === 'product' ? line.id : null,
      name: line.kind === 'service' ? 'Corte clásico' : 'Cera mate',
      unitPriceCents: price,
      quantity: line.quantity,
      lineTotalCents: price * line.quantity,
      discountCents: 0,
      netCents: price * line.quantity,
    };
  });
  const total = lines.reduce((sum, line) => sum + line.lineTotalCents, 0);
  const tendered = body.payment.method === 'cash' ? (body.payment.tenderedCents ?? total) : null;
  return {
    id: body.id,
    cashDay: '2026-10-19',
    occurredAt: '2026-10-19T18:52:00+02:00',
    barberId: body.barberId,
    barberName: 'Barbero 1',
    managerId: ANA_ID,
    managerName: 'Ana Pérez',
    deviceId: null,
    deviceName: null,
    subtotalCents: total,
    discountCents: 0,
    totalCents: total,
    payment: {
      method: body.payment.method,
      amountCents: total,
      tenderedCents: tendered,
      changeCents: tendered === null ? null : tendered - total,
    },
    lines,
    discounts: [],
    receiptNumber: null,
    voided: null,
  };
}

const parseBody = (init: RequestInit | undefined): CreateSaleRequest =>
  createSaleRequestSchema.parse(JSON.parse(String(init?.body)));

/** POST /api/sales que responde 201 con el cobro guardado. */
const saleCreated: RouteHandler = (init) =>
  jsonResponse({ sale: saleFor(parseBody(init)), idempotent: false }, 201);

function commonRoutes(): Record<string, RouteHandler> {
  return {
    'GET /api/auth/me': () => jsonResponse(manager),
    'GET /api/catalog': () => jsonResponse(catalog),
    'GET /api/sales/day': () => jsonResponse(emptyDay),
    'GET /api/auth/managers': () => jsonResponse(managers),
    'POST /api/auth/pin/verify': () => jsonResponse(verified),
  };
}

function renderRegister() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <Register />
    </QueryClientProvider>,
  );
}

type User = ReturnType<typeof userEvent.setup>;

/** B1, Corte clásico ×2 y Cera mate (42,00 €), 50 € en efectivo. */
async function fillMockupCart(user: User) {
  await user.click(await screen.findByRole('button', { name: 'Barbero 1' }));
  const tile = screen.getByTestId('catalog-service');
  await user.click(tile);
  await user.click(tile);
  await user.click(screen.getByTestId('catalog-preview-tab-products'));
  await user.click(screen.getByTestId('catalog-product'));
  expect(screen.getByTestId('cart-total')).toHaveTextContent('42,00 €');
  await user.click(screen.getByTestId('tender-5000'));
  expect(screen.getByTestId('cart-change')).toHaveTextContent('8,00 €');
}

/** "Cobrar" → diálogo del PIN (un solo manager: preseleccionado) → 1 2 3 4 5 6. */
async function chargeWithPin(user: User) {
  await user.click(screen.getByTestId('charge'));
  const dialog = await screen.findByRole('dialog', { name: '¿Quién cobra?' });
  expect(within(dialog).getByText('Cobro de 42,00 €')).toBeInTheDocument();
  await within(dialog).findAllByTestId('pin-manager');
  for (const digit of '123456') {
    await user.click(within(dialog).getByRole('button', { name: digit }));
  }
}

const postedSales = (calls: { method: string; path: string; body: unknown }[]) =>
  calls.filter((call) => call.method === 'POST' && call.path === '/api/sales');

describe('Register', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('es');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('cobra: barbero, dos cortes y una cera, 50 € en efectivo, PIN y registratore', async () => {
    const user = userEvent.setup();
    const { calls } = mockFetch({ ...commonRoutes(), 'POST /api/sales': saleCreated });
    renderRegister();

    await fillMockupCart(user);
    const lines = screen.getAllByTestId('cart-line');
    expect(lines.map((line) => line.dataset.name)).toEqual(['Corte clásico', 'Cera mate']);
    expect(within(lines[0] as HTMLElement).getByTestId('cart-line-quantity')).toHaveTextContent(
      '2',
    );
    expect(screen.getByTestId('catalog-product')).toHaveAttribute('data-quantity', '1');

    await chargeWithPin(user);

    const done = await screen.findByTestId('sale-done');
    expect(within(done).getByTestId('sale-done-fiscal')).toHaveTextContent(
      'Registratore: 42,00 € · EFECTIVO',
    );
    expect(within(done).getByTestId('sale-done-change')).toHaveTextContent('8,00 €');

    const [post] = postedSales(calls);
    expect(post?.body).toMatchObject({
      barberId: B1_ID,
      lines: [
        { kind: 'service', id: CLASSIC_ID, quantity: 2 },
        { kind: 'product', id: WAX_ID, quantity: 1 },
      ],
      payment: { method: 'cash', tenderedCents: 5000 },
      expectedTotalCents: 4200,
      pinAssertion: 'firma.hmac',
    });
    expect((post?.body as CreateSaleRequest | undefined)?.id).toMatch(UUID);

    // "Nuevo cobro": carrito vacío con id nuevo.
    await user.click(within(done).getByTestId('new-sale'));
    expect(screen.getByTestId('cart-empty')).toBeInTheDocument();
    expect(screen.getByTestId('cart-total')).toHaveTextContent('0,00 €');
  });

  it('si la red falla, "Reintentar" repite la MISMA petición (mismo id y misma aserción)', async () => {
    const user = userEvent.setup();
    let posts = 0;
    const { calls } = mockFetch({
      ...commonRoutes(),
      'POST /api/sales': (init) => {
        posts += 1;
        if (posts === 1) throw new TypeError('Failed to fetch');
        return saleCreated(init);
      },
    });
    renderRegister();

    await fillMockupCart(user);
    await chargeWithPin(user);

    const failed = await screen.findByTestId('sale-failed');
    expect(failed).toHaveTextContent('No se ha podido guardar el cobro');
    // Mientras espera el reintento, el carrito no se toca.
    expect(screen.getByTestId('charge')).toBeDisabled();
    expect(screen.getByTestId('catalog-product')).toBeDisabled();

    await user.click(screen.getByTestId('retry'));

    await screen.findByTestId('sale-done');
    const bodies = postedSales(calls).map((call) => call.body as CreateSaleRequest);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[0]?.id).toMatch(UUID);
  });

  it('con pin_assertion_invalid vuelve a pedir el PIN y repite el cobro con el mismo id', async () => {
    const user = userEvent.setup();
    let posts = 0;
    const { calls } = mockFetch({
      ...commonRoutes(),
      'POST /api/sales': (init) => {
        posts += 1;
        return posts === 1 ? errorResponse(401, 'pin_assertion_invalid') : saleCreated(init);
      },
    });
    renderRegister();

    await fillMockupCart(user);
    await chargeWithPin(user);

    // La API rechaza la firma: el diálogo vuelve a pedir el PIN (sin cobro hecho) y se firma de nuevo.
    await vi.waitFor(() => expect(postedSales(calls)).toHaveLength(1));
    expect(screen.queryByTestId('sale-done')).toBeNull();
    await chargeWithPinAgain(user);

    await screen.findByTestId('sale-done');
    const bodies = postedSales(calls).map((call) => call.body as CreateSaleRequest);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]?.id).toBe(bodies[0]?.id);
  });

  it('con total_mismatch refresca el catálogo y el carrito toma los precios nuevos', async () => {
    const user = userEvent.setup();
    // El precio sube en la base justo antes de cobrar: la API lo rechaza y la caja relee el catálogo.
    let priceChanged = false;
    const dearer: Catalog = {
      ...catalog,
      services: catalog.services.map((service) => ({ ...service, priceCents: 1600 })),
    };
    mockFetch({
      ...commonRoutes(),
      'GET /api/catalog': () => jsonResponse(priceChanged ? dearer : catalog),
      'POST /api/sales': () => {
        priceChanged = true;
        return errorResponse(409, 'total_mismatch', {
          expectedTotalCents: 4200,
          totalCents: 4400,
        });
      },
    });
    renderRegister();

    await fillMockupCart(user);
    await chargeWithPin(user);

    await vi.waitFor(() => expect(screen.getByTestId('cart-total')).toHaveTextContent('44,00 €'));
    expect(screen.queryByTestId('sale-done')).toBeNull();
    expect(screen.getByTestId('charge')).toHaveTextContent('Cobrar 44,00 €');
  });
});

/** El diálogo ya está abierto otra vez: solo el PIN. */
async function chargeWithPinAgain(user: User) {
  const dialog = await screen.findByRole('dialog', { name: '¿Quién cobra?' });
  await within(dialog).findAllByTestId('pin-manager');
  for (const digit of '123456') {
    await user.click(within(dialog).getByRole('button', { name: digit }));
  }
}
