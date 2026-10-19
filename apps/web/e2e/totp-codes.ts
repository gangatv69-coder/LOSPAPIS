import { setTimeout as sleep } from 'node:timers/promises';

import { base32Decode, hotp, TOTP_STEP_SECONDS, totpStep } from '@los-papis/shared';

import { requireCredentials, writeCredentials } from './auth-files.ts';

/**
 * Código TOTP que la API todavía no ha visto. La API rechaza un código ya usado (guarda el último paso
 * aceptado) y admite ±1 paso de tolerancia, así que se entrega siempre un paso mayor que el último:
 * el actual, el siguiente o, si los dos están gastados, se espera a que empiece el siguiente paso.
 */
export async function nextTotpCode(): Promise<string> {
  const credentials = requireCredentials();
  const now = Date.now();
  const current = totpStep(now);
  const step = Math.max(current, credentials.lastTotpStep + 1);
  if (step > current + 1) {
    // Quedan (step - 1 - current) pasos hasta que `step` entre en la ventana ±1 de la API.
    const readyAt = (step - 1) * TOTP_STEP_SECONDS * 1000;
    await sleep(readyAt - now + 500);
  }
  writeCredentials({ ...credentials, lastTotpStep: step });
  return hotp(base32Decode(credentials.secret), step);
}
