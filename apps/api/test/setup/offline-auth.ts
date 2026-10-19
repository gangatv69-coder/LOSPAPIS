import { randomUUID } from 'node:crypto';

import { createDb } from '@los-papis/db';

import type { AuthDeps } from '../../src/auth/types.ts';

export const silentLog = { info: () => {}, error: () => {} };

/**
 * Dependencias de acceso para las pruebas unitarias que no tocan la base (salud, push): el pool apunta a un
 * puerto cerrado y nunca conecta porque ninguna de esas peticiones lleva cookies ni entra en /api/auth.
 */
export const offlineAuthDeps = (): AuthDeps => ({
  db: createDb('postgres://app:x@127.0.0.1:9/offline', { max: 1, connectionTimeoutMillis: 100 }).db,
  shop: { id: randomUUID(), slug: 'offline', name: 'Barbería sin base' },
  secret: 'secreto-de-pruebas-sin-base-de-datos-0123456789abcdef',
  encryptionKey: new Uint8Array(32),
  cookieSecure: false,
});
