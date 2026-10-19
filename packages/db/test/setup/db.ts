import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { inject } from 'vitest';

import { createDb, type DbHandle } from '../../src/client.ts';

export type Role = 'owner' | 'app';

/** Conexiones a la base de pruebas que dejó preparada global-setup.ts. */
export const testDb = () => inject('db');

const urlFor = (role: Role): string => (role === 'owner' ? testDb().ownerUrl : testDb().appUrl);

/** Cliente Drizzle + pool como owner o como app. Cerrar con `close()` en afterAll. */
export const connectAs = (role: Role): DbHandle => createDb(urlFor(role), { max: 2 });

/** Pool de node-postgres "a pelo" para SQL directo. Cerrar con `end()`. */
export const poolAs = (role: Role): Pool => new Pool({ connectionString: urlFor(role), max: 2 });

/** SQLSTATE del error de PostgreSQL (directo o envuelto por Drizzle en `cause`); undefined si no falló. */
export const pgCode = async (promise: Promise<unknown>): Promise<string | undefined> => {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return extractCode(error);
  }
};

const extractCode = (error: unknown): string | undefined => {
  if (typeof error !== 'object' || error === null) return undefined;
  const { code, cause } = error as { code?: unknown; cause?: unknown };
  if (typeof code === 'string') return code;
  return extractCode(cause);
};

/** Nombre único por ejecución: los archivos de prueba no se pisan aunque corran a la vez. */
export const uniqueSlug = (prefix: string): string => `${prefix}-${randomUUID().slice(0, 8)}`;

export const SQLSTATE = {
  /** permission denied / new row violates row-level security policy */
  insufficientPrivilege: '42501',
  /** reject_mutation(): la tabla solo crece */
  appendOnly: 'LP001',
  /** invalid input syntax for type uuid */
  invalidTextRepresentation: '22P02',
  /** unique_violation: índice único (username por barbería, token_hash de sesiones y dispositivos) */
  uniqueViolation: '23505',
  /** foreign_key_violation: la fila apuntada no existe */
  foreignKeyViolation: '23503',
} as const;
