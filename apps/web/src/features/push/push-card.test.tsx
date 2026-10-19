import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PushCard } from '@/features/push/push-card';
import i18n from '@/i18n';

const VAPID_KEY =
  'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const WINDOWS_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

const ENABLE_LABEL = 'Activar avisos en este dispositivo';

const fetchMock = vi.fn<typeof fetch>();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Responde según la ruta pedida; lo que no esté en `routes` devuelve 404. */
function routeFetch(routes: Record<string, (init?: RequestInit) => Response>) {
  fetchMock.mockImplementation(async (input, init) => {
    const path =
      typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
    const handler = routes[path];
    return handler ? handler(init) : new Response('not found', { status: 404 });
  });
}

/** Propiedades del navigator real de jsdom que se sustituyen en cada prueba (se borran en afterEach). */
const navigatorOverrides = ['userAgent', 'serviceWorker'] as const;

function overrideNavigator(props: { userAgent?: string; serviceWorker?: unknown }) {
  for (const [key, value] of Object.entries(props)) {
    Object.defineProperty(navigator, key, { value, configurable: true, writable: true });
  }
}

type FakeSubscription = Pick<PushSubscription, 'endpoint' | 'toJSON' | 'unsubscribe'>;

function fakeSubscription(endpoint: string): FakeSubscription {
  return {
    endpoint,
    toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh: 'p256dh', auth: 'auth' } }),
    unsubscribe: vi.fn(async () => true),
  };
}

/** Navegador con soporte completo: PushManager, Notification y un service worker listo. */
function supportedBrowser(options: {
  permission?: NotificationPermission;
  current?: FakeSubscription | null;
  subscribe?: () => Promise<FakeSubscription>;
}) {
  vi.stubGlobal('PushManager', class {});
  vi.stubGlobal('Notification', {
    permission: options.permission ?? 'default',
    requestPermission: vi.fn(async () => 'granted' as NotificationPermission),
  });
  overrideNavigator({
    userAgent: WINDOWS_UA,
    serviceWorker: {
      ready: Promise.resolve({
        pushManager: {
          getSubscription: async () => options.current ?? null,
          subscribe: options.subscribe ?? (async () => fakeSubscription('https://push.example/x')),
        },
      }),
    },
  });
}

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <PushCard />
    </QueryClientProvider>,
  );
}

describe('PushCard', () => {
  beforeEach(async () => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    routeFetch({ '/api/push/config': () => jsonResponse({ enabled: true, publicKey: VAPID_KEY }) });
    await i18n.changeLanguage('es');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const key of navigatorOverrides) Reflect.deleteProperty(navigator, key);
  });

  it('sin soporte (jsdom tal cual) explica que este navegador no permite avisos', async () => {
    renderCard();

    expect(screen.getByText('Avisos en este dispositivo')).toBeInTheDocument();
    expect(screen.getByText(/Este navegador no permite avisos push/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: ENABLE_LABEL })).not.toBeInTheDocument();
  });

  it('en un iPhone sin instalar enseña los tres pasos de "Añadir a pantalla de inicio"', () => {
    overrideNavigator({ userAgent: IPHONE_UA });
    renderCard();

    const steps = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(steps.map((li) => li.textContent)).toEqual([
      'En Safari, toca Compartir (el cuadrado con la flecha).',
      'Elige «Añadir a pantalla de inicio».',
      'Abre LOS PAPIS desde el icono nuevo y vuelve a Ajustes.',
    ]);
    expect(screen.queryByRole('button', { name: ENABLE_LABEL })).not.toBeInTheDocument();
  });

  it('con soporte, permiso por decidir y servidor configurado ofrece el botón de activar', async () => {
    supportedBrowser({});
    renderCard();

    const button = await screen.findByRole('button', { name: ENABLE_LABEL });
    await vi.waitFor(() => expect(button).toBeEnabled());
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/push/config',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('con el servidor sin claves VAPID avisa y deja el botón deshabilitado', async () => {
    supportedBrowser({});
    routeFetch({ '/api/push/config': () => jsonResponse({ enabled: false }) });
    renderCard();

    expect(
      await screen.findByText(/El servidor no tiene configurados los avisos push/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: ENABLE_LABEL })).toBeDisabled();
  });

  it('si los avisos están bloqueados lo dice y no ofrece activar', () => {
    supportedBrowser({ permission: 'denied' });
    renderCard();

    expect(screen.getByRole('alert')).toHaveTextContent(/Los avisos están bloqueados/);
    expect(screen.queryByRole('button', { name: ENABLE_LABEL })).not.toBeInTheDocument();
  });

  it('activar pide permiso, se suscribe con la clave VAPID y registra la suscripción en la API', async () => {
    const user = userEvent.setup();
    const subscribe = vi.fn(async () => fakeSubscription('https://push.example/nueva'));
    supportedBrowser({ subscribe });
    const posted: unknown[] = [];
    routeFetch({
      '/api/push/config': () => jsonResponse({ enabled: true, publicKey: VAPID_KEY }),
      '/api/push/subscriptions': (init) => {
        posted.push(JSON.parse(String(init?.body)));
        return jsonResponse({ subscribed: true, device: 'PC' }, 201);
      },
      '/api/push/test': () =>
        jsonResponse({ scheduledAt: '2026-10-19T12:00:10+02:00', delaySeconds: 10 }, 202),
    });
    renderCard();

    const button = await screen.findByRole('button', { name: ENABLE_LABEL });
    await vi.waitFor(() => expect(button).toBeEnabled());
    await user.click(button);

    expect(await screen.findByText('Avisos activos en este dispositivo (PC).')).toBeInTheDocument();
    expect(Notification.requestPermission).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledWith(
      expect.objectContaining({
        userVisibleOnly: true,
        applicationServerKey: expect.any(Uint8Array),
      }),
    );
    expect(posted).toEqual([
      {
        subscription: {
          endpoint: 'https://push.example/nueva',
          expirationTime: null,
          keys: { p256dh: 'p256dh', auth: 'auth' },
        },
        device: 'PC',
        language: 'es',
      },
    ]);

    // El retardo por defecto es 10 s; al enviar la prueba se pide a la API con ese retardo.
    expect(screen.getByRole('button', { name: '10 s' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Enviar aviso de prueba' }));
    expect(await screen.findByText(/Cierra la app ahora/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/push/test',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ endpoint: 'https://push.example/nueva', delaySeconds: 10 }),
      }),
    );
  });

  it('con una suscripción previa la vuelve a registrar en la API y permite desactivarla', async () => {
    const user = userEvent.setup();
    const current = fakeSubscription('https://push.example/previa');
    supportedBrowser({ permission: 'granted', current });
    const calls: string[] = [];
    routeFetch({
      '/api/push/config': () => jsonResponse({ enabled: true, publicKey: VAPID_KEY }),
      '/api/push/subscriptions': (init) => {
        calls.push(String(init?.method));
        return init?.method === 'DELETE'
          ? new Response(null, { status: 204 })
          : jsonResponse(
              {
                subscribed: true,
                device: 'Android',
                lastDelivery: { at: '2026-10-19T12:00:00+02:00', ok: true, statusCode: 201 },
              },
              201,
            );
      },
    });
    renderCard();

    expect(
      await screen.findByText('Avisos activos en este dispositivo (Android).'),
    ).toBeInTheDocument();
    expect(screen.getByText(/^Último envío a las 12:00:00: entregado/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: ENABLE_LABEL })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Desactivar' }));

    expect(await screen.findByRole('button', { name: ENABLE_LABEL })).toBeInTheDocument();
    expect(current.unsubscribe).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['POST', 'DELETE']);
  });
});
