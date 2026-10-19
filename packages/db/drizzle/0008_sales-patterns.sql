-- El libro de cobros (LP-09): las cuatro tablas solo crecen (trigger reject_mutation también para el dueño,
-- app sin UPDATE/DELETE/TRUNCATE) y están aisladas por barbería.
CALL make_append_only('sales');
--> statement-breakpoint
CALL make_append_only('sale_lines');
--> statement-breakpoint
CALL make_append_only('sale_payments');
--> statement-breakpoint
CALL make_append_only('sale_receipts');
--> statement-breakpoint
CALL make_shop_scoped('sales');
--> statement-breakpoint
CALL make_shop_scoped('sale_lines');
--> statement-breakpoint
CALL make_shop_scoped('sale_payments');
--> statement-breakpoint
CALL make_shop_scoped('sale_receipts');
