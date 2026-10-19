-- Aplica los patrones a las tablas del catálogo y el equipo (LP-08): las cuatro aisladas por barbería.
CALL make_shop_scoped('photos');
--> statement-breakpoint
CALL make_shop_scoped('services');
--> statement-breakpoint
CALL make_shop_scoped('products');
--> statement-breakpoint
CALL make_shop_scoped('barbers');
--> statement-breakpoint
-- Nada se borra: servicios, productos y barberos se desactivan.
REVOKE DELETE ON services, products, barbers FROM app;
--> statement-breakpoint
-- Las fotos son inmutables: una foto nueva es una fila nueva (y la URL cambia, así ninguna pantalla enseña una vieja).
REVOKE UPDATE, DELETE ON photos FROM app;
