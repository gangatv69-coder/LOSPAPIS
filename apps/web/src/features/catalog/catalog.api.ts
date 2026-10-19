import {
  type Barber,
  type BarberInput,
  type BarberUpdate,
  barberSchema,
  type Catalog,
  catalogSchema,
  type PhotoSummary,
  type Product,
  type ProductInput,
  type ProductUpdate,
  photoSummarySchema,
  productSchema,
  type Service,
  type ServiceInput,
  type ServiceUpdate,
  serviceSchema,
  type UserSummary,
  userSummarySchema,
} from '@los-papis/shared';

import { get, patch, post, request } from '@/lib/api-request';

/*
 * Rutas /api/catalog, /api/services, /api/products, /api/barbers y /api/photos (LP-08) con fetch plano
 * validado por los esquemas compartidos (como auth.api.ts: la API se escribió en paralelo).
 * Errores: ApiError con el código estable (`validation`, `not_found`, `forbidden`, `short_code_taken`,
 * `user_already_barber`, `photo_invalid`, `photo_too_large`...).
 */

async function json<T>(
  response: Promise<Response>,
  schema: { parse: (input: unknown) => T },
): Promise<T> {
  const res = await response;
  return schema.parse(await res.json());
}

const segment = (id: string): string => encodeURIComponent(id);

const activation = (active: boolean): string => (active ? 'reactivate' : 'deactivate');

// --- Lo que lee la caja ---------------------------------------------------------------------------

/** GET /api/catalog: solo lo activo, en orden. Lo leen la caja (dispositivo sin usuario) y cualquier usuario. */
export const fetchCatalog = (): Promise<Catalog> => json(get('/api/catalog'), catalogSchema);

// --- Servicios (permiso inventario) ---------------------------------------------------------------

/** GET /api/services: todos, los inactivos al final (403 forbidden para un barbero). */
export const fetchServices = (): Promise<Service[]> =>
  json(get('/api/services'), serviceSchema.array());

/** POST /api/services: 201 con el servicio creado. */
export const createService = (body: ServiceInput): Promise<Service> =>
  json(post('/api/services', body), serviceSchema);

/** PATCH /api/services/:id: al menos un campo; un precio distinto queda en la auditoría. */
export const updateService = (id: string, body: ServiceUpdate): Promise<Service> =>
  json(patch(`/api/services/${segment(id)}`, body), serviceSchema);

/** POST /api/services/:id/deactivate | /reactivate. Nunca se borra nada. */
export const setServiceActive = (id: string, active: boolean): Promise<Service> =>
  json(post(`/api/services/${segment(id)}/${activation(active)}`), serviceSchema);

// --- Productos (permiso inventario) ---------------------------------------------------------------

export const fetchProducts = (): Promise<Product[]> =>
  json(get('/api/products'), productSchema.array());

export const createProduct = (body: ProductInput): Promise<Product> =>
  json(post('/api/products', body), productSchema);

export const updateProduct = (id: string, body: ProductUpdate): Promise<Product> =>
  json(patch(`/api/products/${segment(id)}`, body), productSchema);

export const setProductActive = (id: string, active: boolean): Promise<Product> =>
  json(post(`/api/products/${segment(id)}/${activation(active)}`), productSchema);

// --- Barberos (permiso usuarios) ------------------------------------------------------------------

export const fetchBarbers = (): Promise<Barber[]> =>
  json(get('/api/barbers'), barberSchema.array());

/** GET /api/barbers/candidates: usuarios activos con cuenta y todavía sin perfil de barbero. */
export const fetchBarberCandidates = (): Promise<UserSummary[]> =>
  json(get('/api/barbers/candidates'), userSummarySchema.array());

/** POST /api/barbers: 409 user_already_barber | short_code_taken. */
export const createBarber = (body: BarberInput): Promise<Barber> =>
  json(post('/api/barbers', body), barberSchema);

export const updateBarber = (id: string, body: BarberUpdate): Promise<Barber> =>
  json(patch(`/api/barbers/${segment(id)}`, body), barberSchema);

export const setBarberActive = (id: string, active: boolean): Promise<Barber> =>
  json(post(`/api/barbers/${segment(id)}/${activation(active)}`), barberSchema);

// --- Fotos ----------------------------------------------------------------------------------------

/**
 * POST /api/photos con el cuerpo binario (la imagen ya reducida por image-resize.ts) y su tipo en
 * `content-type`. 413 photo_too_large, 400 photo_invalid. La imagen se lee después en photoUrl(id).
 */
export const uploadPhoto = (blob: Blob): Promise<PhotoSummary> =>
  json(
    request('/api/photos', {
      method: 'POST',
      body: blob,
      headers: { 'content-type': blob.type },
    }),
    photoSummarySchema,
  );
