-- Aplica los patrones a las tablas base.
CALL make_shop_scoped('users');
--> statement-breakpoint
CALL make_shop_scoped('audit_events');
--> statement-breakpoint
CALL make_append_only('audit_events');
--> statement-breakpoint
-- Las cuentas nunca se borran: se desactivan (PRD §6).
REVOKE DELETE ON users FROM app;
--> statement-breakpoint
-- shops es el registro de barberías: la app lo lee y actualiza (ajustes), pero no crea ni borra barberías.
REVOKE INSERT, DELETE ON shops FROM app;
