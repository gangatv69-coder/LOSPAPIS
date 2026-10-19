import { describe, expect, it } from 'vitest';

import {
  barberInputSchema,
  barberUpdateSchema,
  catalogSchema,
  MAX_PRICE_CENTS,
  photoUrl,
  productInputSchema,
  productUpdateSchema,
  serviceInputSchema,
  serviceName,
  serviceUpdateSchema,
  shortCodeSchema,
} from './catalog.ts';

const UUID = '019a0f9c-5b2e-7d1a-9c3e-1f2a3b4c5d6e';

describe('serviceInputSchema', () => {
  it('acepta un servicio de la maqueta y recorta los nombres', () => {
    const parsed = serviceInputSchema.parse({
      nameEs: '  Corte clásico ',
      nameIt: 'Taglio classico',
      priceCents: 1500,
      durationMinutes: 30,
    });
    expect(parsed).toEqual({
      nameEs: 'Corte clásico',
      nameIt: 'Taglio classico',
      priceCents: 1500,
      durationMinutes: 30,
    });
  });

  it('rechaza precios con decimales, negativos o por encima del tope, y duraciones fuera de rango', () => {
    const base = { nameEs: 'Fade', nameIt: 'Fade', priceCents: 1800, durationMinutes: 40 };
    expect(serviceInputSchema.safeParse({ ...base, priceCents: 18.5 }).success).toBe(false);
    expect(serviceInputSchema.safeParse({ ...base, priceCents: -1 }).success).toBe(false);
    expect(serviceInputSchema.safeParse({ ...base, priceCents: MAX_PRICE_CENTS + 1 }).success).toBe(
      false,
    );
    expect(serviceInputSchema.safeParse({ ...base, durationMinutes: 0 }).success).toBe(false);
    expect(serviceInputSchema.safeParse({ ...base, durationMinutes: 481 }).success).toBe(false);
    expect(serviceInputSchema.safeParse({ ...base, nameEs: '   ' }).success).toBe(false);
  });

  it('una actualización vacía no vale; con un solo campo sí', () => {
    expect(serviceUpdateSchema.safeParse({}).success).toBe(false);
    expect(serviceUpdateSchema.safeParse({ priceCents: 1600 }).success).toBe(true);
    expect(serviceUpdateSchema.safeParse({ sortOrder: 3 }).success).toBe(true);
  });
});

describe('productInputSchema', () => {
  it('la foto es opcional y puede quitarse con null', () => {
    expect(productInputSchema.parse({ name: 'Cera mate', priceCents: 1200 })).toEqual({
      name: 'Cera mate',
      priceCents: 1200,
    });
    expect(
      productInputSchema.parse({ name: 'Cera mate', priceCents: 1200, photoId: null }),
    ).toEqual({ name: 'Cera mate', priceCents: 1200, photoId: null });
    expect(
      productInputSchema.safeParse({ name: 'Cera mate', priceCents: 1200, photoId: 'x' }).success,
    ).toBe(false);
    expect(productUpdateSchema.safeParse({}).success).toBe(false);
  });
});

describe('barberos', () => {
  it('el código corto va en mayúsculas y tiene de 1 a 3 letras o cifras', () => {
    expect(shortCodeSchema.parse(' b1 ')).toBe('B1');
    expect(shortCodeSchema.safeParse('').success).toBe(false);
    expect(shortCodeSchema.safeParse('ABCD').success).toBe(false);
    expect(shortCodeSchema.safeParse('B-1').success).toBe(false);
  });

  it('un perfil nuevo necesita usuario, nombre, código y color', () => {
    const parsed = barberInputSchema.parse({
      userId: UUID,
      displayName: 'Barbero 1',
      shortCode: 'b1',
      color: 'yellow',
    });
    expect(parsed.shortCode).toBe('B1');
    expect(barberInputSchema.safeParse({ ...parsed, color: 'gold' }).success).toBe(false);
    expect(barberUpdateSchema.safeParse({ userId: UUID }).success).toBe(false);
    expect(barberUpdateSchema.safeParse({ color: 'blue' }).success).toBe(true);
  });
});

describe('catálogo', () => {
  it('serviceName elige el idioma y cae al otro si falta', () => {
    const service = { nameEs: 'Corte niño', nameIt: 'Taglio bambino' };
    expect(serviceName(service, 'es')).toBe('Corte niño');
    expect(serviceName(service, 'it')).toBe('Taglio bambino');
    expect(serviceName({ nameEs: 'Fade', nameIt: '' }, 'it')).toBe('Fade');
  });

  it('photoUrl apunta a la API y catalogSchema valida listas vacías', () => {
    expect(photoUrl(UUID)).toBe(`/api/photos/${UUID}`);
    expect(catalogSchema.parse({ services: [], products: [], barbers: [] })).toEqual({
      services: [],
      products: [],
      barbers: [],
    });
  });
});
