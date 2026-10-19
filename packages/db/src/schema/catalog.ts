import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  customType,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { primaryUuid, timestampTz } from './columns.ts';
import { shopId } from './shops.ts';
import { users } from './users.ts';

/**
 * Catálogo y equipo (LP-08): fotos, servicios, productos y barberos. Las cuatro tablas están aisladas por
 * barbería (migración 0006: CALL make_shop_scoped) y nada se borra: el rol app no tiene DELETE (los servicios,
 * productos y barberos se desactivan; las fotos además son inmutables: sin UPDATE).
 */

/** drizzle-orm 0.45 no trae bytea en pg-core: pg lo entrega y lo recibe como Buffer. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

/** Precio en céntimos (bigint, como el resto del dinero): CHECK >= 0 en la base, tope por Zod. */
const priceCents = () => bigint({ mode: 'number' }).notNull();

/**
 * Fotos de productos (y avatares) comprimidas dentro de PostgreSQL (arquitectura §4.4): entran en la copia
 * continua. El navegador las reduce antes de subirlas; la API comprueba tipo, tamaño y dimensiones.
 */
export const photos = pgTable(
  'photos',
  {
    id: primaryUuid(),
    shopId: shopId(),
    // 'image/jpeg' | 'image/png' | 'image/webp' (PHOTO_MIMES de @los-papis/shared).
    mime: text().notNull(),
    width: integer().notNull(),
    height: integer().notNull(),
    sizeBytes: integer().notNull(),
    // SHA-256 en hex de los bytes: ETag de GET /api/photos/:id.
    sha256: text().notNull(),
    bytes: bytea().notNull(),
    createdByUserId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestampTz().notNull().defaultNow(),
  },
  (t) => [
    index().on(t.shopId),
    check('photos_dimensions_positive', sql`${t.width} > 0 AND ${t.height} > 0`),
    check('photos_size_positive', sql`${t.sizeBytes} > 0`),
  ],
);

/** Servicios de la caja: nombre en los dos idiomas, precio final en céntimos y duración en minutos. */
export const services = pgTable(
  'services',
  {
    id: primaryUuid(),
    shopId: shopId(),
    nameEs: text().notNull(),
    nameIt: text().notNull(),
    priceCents: priceCents(),
    durationMinutes: integer().notNull(),
    active: boolean().notNull().default(true),
    // Orden en la rejilla de la caja (menor primero; empates por id).
    sortOrder: integer().notNull().default(0),
    createdAt: timestampTz().notNull().defaultNow(),
    updatedAt: timestampTz()
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index().on(t.shopId, t.active),
    check('services_price_cents_nonnegative', sql`${t.priceCents} >= 0`),
    check(
      'services_duration_minutes_range',
      sql`${t.durationMinutes} >= 5 AND ${t.durationMinutes} <= 480`,
    ),
  ],
);

/** Productos a la venta: nombre (de marca, sin traducir), precio final y foto opcional. El stock llega en LP-10. */
export const products = pgTable(
  'products',
  {
    id: primaryUuid(),
    shopId: shopId(),
    name: text().notNull(),
    priceCents: priceCents(),
    photoId: uuid().references(() => photos.id, { onDelete: 'restrict' }),
    active: boolean().notNull().default(true),
    sortOrder: integer().notNull().default(0),
    createdAt: timestampTz().notNull().defaultNow(),
    updatedAt: timestampTz()
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index().on(t.shopId, t.active),
    check('products_price_cents_nonnegative', sql`${t.priceCents} >= 0`),
  ],
);

/**
 * Perfil de barbero unido a su usuario (una persona = un perfil). El avatar son sus iniciales (shortCode)
 * sobre un color de la paleta, o una foto. El horario y las ausencias llegan con la agenda (LP-13).
 */
export const barbers = pgTable(
  'barbers',
  {
    id: primaryUuid(),
    shopId: shopId(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    displayName: text().notNull(),
    // "B1", "JP": 1 a 3 letras o cifras en mayúsculas (shortCodeSchema de @los-papis/shared).
    shortCode: text().notNull(),
    // Uno de BARBER_COLORS de @los-papis/shared.
    color: text().notNull(),
    photoId: uuid().references(() => photos.id, { onDelete: 'restrict' }),
    active: boolean().notNull().default(true),
    sortOrder: integer().notNull().default(0),
    createdAt: timestampTz().notNull().defaultNow(),
    updatedAt: timestampTz()
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index().on(t.shopId, t.active),
    uniqueIndex().on(t.shopId, t.userId),
    // El código corto no se repite entre los barberos ACTIVOS de la barbería.
    uniqueIndex('barbers_shop_id_short_code_active_index')
      .on(t.shopId, t.shortCode)
      .where(sql`${t.active}`),
  ],
);

export type Photo = typeof photos.$inferSelect;
export type NewPhoto = typeof photos.$inferInsert;
export type ServiceRow = typeof services.$inferSelect;
export type NewServiceRow = typeof services.$inferInsert;
export type ProductRow = typeof products.$inferSelect;
export type NewProductRow = typeof products.$inferInsert;
export type BarberRow = typeof barbers.$inferSelect;
export type NewBarberRow = typeof barbers.$inferInsert;
