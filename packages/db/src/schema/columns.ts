import { sql } from 'drizzle-orm';
import { timestamp, uuid } from 'drizzle-orm/pg-core';

/** Clave primaria UUID v7 generada por PostgreSQL 18 (ordenable por tiempo, mejor localidad en los índices). */
export const primaryUuid = () => uuid().primaryKey().default(sql`uuidv7()`);

/** Instante en UTC (timestamptz). Drizzle lo entrega como Date. */
export const timestampTz = () => timestamp({ withTimezone: true, mode: 'date' });
