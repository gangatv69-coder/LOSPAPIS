import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DbHandle } from '../src/client.ts';
import { SHOP_REGISTRY_TABLES, SHOP_SCOPED_TABLES } from '../src/registry.ts';
import { auditEvents, shops, users } from '../src/schema/index.ts';
import { SHOP_SETTING, withShop } from '../src/tenant.ts';
import { connectAs, pgCode, SQLSTATE, uniqueSlug } from './setup/db.ts';

describe('aislamiento por barbería (RLS)', () => {
  let owner: DbHandle;
  let app: DbHandle;
  let shopA = '';
  let shopB = '';
  let brunoId = '';

  beforeAll(async () => {
    owner = connectAs('owner');
    app = connectAs('app');
    const created = await owner.db
      .insert(shops)
      .values([
        { slug: uniqueSlug('rls-a'), name: 'Barbería A' },
        { slug: uniqueSlug('rls-b'), name: 'Barbería B' },
      ])
      .returning();
    shopA = created[0]?.id ?? '';
    shopB = created[1]?.id ?? '';
    const people = await owner.db
      .insert(users)
      .values([
        { shopId: shopA, displayName: 'Ana', role: 'manager' },
        { shopId: shopB, displayName: 'Bruno', role: 'barber' },
      ])
      .returning();
    brunoId = people[1]?.id ?? '';
    await owner.db.insert(auditEvents).values([
      { shopId: shopA, action: 'test.a', entityType: 'shop', entityId: shopA },
      { shopId: shopB, action: 'test.b', entityType: 'shop', entityId: shopB },
    ]);
  });

  afterAll(async () => {
    await owner.close();
    await app.close();
  });

  it('sin barbería fijada, app no ve ninguna fila de users ni de audit_events', async () => {
    expect(await app.db.select().from(users)).toEqual([]);
    expect(await app.db.select().from(auditEvents)).toEqual([]);
  });

  it('app sí lee el registro de barberías', async () => {
    const rows = await app.db
      .select({ id: shops.id })
      .from(shops)
      .where(inArray(shops.id, [shopA, shopB]));
    expect(rows).toHaveLength(2);
  });

  it('con la barbería A fijada, app ve solo lo de A', async () => {
    const names = await withShop(app.db, shopA, (tx) =>
      tx.select({ name: users.displayName }).from(users),
    );
    expect(names).toEqual([{ name: 'Ana' }]);
    const events = await withShop(app.db, shopA, (tx) => tx.select().from(auditEvents));
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.shopId === shopA)).toBe(true);
  });

  it('app no puede escribir filas de otra barbería: WITH CHECK responde 42501 y los UPDATE no alcanzan', async () => {
    expect(
      await pgCode(
        withShop(app.db, shopA, (tx) =>
          tx
            .insert(auditEvents)
            .values({ shopId: shopB, action: 'test.intruso', entityType: 'shop' }),
        ),
      ),
    ).toBe(SQLSTATE.insufficientPrivilege);
    const updated = await withShop(app.db, shopA, (tx) =>
      tx.update(users).set({ active: false }).where(eq(users.id, brunoId)).returning(),
    );
    expect(updated).toEqual([]);
    const [bruno] = await owner.db.select().from(users).where(eq(users.id, brunoId));
    expect(bruno?.active).toBe(true);
  });

  it('el contexto muere con la transacción', async () => {
    await withShop(app.db, shopA, (tx) => tx.select().from(users));
    expect(await app.db.select().from(users)).toEqual([]);
  });

  it('withShop rechaza un shopId que no es UUID antes de tocar la base', async () => {
    await expect(withShop(app.db, 'no-es-uuid', async () => 1)).rejects.toThrow(RangeError);
  });

  it('un valor que no es UUID en la sesión da error de cast, nunca filas de otra barbería', async () => {
    const client = await app.pool.connect();
    try {
      await client.query('begin');
      await client.query('select set_config($1, $2, true)', [SHOP_SETTING, 'basura']);
      expect(await pgCode(client.query('select count(*) from users'))).toBe(
        SQLSTATE.invalidTextRepresentation,
      );
      await client.query('rollback');
    } finally {
      client.release();
    }
  });

  it('el dueño (owner) ve todas las barberías: RLS no le afecta', async () => {
    const rows = await owner.db
      .select()
      .from(users)
      .where(inArray(users.shopId, [shopA, shopB]));
    expect(rows).toHaveLength(2);
  });
});

describe('toda tabla de negocio lleva shop_id y está aislada', () => {
  let owner: DbHandle;

  beforeAll(() => {
    owner = connectAs('owner');
  });

  afterAll(async () => {
    await owner.close();
  });

  it('cada tabla de public está en SHOP_SCOPED_TABLES o en SHOP_REGISTRY_TABLES', async () => {
    const { rows } = await owner.pool.query<{ relname: string }>(`
      select c.relname from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p')
      order by 1`);
    expect(rows.map((r) => r.relname)).toEqual(
      [...SHOP_SCOPED_TABLES, ...SHOP_REGISTRY_TABLES].sort(),
    );
  });

  it('las tablas aisladas: shop_id uuid NOT NULL con FK a shops, RLS activa y política shop_isolation para app', async () => {
    for (const table of SHOP_SCOPED_TABLES) {
      const { rows: column } = await owner.pool.query<{ data_type: string; is_nullable: string }>(
        `select data_type, is_nullable from information_schema.columns
         where table_schema = 'public' and table_name = $1 and column_name = 'shop_id'`,
        [table],
      );
      expect(column, table).toEqual([{ data_type: 'uuid', is_nullable: 'NO' }]);

      const { rows: fk } = await owner.pool.query<{ ok: boolean }>(
        `select exists (
           select 1 from pg_constraint
           where conrelid = $1::regclass and contype = 'f' and confrelid = 'shops'::regclass
             and conkey = array[(select attnum from pg_attribute where attrelid = $1::regclass and attname = 'shop_id')]
         ) as ok`,
        [table],
      );
      expect(fk[0]?.ok, table).toBe(true);

      const { rows: rls } = await owner.pool.query<{ relrowsecurity: boolean }>(
        'select relrowsecurity from pg_class where oid = $1::regclass',
        [table],
      );
      expect(rls[0]?.relrowsecurity, table).toBe(true);

      const { rows: policies } = await owner.pool.query<{
        policyname: string;
        roles: string[];
        cmd: string;
        permissive: string;
      }>(
        `select policyname, roles::text[] as roles, cmd, permissive from pg_policies
         where schemaname = 'public' and tablename = $1`,
        [table],
      );
      expect(policies, table).toEqual([
        { policyname: 'shop_isolation', roles: ['app'], cmd: 'ALL', permissive: 'PERMISSIVE' },
      ]);
    }
  });

  it('el registro de barberías no lleva RLS y app solo lo lee y actualiza', async () => {
    for (const table of SHOP_REGISTRY_TABLES) {
      const { rows: rls } = await owner.pool.query<{ relrowsecurity: boolean }>(
        'select relrowsecurity from pg_class where oid = $1::regclass',
        [table],
      );
      expect(rls[0]?.relrowsecurity).toBe(false);
      const { rows } = await owner.pool.query<{ p: string; v: boolean }>(
        `select p, has_table_privilege('app', $1, p) as v
         from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as p`,
        [table],
      );
      expect(Object.fromEntries(rows.map((r) => [r.p, r.v]))).toEqual({
        SELECT: true,
        INSERT: false,
        UPDATE: true,
        DELETE: false,
      });
    }
  });
});
