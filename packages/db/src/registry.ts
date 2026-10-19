/**
 * Registro de patrones aplicados en las migraciones. Las pruebas estructurales (test/*.test.ts) cotejan
 * estas listas con el catálogo de PostgreSQL: una tabla nueva que no esté aquí hace fallar `pnpm test`.
 */

/** Tablas "que solo crecen": trigger reject_mutation siempre activo y `app` sin UPDATE/DELETE/TRUNCATE.
 *  Al crear una tabla de dinero o de stock: añadirla aquí Y en su migración `CALL make_append_only('tabla')`. */
export const APPEND_ONLY_TABLES = ['audit_events'] as const;

/** Tablas de negocio aisladas por barbería: columna shop_id, RLS y política shop_isolation para `app`.
 *  Al crear una tabla de negocio: añadirla aquí Y en su migración `CALL make_shop_scoped('tabla')`. */
export const SHOP_SCOPED_TABLES = ['users', 'audit_events'] as const;

/** Tablas sin shop_id: el registro de barberías. Toda tabla de `public` debe estar en una de las dos listas. */
export const SHOP_REGISTRY_TABLES = ['shops'] as const;

export type AppendOnlyTable = (typeof APPEND_ONLY_TABLES)[number];
export type ShopScopedTable = (typeof SHOP_SCOPED_TABLES)[number];
