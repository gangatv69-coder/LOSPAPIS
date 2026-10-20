-- Propinas (LP-23): la tabla solo crece (trigger reject_mutation también para el dueño, app sin
-- UPDATE/DELETE/TRUNCATE) y está aislada por barbería.
CALL make_append_only('sale_tips');
--> statement-breakpoint
CALL make_shop_scoped('sale_tips');
