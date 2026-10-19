import { boolean, index, pgEnum, pgTable, text } from 'drizzle-orm/pg-core';

import { primaryUuid, timestampTz } from './columns.ts';
import { shopId } from './shops.ts';

export const userRole = pgEnum('user_role', ['manager', 'barber']);

/** Personas de la barbería. Sin credenciales ni sesiones: la lógica de acceso llega en LP-05 (Better Auth). */
export const users = pgTable(
  'users',
  {
    id: primaryUuid(),
    shopId: shopId(),
    displayName: text().notNull(),
    role: userRole().notNull(),
    active: boolean().notNull().default(true),
    createdAt: timestampTz().notNull().defaultNow(),
    // $onUpdate solo actúa en los update hechos por el ORM (no es un trigger).
    updatedAt: timestampTz()
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index().on(t.shopId)],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
