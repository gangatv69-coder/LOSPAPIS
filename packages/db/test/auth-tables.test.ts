import { randomUUID } from 'node:crypto';

import { deviceKindSchema, userRoleSchema } from '@los-papis/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DbHandle } from '../src/client.ts';
import { auditEvents, backupCodes, devices, sessions, shops, users } from '../src/schema/index.ts';
import { withShop } from '../src/tenant.ts';
import { connectAs, pgCode, SQLSTATE, uniqueSlug } from './setup/db.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('tablas de acceso (LP-05): users, devices, sessions y backup_codes', () => {
  let owner: DbHandle;
  let app: DbHandle;
  let shopA = '';
  let shopB = '';
  let managerId = '';
  let deviceId = '';

  beforeAll(async () => {
    owner = connectAs('owner');
    app = connectAs('app');
    const created = await owner.db
      .insert(shops)
      .values([
        { slug: uniqueSlug('auth-a'), name: 'Auth A' },
        { slug: uniqueSlug('auth-b'), name: 'Auth B' },
      ])
      .returning();
    shopA = created[0]?.id ?? '';
    shopB = created[1]?.id ?? '';
    const [manager] = await owner.db
      .insert(users)
      .values({
        shopId: shopA,
        displayName: 'Manager Uno',
        role: 'manager',
        username: 'manager1',
        passwordHash: 'scrypt$32768$8$1$sal$hash',
      })
      .returning();
    managerId = manager?.id ?? '';
  });

  afterAll(async () => {
    await owner.close();
    await app.close();
  });

  it('los enums de PostgreSQL coinciden con los esquemas Zod de @los-papis/shared', async () => {
    const labelsOf = async (type: string): Promise<string[]> => {
      const { rows } = await owner.pool.query<{ label: string }>(
        `select e.enumlabel as label from pg_enum e
         join pg_type t on t.oid = e.enumtypid
         where t.typname = $1 order by e.enumsortorder`,
        [type],
      );
      return rows.map((r) => r.label);
    };
    expect(await labelsOf('user_role')).toEqual(userRoleSchema.options);
    expect(await labelsOf('device_kind')).toEqual(deviceKindSchema.options);
  });

  it('una cuenta nueva: sin 2FA, sin PIN, sin bloqueos, contadores a cero e idioma es', async () => {
    const [manager] = await owner.db.select().from(users).where(eq(users.id, managerId));
    expect(manager).toMatchObject({
      username: 'manager1',
      mustChangePassword: false,
      loginFailedCount: 0,
      loginLockedUntil: null,
      totpSecretEnc: null,
      totpEnabledAt: null,
      totpLastStep: null,
      pinHash: null,
      pinFailedCount: 0,
      pinLockedAt: null,
      lastLoginAt: null,
      language: 'es',
    });
  });

  it('el username no se repite dentro de la barbería (23505), pero sí vale en otra', async () => {
    expect(
      await pgCode(
        owner.db
          .insert(users)
          .values({ shopId: shopA, displayName: 'Impostor', role: 'barber', username: 'manager1' }),
      ),
    ).toBe(SQLSTATE.uniqueViolation);
    const [other] = await owner.db
      .insert(users)
      .values({ shopId: shopB, displayName: 'Manager B', role: 'manager', username: 'manager1' })
      .returning();
    expect(other?.username).toBe('manager1');
  });

  it('varias personas sin cuenta (username NULL) conviven en la misma barbería', async () => {
    const rows = await owner.db
      .insert(users)
      .values([
        { shopId: shopA, displayName: 'Sin cuenta 1', role: 'barber' },
        { shopId: shopA, displayName: 'Sin cuenta 2', role: 'barber' },
      ])
      .returning();
    expect(rows.map((r) => r.username)).toEqual([null, null]);
  });

  it('app, con la barbería fijada, inserta y lee un dispositivo, una sesión y un código de respaldo', async () => {
    const inserted = await withShop(app.db, shopA, async (tx) => {
      const [device] = await tx
        .insert(devices)
        .values({
          shopId: shopA,
          name: 'iPad de la caja',
          kind: 'ipad',
          tokenHash: uniqueSlug('device'),
          authorizedByUserId: managerId,
          userAgent: 'Safari iPad',
        })
        .returning();
      if (!device) throw new Error('sin dispositivo');
      const [session] = await tx
        .insert(sessions)
        .values({
          shopId: shopA,
          userId: managerId,
          tokenHash: uniqueSlug('session'),
          totpPending: true,
          expiresAt: new Date(Date.now() + 30 * DAY_MS),
          ip: '127.0.0.1',
          deviceId: device.id,
        })
        .returning();
      const [code] = await tx
        .insert(backupCodes)
        .values({ shopId: shopA, userId: managerId, codeHash: uniqueSlug('code') })
        .returning();
      return { device, session, code };
    });
    deviceId = inserted.device.id;
    expect(inserted.device).toMatchObject({
      kind: 'ipad',
      authorizedByUserId: managerId,
      lastSeenAt: null,
      revokedAt: null,
      revokedByUserId: null,
    });
    expect(inserted.device.authorizedAt).toBeInstanceOf(Date);
    expect(inserted.session).toMatchObject({
      userId: managerId,
      totpPending: true,
      totpVerifiedAt: null,
      revokedAt: null,
      deviceId,
    });
    expect(inserted.session?.lastSeenAt).toBeInstanceOf(Date);
    expect(inserted.code).toMatchObject({ userId: managerId, usedAt: null, revokedAt: null });

    const seen = await withShop(app.db, shopA, async (tx) => ({
      devices: await tx.select().from(devices).where(eq(devices.id, deviceId)),
      sessions: await tx.select().from(sessions).where(eq(sessions.userId, managerId)),
      codes: await tx.select().from(backupCodes).where(eq(backupCodes.userId, managerId)),
    }));
    expect(seen.devices).toHaveLength(1);
    expect(seen.sessions).toHaveLength(1);
    expect(seen.codes).toHaveLength(1);
  });

  it('el token_hash de dispositivos y de sesiones es único en toda la base (23505)', async () => {
    const [device] = await owner.db.select().from(devices).where(eq(devices.id, deviceId));
    const [session] = await owner.db.select().from(sessions).where(eq(sessions.userId, managerId));
    const [managerB] = await owner.db.select().from(users).where(eq(users.shopId, shopB)).limit(1);
    if (!device || !session || !managerB) throw new Error('faltan filas de la preparación');
    expect(
      await pgCode(
        owner.db.insert(devices).values({
          shopId: shopB,
          name: 'Clon',
          kind: 'pc',
          tokenHash: device.tokenHash,
          authorizedByUserId: managerB.id,
        }),
      ),
    ).toBe(SQLSTATE.uniqueViolation);
    expect(
      await pgCode(
        owner.db.insert(sessions).values({
          shopId: shopB,
          userId: managerB.id,
          tokenHash: session.tokenHash,
          expiresAt: new Date(Date.now() + DAY_MS),
        }),
      ),
    ).toBe(SQLSTATE.uniqueViolation);
  });

  it('sin barbería fijada, app no ve dispositivos, sesiones ni códigos de respaldo', async () => {
    expect(await app.db.select().from(devices)).toEqual([]);
    expect(await app.db.select().from(sessions)).toEqual([]);
    expect(await app.db.select().from(backupCodes)).toEqual([]);
  });

  it('con la barbería B fijada, app no ve lo de A ni puede escribir en A (42501)', async () => {
    const fromB = await withShop(app.db, shopB, async (tx) => ({
      devices: await tx.select().from(devices),
      sessions: await tx.select().from(sessions),
    }));
    expect(fromB).toEqual({ devices: [], sessions: [] });
    expect(
      await pgCode(
        withShop(app.db, shopB, (tx) =>
          tx.insert(backupCodes).values({ shopId: shopA, userId: managerId, codeHash: 'intruso' }),
        ),
      ),
    ).toBe(SQLSTATE.insufficientPrivilege);
  });

  it('app no puede borrar dispositivos ni códigos de respaldo (42501): se revocan o se marcan usados', async () => {
    expect(
      await pgCode(
        withShop(app.db, shopA, (tx) => tx.delete(devices).where(eq(devices.id, deviceId))),
      ),
    ).toBe(SQLSTATE.insufficientPrivilege);
    expect(
      await pgCode(
        withShop(app.db, shopA, (tx) =>
          tx.delete(backupCodes).where(eq(backupCodes.userId, managerId)),
        ),
      ),
    ).toBe(SQLSTATE.insufficientPrivilege);

    const revoked = await withShop(app.db, shopA, (tx) =>
      tx
        .update(devices)
        .set({ revokedAt: new Date(), revokedByUserId: managerId })
        .where(eq(devices.id, deviceId))
        .returning(),
    );
    expect(revoked[0]?.revokedAt).toBeInstanceOf(Date);
    expect(revoked[0]?.revokedByUserId).toBe(managerId);
    const used = await withShop(app.db, shopA, (tx) =>
      tx
        .update(backupCodes)
        .set({ usedAt: new Date() })
        .where(eq(backupCodes.userId, managerId))
        .returning(),
    );
    expect(used[0]?.usedAt).toBeInstanceOf(Date);
  });

  it('app sí puede borrar sesiones (limpieza de las caducadas)', async () => {
    const deleted = await withShop(app.db, shopA, (tx) =>
      tx.delete(sessions).where(eq(sessions.userId, managerId)).returning(),
    );
    expect(deleted).toHaveLength(1);
  });

  it('audit_events.device_id apunta a devices: un dispositivo inexistente responde 23503', async () => {
    expect(
      await pgCode(
        withShop(app.db, shopA, (tx) =>
          tx.insert(auditEvents).values({
            shopId: shopA,
            action: 'test.device',
            entityType: 'device',
            deviceId: randomUUID(),
          }),
        ),
      ),
    ).toBe(SQLSTATE.foreignKeyViolation);
    const [event] = await withShop(app.db, shopA, (tx) =>
      tx
        .insert(auditEvents)
        .values({
          shopId: shopA,
          actorUserId: managerId,
          action: 'device.revoked',
          entityType: 'device',
          entityId: deviceId,
          deviceId,
        })
        .returning(),
    );
    expect(event?.deviceId).toBe(deviceId);
  });
});

describe('permisos de app en las tablas de acceso', () => {
  it('devices, backup_codes y users sin DELETE; sessions con DELETE', async () => {
    const owner = connectAs('owner');
    try {
      const privilegesOf = async (table: string): Promise<Record<string, boolean>> => {
        const { rows } = await owner.pool.query<{ p: string; v: boolean }>(
          `select p, has_table_privilege('app', $1, p) as v
           from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as p`,
          [table],
        );
        return Object.fromEntries(rows.map((r) => [r.p, r.v]));
      };
      const readWrite = { SELECT: true, INSERT: true, UPDATE: true };
      expect(await privilegesOf('devices')).toEqual({ ...readWrite, DELETE: false });
      expect(await privilegesOf('backup_codes')).toEqual({ ...readWrite, DELETE: false });
      expect(await privilegesOf('users')).toEqual({ ...readWrite, DELETE: false });
      expect(await privilegesOf('sessions')).toEqual({ ...readWrite, DELETE: true });
    } finally {
      await owner.close();
    }
  });
});
