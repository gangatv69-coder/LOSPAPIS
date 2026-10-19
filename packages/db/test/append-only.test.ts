import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DbHandle } from '../src/client.ts';
import { APPEND_ONLY_TABLES } from '../src/registry.ts';
import { auditEvents, shops } from '../src/schema/index.ts';
import { withShop } from '../src/tenant.ts';
import { connectAs, pgCode, SQLSTATE, uniqueSlug } from './setup/db.ts';

describe('audit_events solo crece', () => {
  let owner: DbHandle;
  let app: DbHandle;
  let shopId = '';

  beforeAll(async () => {
    owner = connectAs('owner');
    app = connectAs('app');
    const [shop] = await owner.db
      .insert(shops)
      .values({ slug: uniqueSlug('append'), name: 'Append' })
      .returning();
    if (!shop) throw new Error('sin barbería');
    shopId = shop.id;
    await owner.db
      .insert(auditEvents)
      .values({ shopId, action: 'test.seed', entityType: 'shop', entityId: shopId });
  });

  afterAll(async () => {
    await owner.close();
    await app.close();
  });

  it('ni el dueño de la tabla puede editar, borrar ni vaciar: el trigger responde LP001 (ORM)', async () => {
    expect(
      await pgCode(
        owner.db.update(auditEvents).set({ reason: 'x' }).where(eq(auditEvents.shopId, shopId)),
      ),
    ).toBe(SQLSTATE.appendOnly);
    expect(await pgCode(owner.db.delete(auditEvents).where(eq(auditEvents.shopId, shopId)))).toBe(
      SQLSTATE.appendOnly,
    );
    expect(await pgCode(owner.db.execute(sql`truncate audit_events`))).toBe(SQLSTATE.appendOnly);
  });

  it('con SQL directo, incluso sin filas afectadas, el trigger sigue rechazando', async () => {
    expect(await pgCode(owner.pool.query("update audit_events set reason = 'x' where false"))).toBe(
      SQLSTATE.appendOnly,
    );
    expect(await pgCode(owner.pool.query('delete from audit_events where false'))).toBe(
      SQLSTATE.appendOnly,
    );
  });

  it('la fila sigue intacta', async () => {
    const rows = await owner.db.select().from(auditEvents).where(eq(auditEvents.shopId, shopId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.reason).toBeNull();
  });

  it('el rol app inserta y lee en su barbería', async () => {
    const rows = await withShop(app.db, shopId, async (tx) => {
      await tx
        .insert(auditEvents)
        .values({ shopId, action: 'test.app', entityType: 'shop', entityId: shopId });
      return tx.select().from(auditEvents).where(eq(auditEvents.shopId, shopId));
    });
    expect(rows).toHaveLength(2);
  });

  it('el rol app no tiene permiso de UPDATE, DELETE ni TRUNCATE (42501, antes de llegar al trigger)', async () => {
    expect(
      await pgCode(
        withShop(app.db, shopId, (tx) =>
          tx.update(auditEvents).set({ reason: 'x' }).where(eq(auditEvents.shopId, shopId)),
        ),
      ),
    ).toBe(SQLSTATE.insufficientPrivilege);
    expect(
      await pgCode(
        withShop(app.db, shopId, (tx) =>
          tx.delete(auditEvents).where(eq(auditEvents.shopId, shopId)),
        ),
      ),
    ).toBe(SQLSTATE.insufficientPrivilege);
    expect(await pgCode(app.pool.query('truncate audit_events'))).toBe(
      SQLSTATE.insufficientPrivilege,
    );
  });

  it('el rol app no puede quitar ni desactivar el trigger', async () => {
    expect(
      await pgCode(app.pool.query('drop trigger audit_events_append_only on audit_events')),
    ).toBe(SQLSTATE.insufficientPrivilege);
    expect(await pgCode(app.pool.query('alter table audit_events disable trigger all'))).toBe(
      SQLSTATE.insufficientPrivilege,
    );
  });
});

describe('patrón reutilizable make_append_only', () => {
  it('APPEND_ONLY_TABLES coincide con las tablas que llevan reject_mutation, siempre activo y por sentencia', async () => {
    const owner = connectAs('owner');
    try {
      const { rows } = await owner.pool.query<{
        table: string;
        enabled: string;
        definition: string;
      }>(`
        select c.relname as "table", t.tgenabled as enabled, pg_get_triggerdef(t.oid) as definition
        from pg_trigger t
        join pg_class c on c.oid = t.tgrelid
        join pg_proc p on p.oid = t.tgfoid
        where not t.tgisinternal and p.proname = 'reject_mutation'
        order by 1`);
      expect(rows.map((r) => r.table).sort()).toEqual([...APPEND_ONLY_TABLES].sort());
      for (const row of rows) {
        expect(row.enabled).toBe('A');
        expect(row.definition).toMatch(
          /BEFORE DELETE OR UPDATE OR TRUNCATE ON public\.\w+ FOR EACH STATEMENT/,
        );
      }
    } finally {
      await owner.close();
    }
  });

  it('en cada tabla que solo crece, app solo puede SELECT e INSERT', async () => {
    const owner = connectAs('owner');
    try {
      for (const table of APPEND_ONLY_TABLES) {
        const { rows } = await owner.pool.query<{ p: string; v: boolean }>(
          `select p, has_table_privilege('app', $1, p) as v
           from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) as p`,
          [table],
        );
        expect(Object.fromEntries(rows.map((r) => [r.p, r.v]))).toEqual({
          SELECT: true,
          INSERT: true,
          UPDATE: false,
          DELETE: false,
          TRUNCATE: false,
        });
      }
    } finally {
      await owner.close();
    }
  });
});
