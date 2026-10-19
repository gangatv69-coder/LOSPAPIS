import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PhotoPicker } from '@/features/catalog/photo-picker';
import i18n from '@/i18n';
import { errorResponse, jsonResponse, mockFetch } from '@/test/fetch-mock';

const PHOTO_ID = '5a2f1c3e-9b7d-4e21-8c6a-0f1e2d3c4b5a';

// jsdom no tiene canvas: la reducción se sustituye por un JPEG de mentira y se prueba el resto del flujo.
vi.mock('@/features/catalog/image-resize', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/features/catalog/image-resize')>();
  return {
    ...original,
    resizeImage: vi.fn(async () => new Blob(['jpeg'], { type: 'image/jpeg' })),
  };
});

describe('PhotoPicker', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('es');
    // jsdom tampoco implementa los objetos URL de la vista previa.
    Object.defineProperty(URL, 'createObjectURL', {
      value: () => 'blob:preview',
      configurable: true,
      writable: true,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: () => {},
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sin foto enseña el botón de hacer foto y el selector acepta imágenes de la cámara', () => {
    render(<PhotoPicker photoId={null} onChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Hacer foto / Elegir imagen' })).toBeInTheDocument();
    const input = screen.getByTestId('photo-file');
    expect(input).toHaveAttribute('accept', 'image/*');
    expect(input).toHaveAttribute('capture', 'environment');
    expect(screen.queryByTestId('photo-preview')).not.toBeInTheDocument();
  });

  it('con una foto guardada la enseña desde /api/photos y permite quitarla', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<PhotoPicker photoId={PHOTO_ID} onChange={onChange} />);

    expect(screen.getByTestId('photo-preview')).toHaveAttribute('src', `/api/photos/${PHOTO_ID}`);
    await user.click(screen.getByRole('button', { name: 'Quitar foto' }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('al elegir un archivo lo reduce, lo sube como binario y entrega el id', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { fetchMock } = mockFetch({
      'POST /api/photos': () =>
        jsonResponse(
          {
            id: PHOTO_ID,
            mime: 'image/jpeg',
            width: 2,
            height: 2,
            sizeBytes: 4,
            url: `/api/photos/${PHOTO_ID}`,
          },
          201,
        ),
    });
    render(<PhotoPicker photoId={null} onChange={onChange} />);

    const file = new File(['png'], 'foto.png', { type: 'image/png' });
    await user.upload(screen.getByTestId('photo-file'), file);

    await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith(PHOTO_ID));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/photos',
      expect.objectContaining({
        method: 'POST',
        headers: { 'content-type': 'image/jpeg' },
        body: expect.any(Blob),
      }),
    );
    expect(screen.getByTestId('photo-preview')).toHaveAttribute('src', 'blob:preview');
    expect(screen.getByRole('button', { name: 'Cambiar foto' })).toBeInTheDocument();
  });

  it('con photo_too_large lo dice y no cambia nada', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    mockFetch({ 'POST /api/photos': () => errorResponse(413, 'photo_too_large') });
    render(<PhotoPicker photoId={null} onChange={onChange} />);

    await user.upload(
      screen.getByTestId('photo-file'),
      new File(['png'], 'foto.png', { type: 'image/png' }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('La foto pesa demasiado');
    expect(onChange).not.toHaveBeenCalled();
  });
});
