import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/*
 * Archivos del manager de pruebas que crea auth.setup.ts (carpeta ignorada por git): la sesión
 * (storageState) que usan los proyectos de Playwright y las credenciales con las que auth.spec.ts
 * vuelve a entrar en contextos limpios.
 */

export const AUTH_DIR = path.join(import.meta.dirname, '.auth');
export const MANAGER_STATE_FILE = path.join(AUTH_DIR, 'manager.json');
export const CREDENTIALS_FILE = path.join(AUTH_DIR, 'credentials.json');

/** Origen de Vite en los e2e; la API lo recibe como PUBLIC_URL para la guardia CSRF. */
export const WEB_ORIGIN = 'http://127.0.0.1:5173';

/**
 * Las peticiones desde Node (request de Playwright) no llevan las cabeceras que el navegador pone solo;
 * la guardia CSRF de la API exige Sec-Fetch-Site same-origin u Origin igual a PUBLIC_URL.
 */
export const CSRF_HEADERS = { origin: WEB_ORIGIN, 'sec-fetch-site': 'same-origin' } as const;

export type E2eCredentials = {
  username: string;
  password: string;
  displayName: string;
  pin: string;
  /** Secreto TOTP en base32, el mismo que mostró /api/auth/totp/setup. */
  secret: string;
  /** Último paso TOTP cuyo código se envió a la API (un código no vale dos veces). */
  lastTotpStep: number;
};

export function readCredentials(): E2eCredentials | null {
  if (!existsSync(CREDENTIALS_FILE)) return null;
  return JSON.parse(readFileSync(CREDENTIALS_FILE, 'utf8')) as E2eCredentials;
}

export function writeCredentials(credentials: E2eCredentials): void {
  mkdirSync(AUTH_DIR, { recursive: true });
  writeFileSync(CREDENTIALS_FILE, `${JSON.stringify(credentials, null, 2)}\n`, 'utf8');
}

/** Credenciales obligatorias: sin ellas el proyecto `setup` no se ejecutó. */
export function requireCredentials(): E2eCredentials {
  const credentials = readCredentials();
  if (!credentials) {
    throw new Error(
      `No existe ${CREDENTIALS_FILE}: el proyecto "setup" (e2e/auth.setup.ts) tiene que ejecutarse antes.`,
    );
  }
  return credentials;
}
