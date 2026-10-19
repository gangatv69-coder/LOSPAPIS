-- Patrones de la base de datos de LOS PAPIS. Se ejecuta como el rol `owner` (dueño de la base).
-- Los roles `owner` y `app` existen antes de la primera migración: los crea infra/postgres/init/01-roles.sh.
GRANT USAGE ON SCHEMA public TO app;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
--> statement-breakpoint
-- Toda tabla que cree `owner` a partir de ahora: la app puede leer y escribir filas (nunca tocar la estructura).
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app;
--> statement-breakpoint
-- Barbería activa en la transacción actual: la fija la aplicación con set_config('app.shop_id', <uuid>, true).
-- nullif: tras un set_config anterior en la misma conexión, current_setting devuelve '' y no NULL.
CREATE FUNCTION current_shop_id() RETURNS uuid
LANGUAGE sql STABLE
RETURN nullif(current_setting('app.shop_id', true), '')::uuid;
--> statement-breakpoint
-- "El libro solo crece": rechaza UPDATE, DELETE y TRUNCATE para cualquier rol, incluido el dueño.
CREATE FUNCTION reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'La tabla % solo crece: % no está permitido', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'LP001',
          HINT = 'Registra una anulación o una corrección como un movimiento nuevo.';
END;
$$;
--> statement-breakpoint
-- Convierte una tabla en "solo crece": trigger siempre activo + permisos mínimos para `app` (leer e insertar).
CREATE PROCEDURE make_append_only(tbl regclass)
LANGUAGE plpgsql AS $$
DECLARE
  rel text := (SELECT relname FROM pg_class WHERE oid = tbl);
  trg text := (SELECT relname FROM pg_class WHERE oid = tbl) || '_append_only';
BEGIN
  EXECUTE format(
    'CREATE TRIGGER %I BEFORE UPDATE OR DELETE OR TRUNCATE ON %s FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation()',
    trg, tbl);
  -- ALWAYS: también se dispara con session_replication_role = replica.
  EXECUTE format('ALTER TABLE %s ENABLE ALWAYS TRIGGER %I', tbl, trg);
  EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %s FROM app', tbl);
  EXECUTE format('GRANT SELECT, INSERT ON %s TO app', tbl);
  RAISE NOTICE 'tabla % protegida: solo crece', rel;
END;
$$;
--> statement-breakpoint
-- Aísla una tabla por barbería: `app` solo ve y escribe filas de la barbería activa (Row Level Security).
-- El dueño (owner) y los superusuarios no están sujetos a la política (no se usa FORCE).
CREATE PROCEDURE make_shop_scoped(tbl regclass)
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute WHERE attrelid = tbl AND attname = 'shop_id' AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'La tabla % no tiene columna shop_id', tbl;
  END IF;
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', tbl);
  EXECUTE format(
    'CREATE POLICY shop_isolation ON %s FOR ALL TO app USING (shop_id = current_shop_id()) WITH CHECK (shop_id = current_shop_id())',
    tbl);
END;
$$;
