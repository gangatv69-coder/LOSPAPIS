import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  issuePinAssertion,
  PIN_ASSERTION_TTL_SECONDS,
  signPinAssertion,
  verifyPinAssertion,
} from './tokens.ts';

const SECRET = 'secreto-de-pruebas-para-las-aserciones-0123456789';
const now = new Date('2026-10-19T08:00:00Z');
const subject = { managerId: randomUUID(), deviceId: randomUUID(), shopId: randomUUID() };

describe('aserción de PIN', () => {
  it('se firma y se verifica; caduca a los 120 s', () => {
    const { token, expiresAt } = issuePinAssertion(SECRET, subject, now);
    expect(expiresAt.getTime()).toBe(now.getTime() + PIN_ASSERTION_TTL_SECONDS * 1000);
    expect(verifyPinAssertion(SECRET, token, now)).toEqual({
      ...subject,
      exp: Math.floor(now.getTime() / 1000) + PIN_ASSERTION_TTL_SECONDS,
    });
    expect(verifyPinAssertion(SECRET, token, new Date(expiresAt.getTime() - 1))).not.toBeNull();
    expect(verifyPinAssertion(SECRET, token, expiresAt)).toBeNull();
  });

  it('admite deviceId null (firmada desde la sesión de un manager)', () => {
    const { token } = issuePinAssertion(SECRET, { ...subject, deviceId: null }, now);
    expect(verifyPinAssertion(SECRET, token, now)?.deviceId).toBeNull();
  });

  it('rechaza otra clave, una firma o un cuerpo alterados y cadenas sin formato', () => {
    const exp = Math.floor(now.getTime() / 1000) + 60;
    const token = signPinAssertion(SECRET, { ...subject, exp });
    const [body = '', signature = ''] = token.split('.');
    expect(verifyPinAssertion('otro-secreto', token, now)).toBeNull();
    expect(verifyPinAssertion(SECRET, `${body}.${signature.slice(0, -1)}0`, now)).toBeNull();
    const forgedBody = Buffer.from(JSON.stringify({ ...subject, exp: exp + 3600 })).toString(
      'base64url',
    );
    expect(verifyPinAssertion(SECRET, `${forgedBody}.${signature}`, now)).toBeNull();
    expect(verifyPinAssertion(SECRET, 'sin-punto', now)).toBeNull();
    expect(verifyPinAssertion(SECRET, '', now)).toBeNull();
    expect(verifyPinAssertion(SECRET, 'a.b.c', now)).toBeNull();
  });

  it('rechaza un cuerpo bien firmado pero que no es una aserción', () => {
    const body = Buffer.from(JSON.stringify({ hola: 'mundo' })).toString('base64url');
    const forged = `${body}.${signPinAssertion(SECRET, { ...subject, exp: 1 }).split('.')[1]}`;
    expect(verifyPinAssertion(SECRET, forged, now)).toBeNull();
  });
});
