-- Aplica los patrones a las tablas de acceso (LP-05): las tres aisladas por barbería.
CALL make_shop_scoped('devices');
--> statement-breakpoint
CALL make_shop_scoped('sessions');
--> statement-breakpoint
CALL make_shop_scoped('backup_codes');
--> statement-breakpoint
-- Los dispositivos nunca se borran: se revocan (la auditoría sigue apuntando a ellos).
REVOKE DELETE ON devices FROM app;
--> statement-breakpoint
-- Los códigos de respaldo se marcan usados o revocados; el historial se conserva.
-- Las sesiones sí se pueden borrar: limpieza de las caducadas.
REVOKE DELETE ON backup_codes FROM app;
