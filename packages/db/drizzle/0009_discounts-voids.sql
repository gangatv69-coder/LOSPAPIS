CREATE TYPE "public"."discount_kind" AS ENUM('loyalty', 'manager', 'courtesy');--> statement-breakpoint
CREATE TYPE "public"."discount_mode" AS ENUM('percent', 'amount');--> statement-breakpoint
CREATE TABLE "sale_discounts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"shop_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"sale_line_id" uuid,
	"position" integer NOT NULL,
	"kind" "discount_kind" NOT NULL,
	"mode" "discount_mode" NOT NULL,
	"value" bigint NOT NULL,
	"amount_cents" bigint NOT NULL,
	"reason" text NOT NULL,
	"authorized_by_user_id" uuid NOT NULL,
	CONSTRAINT "sale_discounts_position_nonnegative" CHECK ("sale_discounts"."position" >= 0),
	CONSTRAINT "sale_discounts_value_positive" CHECK ("sale_discounts"."value" >= 1),
	CONSTRAINT "sale_discounts_percent_range" CHECK ("sale_discounts"."mode" <> 'percent' OR "sale_discounts"."value" <= 10000),
	CONSTRAINT "sale_discounts_amount_nonnegative" CHECK ("sale_discounts"."amount_cents" >= 0),
	CONSTRAINT "sale_discounts_reason_present" CHECK (length(btrim("sale_discounts"."reason")) > 0),
	CONSTRAINT "sale_discounts_courtesy_full_line" CHECK ("sale_discounts"."kind" <> 'courtesy' OR ("sale_discounts"."mode" = 'percent' AND "sale_discounts"."value" = 10000 AND "sale_discounts"."sale_line_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "sale_voids" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"shop_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"voided_by_user_id" uuid NOT NULL,
	"device_id" uuid,
	"created_by_user_id" uuid,
	"cash_day" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sale_voids_reason_present" CHECK (length(btrim("sale_voids"."reason")) > 0),
	CONSTRAINT "sale_voids_cash_day_format" CHECK ("sale_voids"."cash_day" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
);
--> statement-breakpoint
ALTER TABLE "sale_lines" ADD COLUMN "discount_cents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sale_discounts" ADD CONSTRAINT "sale_discounts_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_discounts" ADD CONSTRAINT "sale_discounts_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_discounts" ADD CONSTRAINT "sale_discounts_sale_line_id_sale_lines_id_fk" FOREIGN KEY ("sale_line_id") REFERENCES "public"."sale_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_discounts" ADD CONSTRAINT "sale_discounts_authorized_by_user_id_users_id_fk" FOREIGN KEY ("authorized_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_voids" ADD CONSTRAINT "sale_voids_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_voids" ADD CONSTRAINT "sale_voids_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_voids" ADD CONSTRAINT "sale_voids_voided_by_user_id_users_id_fk" FOREIGN KEY ("voided_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_voids" ADD CONSTRAINT "sale_voids_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_voids" ADD CONSTRAINT "sale_voids_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sale_discounts_sale_id_index" ON "sale_discounts" USING btree ("sale_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sale_voids_sale_id_index" ON "sale_voids" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "sale_voids_shop_id_cash_day_index" ON "sale_voids" USING btree ("shop_id","cash_day");--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_discount_range" CHECK ("sale_lines"."discount_cents" >= 0 AND "sale_lines"."discount_cents" <= "sale_lines"."line_total_cents");