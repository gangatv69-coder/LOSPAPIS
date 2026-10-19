import { describe, expect, it } from 'vitest';

import {
  authStateSchema,
  backupCodeSchema,
  bootstrapRequestSchema,
  initialsOf,
  loginRequestSchema,
  pinSchema,
  totpLoginRequestSchema,
  usernameSchema,
} from './auth.ts';

describe('esquemas de acceso', () => {
  it('el usuario se normaliza a minúsculas y admite punto, guion y guion bajo', () => {
    expect(usernameSchema.parse('  Manager.Uno  ')).toBe('manager.uno');
    expect(usernameSchema.safeParse('ab').success).toBe(false);
    expect(usernameSchema.safeParse('con espacio').success).toBe(false);
    expect(usernameSchema.safeParse('tilde-ñ').success).toBe(false);
  });

  it('la contraseña nueva exige 10 caracteres, pero al entrar vale cualquiera no vacía', () => {
    expect(
      bootstrapRequestSchema.safeParse({ username: 'ana', password: 'corta', displayName: 'Ana' })
        .success,
    ).toBe(false);
    expect(loginRequestSchema.safeParse({ username: 'ana', password: 'corta' }).success).toBe(true);
    expect(loginRequestSchema.safeParse({ username: 'ana', password: '' }).success).toBe(false);
  });

  it('el PIN son exactamente 6 dígitos', () => {
    expect(pinSchema.safeParse('123456').success).toBe(true);
    expect(pinSchema.safeParse('12345').success).toBe(false);
    expect(pinSchema.safeParse('12345a').success).toBe(false);
  });

  it('el código de respaldo se acepta con guion, mayúsculas o espacios', () => {
    expect(backupCodeSchema.parse(' AB2C-D3EF ')).toBe('ab2cd3ef');
    expect(backupCodeSchema.safeParse('ab2c-d3e').success).toBe(false);
  });

  it('el segundo paso del acceso lleva código o código de respaldo', () => {
    expect(totpLoginRequestSchema.parse({ code: ' 123456 ' })).toEqual({ code: '123456' });
    expect(totpLoginRequestSchema.parse({ backupCode: 'ab2c-d3ef' })).toEqual({
      backupCode: 'ab2cd3ef',
    });
    expect(totpLoginRequestSchema.safeParse({}).success).toBe(false);
  });

  it('el estado de acceso admite usuario y dispositivo nulos', () => {
    expect(
      authStateSchema.parse({
        bootstrapNeeded: true,
        user: null,
        pendingTotp: false,
        device: null,
      }),
    ).toEqual({ bootstrapNeeded: true, user: null, pendingTotp: false, device: null });
  });

  it('las iniciales salen del primer y último nombre', () => {
    expect(initialsOf('Manager Uno')).toBe('MU');
    expect(initialsOf('ana maría pérez')).toBe('AP');
    expect(initialsOf('Ana')).toBe('AN');
    expect(initialsOf('  ')).toBe('');
  });
});
