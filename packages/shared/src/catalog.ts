import * as z from 'zod';

import { centsSchema } from './money.ts';

/**
 * Catálogo y equipo (LP-08): servicios, productos, barberos y fotos. Lo comparten la API
 * (/api/catalog, /api/services, /api/products, /api/barbers, /api/photos) y las pantallas.
 */

/** Tipos de imagen que acepta la API (se comprueban por los bytes, no por la extensión). */
export const PHOTO_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type PhotoMime = (typeof PHOTO_MIMES)[number];
/** Tope del cuerpo de POST /api/photos. */
export const PHOTO_MAX_BYTES = 400 * 1024;
/** Lado mayor que acepta la API. */
export const PHOTO_MAX_SIDE = 1600;
/** Lado mayor al que reduce el navegador antes de subir (cabe de sobra en una casilla de la caja). */
export const PHOTO_TARGET_SIDE = 1024;

/** Colores del avatar de los barberos (la paleta de la maqueta: B1 amarillo, B2 azul). */
export const BARBER_COLORS = [
  'yellow',
  'blue',
  'red',
  'green',
  'purple',
  'orange',
  'teal',
  'pink',
] as const;
export const barberColorSchema = z.enum(BARBER_COLORS);
export type BarberColor = z.infer<typeof barberColorSchema>;

/** Precio máximo de un servicio o producto: 100.000,00 € (evita teclear un cero de más). */
export const MAX_PRICE_CENTS = 100_000_00;
export const priceCentsSchema = centsSchema.max(MAX_PRICE_CENTS);

export const SERVICE_MIN_MINUTES = 5;
export const SERVICE_MAX_MINUTES = 480;
export const durationMinutesSchema = z.int().min(SERVICE_MIN_MINUTES).max(SERVICE_MAX_MINUTES);

const nameSchema = (max: number) => z.string().trim().min(1).max(max);
const sortOrderSchema = z.int().min(0).max(1_000_000);

// --- Fotos -----------------------------------------------------------------------------------

export const photoSummarySchema = z.object({
  id: z.uuid(),
  mime: z.enum(PHOTO_MIMES),
  width: z.int().positive(),
  height: z.int().positive(),
  sizeBytes: z.int().positive(),
  /** Ruta de la imagen (GET /api/photos/:id); lleva la cookie de sesión o de dispositivo. */
  url: z.string().min(1),
});
export type PhotoSummary = z.infer<typeof photoSummarySchema>;

/** Ruta de una foto por su id (la misma en la API y en las pantallas). */
export const photoUrl = (photoId: string): string => `/api/photos/${photoId}`;

// --- Servicios -------------------------------------------------------------------------------

export const serviceSchema = z.object({
  id: z.uuid(),
  nameEs: z.string(),
  nameIt: z.string(),
  priceCents: priceCentsSchema,
  durationMinutes: durationMinutesSchema,
  active: z.boolean(),
  sortOrder: sortOrderSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Service = z.infer<typeof serviceSchema>;

export const serviceInputSchema = z.object({
  nameEs: nameSchema(60),
  nameIt: nameSchema(60),
  priceCents: priceCentsSchema,
  durationMinutes: durationMinutesSchema,
});
export type ServiceInput = z.infer<typeof serviceInputSchema>;

export const serviceUpdateSchema = serviceInputSchema
  .partial()
  .extend({ sortOrder: sortOrderSchema.optional() })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Nada que cambiar',
  });
export type ServiceUpdate = z.infer<typeof serviceUpdateSchema>;

// --- Productos -------------------------------------------------------------------------------

export const productSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  priceCents: priceCentsSchema,
  photoId: z.uuid().nullable(),
  photoUrl: z.string().nullable(),
  active: z.boolean(),
  sortOrder: sortOrderSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Product = z.infer<typeof productSchema>;

export const productInputSchema = z.object({
  name: nameSchema(60),
  priceCents: priceCentsSchema,
  photoId: z.uuid().nullable().optional(),
});
export type ProductInput = z.infer<typeof productInputSchema>;

export const productUpdateSchema = productInputSchema
  .partial()
  .extend({ sortOrder: sortOrderSchema.optional() })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Nada que cambiar',
  });
export type ProductUpdate = z.infer<typeof productUpdateSchema>;

// --- Barberos --------------------------------------------------------------------------------

/** Código corto del avatar ("B1", "JP"): 1 a 3 letras o cifras, en mayúsculas. */
export const shortCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{1,3}$/);

export const barberSchema = z.object({
  id: z.uuid(),
  /** Usuario al que pertenece el perfil (una persona = un perfil). */
  userId: z.uuid(),
  displayName: z.string(),
  shortCode: z.string(),
  color: barberColorSchema,
  photoId: z.uuid().nullable(),
  photoUrl: z.string().nullable(),
  active: z.boolean(),
  sortOrder: sortOrderSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Barber = z.infer<typeof barberSchema>;

export const barberInputSchema = z.object({
  userId: z.uuid(),
  displayName: nameSchema(40),
  shortCode: shortCodeSchema,
  color: barberColorSchema,
  photoId: z.uuid().nullable().optional(),
});
export type BarberInput = z.infer<typeof barberInputSchema>;

export const barberUpdateSchema = barberInputSchema
  .omit({ userId: true })
  .partial()
  .extend({ sortOrder: sortOrderSchema.optional() })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Nada que cambiar',
  });
export type BarberUpdate = z.infer<typeof barberUpdateSchema>;

// --- Lo que lee la caja ----------------------------------------------------------------------

/** GET /api/catalog: solo lo activo, en su orden. Lo leen la caja (dispositivo) y cualquier usuario. */
export const catalogSchema = z.object({
  services: z.array(serviceSchema),
  products: z.array(productSchema),
  barbers: z.array(barberSchema),
});
export type Catalog = z.infer<typeof catalogSchema>;

export type CatalogLanguage = 'es' | 'it';

/** Nombre del servicio en el idioma de la pantalla; si falta en ese idioma, el otro. */
export const serviceName = (
  service: Pick<Service, 'nameEs' | 'nameIt'>,
  language: CatalogLanguage,
): string => {
  const preferred = language === 'it' ? service.nameIt : service.nameEs;
  const other = language === 'it' ? service.nameEs : service.nameIt;
  return preferred.trim() !== '' ? preferred : other;
};
