-- Descuentos y anulaciones (LP-10): las dos tablas solo crecen (trigger reject_mutation también para el dueño,
-- app sin UPDATE/DELETE/TRUNCATE) y están aisladas por barbería.
CALL make_append_only('sale_discounts');
--> statement-breakpoint
CALL make_append_only('sale_voids');
--> statement-breakpoint
CALL make_shop_scoped('sale_discounts');
--> statement-breakpoint
CALL make_shop_scoped('sale_voids');
