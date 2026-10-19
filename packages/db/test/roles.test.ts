import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadRootEnv, readDbEnv } from '../src/env.ts';
import { connectAs, pgCode, poolAs, SQLSTATE } from './setup/db.ts';

describe('roles owner y app', () => {
  const owner = poolAs('owner');

  afterAll(async () => {
    await owner.end();
  });

  it('ninguno es superusuario, ni se salta RLS, ni crea bases o roles', async () => {
    const { rows } = await owner.query<{
      rolname: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
      rolcreatedb: boolean;
      rolcreaterole: boolean;
      rolcanlogin: boolean;
    }>(`select rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolcanlogin
        from pg_roles where rolname in ('owner', 'app') order by 1`);
    expect(rows).toEqual([
      {
        rolname: 'app',
        rolsuper: false,
        rolbypassrls: false,
        rolcreatedb: false,
        rolcreaterole: false,
        rolcanlogin: true,
      },
      {
        rolname: 'owner',
        rolsuper: false,
        rolbypassrls: false,
        rolcreatedb: false,
        rolcreaterole: false,
        rolcanlogin: true,
      },
    ]);
  });

  it('la base de pruebas pertenece a owner', async () => {
    const { rows } = await owner.query<{ dueno: string }>(
      'select pg_get_userbyid(datdba) as dueno from pg_database where datname = current_database()',
    );
    expect(rows[0]?.dueno).toBe('owner');
  });

  it('owner trabaja en UTC', async () => {
    const { rows } = await owner.query<{ TimeZone: string }>('show timezone');
    expect(rows[0]?.TimeZone).toBe('UTC');
  });
});

describe('lo que app no puede hacer', () => {
  let app: ReturnType<typeof connectAs>;

  beforeAll(() => {
    app = connectAs('app');
  });

  afterAll(async () => {
    await app.close();
  });

  it('no crea tablas ni esquemas (42501)', async () => {
    expect(await pgCode(app.pool.query('create table intruso (i int)'))).toBe(
      SQLSTATE.insufficientPrivilege,
    );
    expect(await pgCode(app.pool.query('create schema intruso'))).toBe(
      SQLSTATE.insufficientPrivilege,
    );
  });

  it('no inserta barberías (42501) y trabaja en UTC', async () => {
    expect(
      await pgCode(app.pool.query("insert into shops (slug, name) values ('intrusa', 'X')")),
    ).toBe(SQLSTATE.insufficientPrivilege);
    const { rows } = await app.pool.query<{ TimeZone: string }>('show timezone');
    expect(rows[0]?.TimeZone).toBe('UTC');
  });
});

describe('variables de entorno', () => {
  it('readDbEnv exige las dos URLs y toma el nombre de la base de pruebas de POSTGRES_TEST_DB', () => {
    expect(() => readDbEnv({})).toThrow(/DATABASE_URL_OWNER/);
    expect(
      readDbEnv({
        DATABASE_URL_OWNER: 'postgres://o@h/d',
        DATABASE_URL: 'postgres://a@h/d',
        POSTGRES_TEST_DB: 'x_test',
      }).testDbName,
    ).toBe('x_test');
    loadRootEnv(); // no lanza aunque .env no exista (.env.example sí existe)
  });
});
