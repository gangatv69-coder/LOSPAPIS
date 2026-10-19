import { sql } from 'drizzle-orm';
import { check, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { primaryUuid, timestampTz } from './columns.ts';

/** Registro de barberías. Es la raíz del aislamiento: toda tabla de negocio apunta aquí con shop_id. */
export const shops = pgTable(
  'shops',
  {
    id: primaryUuid(),
    slug: text().notNull().unique(),
    name: text().notNull(),
    timezone: text().notNull().default('Europe/Rome'),
    currency: text().notNull().default('EUR'),
    createdAt: timestampTz().notNull().defaultNow(),
  },
  (t) => [check('shops_currency_iso4217', sql`${t.currency} ~ '^[A-Z]{3}$'`)],
);

/** Columna shop_id obligatoria de toda tabla de negocio (su migración la aísla con CALL make_shop_scoped). */
export const shopId = () =>
  uuid()
    .notNull()
    .references(() => shops.id, { onDelete: 'restrict' });

export type Shop = typeof shops.$inferSelect;
export type NewShop = typeof shops.$inferInsert;
