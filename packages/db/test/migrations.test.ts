import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MIGRATIONS_FOLDER, runMigrations } from '../src/migrate.ts';
import { poolAs, testDb, uniqueSlug } from './setup/db.ts';

const journal = JSON.parse(
  readFileSync(join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8'),
) as {
  entries: { tag: string }[];
};

describe('migraciones', () => {
  it('global-setup aplicó todas las del journal (al menos las tres de LP-02)', () => {
    expect(journal.entries.length).toBeGreaterThanOrEqual(3);
    expect(journal.entries.slice(0, 3).map((e) => e.tag)).toEqual([
      '0000_patterns',
      '0001_base-tables',
      '0002_apply-patterns',
    ]);
    expect(testDb().migrationsApplied).toBe(journal.entries.length);
  });

  it('volver a migrar no aplica nada nuevo (idempotente)', async () => {
    expect(await runMigrations(testDb().ownerUrl)).toBe(journal.entries.length);
  });

  it('los ids son UUID v7 generados por PostgreSQL 18 y crecen con el tiempo', async () => {
    const owner = poolAs('owner');
    try {
      const insert = async (): Promise<string> => {
        const { rows } = await owner.query<{ id: string }>(
          'insert into shops (slug, name) values ($1, $2) returning id',
          [uniqueSlug('uuid'), 'UUID'],
        );
        return rows[0]?.id ?? '';
      };
      const first = await insert();
      const second = await insert();
      expect(first.charAt(14)).toBe('7');
      expect(second.charAt(14)).toBe('7');
      expect(second > first).toBe(true);
    } finally {
      await owner.end();
    }
  });

  it('timestamptz: el instante que entra es el que sale, y la sesión trabaja en UTC', async () => {
    const owner = poolAs('owner');
    try {
      const { rows: tz } = await owner.query<{ TimeZone: string }>('show timezone');
      expect(tz[0]?.TimeZone).toBe('UTC');
      const { rows: shop } = await owner.query<{ id: string }>(
        'insert into shops (slug, name) values ($1, $2) returning id',
        [uniqueSlug('tz'), 'TZ'],
      );
      const instant = new Date('2027-03-28T01:00:00.000Z'); // el minuto del cambio de hora
      const { rows } = await owner.query<{ occurred_at: Date }>(
        'insert into audit_events (shop_id, occurred_at, action, entity_type) values ($1, $2, $3, $4) returning occurred_at',
        [shop[0]?.id, instant, 'test.timezone', 'shop'],
      );
      expect(rows[0]?.occurred_at.toISOString()).toBe(instant.toISOString());
    } finally {
      await owner.end();
    }
  });
});
