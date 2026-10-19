import type { AuthState, SessionUser } from '@los-papis/shared';
import { describe, expect, it } from 'vitest';

import { guardRoute, isSettingsStep, normalizePath, safeNext } from '@/features/auth/auth-guard';

const manager: SessionUser = {
  id: '0f6a8d3e-3d0c-4a0b-9c3e-1b2c3d4e5f60',
  username: 'manager.uno',
  displayName: 'Manager Uno',
  role: 'manager',
  totpEnabled: true,
  pinSet: true,
  mustChangePassword: false,
  recentTotp: false,
};

const device = {
  id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  name: 'iPad de caja',
  kind: 'ipad' as const,
  authorizedAt: '2026-10-19T09:00:00+02:00',
  lastSeenAt: null,
  revokedAt: null,
};

const state = (partial: Partial<AuthState>): AuthState => ({
  bootstrapNeeded: false,
  user: null,
  pendingTotp: false,
  device: null,
  ...partial,
});

describe('guardRoute', () => {
  it('sin ningún manager todo va a /configurar (que sí se permite)', () => {
    const s = state({ bootstrapNeeded: true });
    expect(guardRoute(s, '/')).toEqual({ kind: 'bootstrap' });
    expect(guardRoute(s, '/acceso')).toEqual({ kind: 'bootstrap' });
    expect(guardRoute(s, '/configurar')).toEqual({ kind: 'allow' });
  });

  it('con el primer manager creado, /configurar ya no se usa', () => {
    expect(guardRoute(state({}), '/configurar')).toEqual({ kind: 'login' });
    expect(guardRoute(state({ user: manager }), '/configurar')).toEqual({ kind: 'home' });
  });

  it('sin sesión manda a /acceso con la ruta pedida en next (salvo la raíz)', () => {
    const s = state({});
    expect(guardRoute(s, '/acceso')).toEqual({ kind: 'allow' });
    expect(guardRoute(s, '/', '/')).toEqual({ kind: 'login', next: undefined });
    expect(guardRoute(s, '/ajustes', '/ajustes?paso=2fa')).toEqual({
      kind: 'login',
      next: '/ajustes?paso=2fa',
    });
    expect(guardRoute(s, '/caja', '/caja')).toEqual({ kind: 'login', next: '/caja' });
  });

  it('un dispositivo autorizado trabaja en la caja y el cierre sin usuario, pero no en el resto', () => {
    const s = state({ device });
    expect(guardRoute(s, '/caja')).toEqual({ kind: 'allow' });
    expect(guardRoute(s, '/cierre/')).toEqual({ kind: 'allow' });
    expect(guardRoute(s, '/ajustes', '/ajustes')).toEqual({ kind: 'login', next: '/ajustes' });
    expect(guardRoute(s, '/', '/')).toEqual({ kind: 'login', next: undefined });
  });

  it('con la 2FA pendiente solo vale /acceso (ni siquiera la caja del dispositivo)', () => {
    const s = state({ user: manager, pendingTotp: true, device });
    expect(guardRoute(s, '/acceso')).toEqual({ kind: 'allow' });
    expect(guardRoute(s, '/caja', '/caja')).toEqual({ kind: 'login', next: '/caja' });
    expect(guardRoute(s, '/', '/')).toEqual({ kind: 'login', next: undefined });
  });

  it('con sesión completa se navega libremente y /acceso vuelve al inicio', () => {
    const s = state({ user: manager });
    expect(guardRoute(s, '/')).toEqual({ kind: 'allow' });
    expect(guardRoute(s, '/panel')).toEqual({ kind: 'allow' });
    expect(guardRoute(s, '/acceso')).toEqual({ kind: 'home' });
  });

  it('una contraseña temporal obliga a pasar por Ajustes (contraseña) antes que nada', () => {
    const s = state({ user: { ...manager, mustChangePassword: true, totpEnabled: false } });
    expect(guardRoute(s, '/')).toEqual({ kind: 'settings', paso: 'contrasena' });
    expect(guardRoute(s, '/caja')).toEqual({ kind: 'settings', paso: 'contrasena' });
    expect(guardRoute(s, '/ajustes')).toEqual({ kind: 'allow' });
  });

  it('un manager sin 2FA tiene que activarla; a un barbero no se le pide', () => {
    expect(guardRoute(state({ user: { ...manager, totpEnabled: false } }), '/')).toEqual({
      kind: 'settings',
      paso: '2fa',
    });
    const barber: SessionUser = { ...manager, role: 'barber', totpEnabled: false, pinSet: false };
    expect(guardRoute(state({ user: barber }), '/')).toEqual({ kind: 'allow' });
  });
});

describe('utilidades del guardia', () => {
  it('normaliza la barra final', () => {
    expect(normalizePath('/caja/')).toBe('/caja');
    expect(normalizePath('/')).toBe('/');
    expect(normalizePath('')).toBe('/');
  });

  it('solo acepta como next rutas relativas de la app que no sean públicas', () => {
    expect(safeNext('/ajustes?paso=2fa')).toBe('/ajustes?paso=2fa');
    expect(safeNext('/caja')).toBe('/caja');
    expect(safeNext('https://evil.example/')).toBeUndefined();
    expect(safeNext('//evil.example')).toBeUndefined();
    expect(safeNext('/acceso?next=/caja')).toBeUndefined();
    expect(safeNext('/configurar')).toBeUndefined();
    expect(safeNext(42)).toBeUndefined();
  });

  it('reconoce los pasos de Ajustes', () => {
    expect(isSettingsStep('2fa')).toBe(true);
    expect(isSettingsStep('contrasena')).toBe(true);
    expect(isSettingsStep('otro')).toBe(false);
    expect(isSettingsStep(undefined)).toBe(false);
  });
});
