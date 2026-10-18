import type { Health } from '@los-papis/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HealthCard } from '@/features/health/health-card';
import i18n from '@/i18n';

const health: Health = {
  status: 'ok',
  version: '1.2.3',
  time: '2026-10-19T10:30:00+02:00',
  timezone: 'Europe/Rome',
  uptimeSeconds: 3725,
};

// El cliente de Hono llama al fetch global con '/api/health': aquí se sustituye por un mock.
const fetchMock = vi.fn<typeof fetch>();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function renderCard() {
  // retry: false para ver el error sin esperar al reintento que hace el QueryClient real.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <HealthCard />
    </QueryClientProvider>,
  );
}

describe('HealthCard', () => {
  beforeEach(async () => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    await i18n.changeLanguage('es');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('pide /api/health y muestra estado, versión, hora de Roma y tiempo en marcha', async () => {
    fetchMock.mockResolvedValue(jsonResponse(health));
    const { container } = renderCard();

    expect(screen.getByRole('status')).toHaveTextContent('Comprobando…');
    expect(await screen.findByText('En línea')).toBeInTheDocument();

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/health',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(screen.getByText('1.2.3')).toBeInTheDocument();
    expect(screen.getByText('Hora de Roma')).toBeInTheDocument();
    expect(container.querySelector('time')).toHaveAttribute('datetime', health.time);
    expect(screen.getByText('1 h 2 min 5 s')).toBeInTheDocument();
    expect(screen.getByText(/^Actualizado a las /)).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('avisa cuando el servidor no responde y se recupera al reintentar', async () => {
    const user = userEvent.setup();
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    renderCard();

    expect(await screen.findByRole('alert')).toHaveTextContent('El servidor no responde');

    fetchMock.mockResolvedValueOnce(jsonResponse(health));
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(await screen.findByText('En línea')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('trata como error una respuesta que no cumple el esquema compartido', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: 'weird' }));
    renderCard();

    expect(await screen.findByRole('alert')).toHaveTextContent('El servidor no responde');
  });
});
