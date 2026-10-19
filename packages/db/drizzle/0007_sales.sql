CREATE TYPE "public"."payment_method" AS ENUM('cash', 'card');--> statement-breakpoint
CREATE TYPE "public"."sale_line_kind" AS ENUM('service', 'product');--> statement-breakpoint
CREATE TABLE "sale_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"shop_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"kind" "sale_line_kind" NOT NULL,
	"service_id" uuid,
	"product_id" uuid,
	"name" text NOT NULL,
	"unit_price_cents" bigint NOT NULL,
	"quantity" integer NOT NULL,
	"line_total_cents" bigint NOT NULL,
	CONSTRAINT "sale_lines_position_nonnegative" CHECK ("sale_lines"."position" >= 0),
	CONSTRAINT "sale_lines_unit_price_nonnegative" CHECK ("sale_lines"."unit_price_cents" >= 0),
	CONSTRAINT "sale_lines_quantity_range" CHECK ("sale_lines"."quantity" >= 1 AND "sale_lines"."quantity" <= 99),
	CONSTRAINT "sale_lines_total_consistent" CHECK ("sale_lines"."line_total_cents" = "sale_lines"."unit_price_cents" * "sale_lines"."quantity"),
	CONSTRAINT "sale_lines_kind_reference" CHECK (("sale_lines"."kind" = 'service' AND "sale_lines"."service_id" IS NOT NULL AND "sale_lines"."product_id" IS NULL) OR ("sale_lines"."kind" = 'product' AND "sale_lines"."product_id" IS NOT NULL AND "sale_lines"."service_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "sale_payments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"shop_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"method" "payment_method" NOT NULL,
	"amount_cents" bigint NOT NULL,
	"tendered_cents" bigint,
	"change_cents" bigint,
	CONSTRAINT "sale_payments_amount_nonnegative" CHECK ("sale_payments"."amount_cents" >= 0),
	CONSTRAINT "sale_payments_cash_consistent" CHECK (("sale_payments"."tendered_cents" IS NULL AND "sale_payments"."change_cents" IS NULL) OR ("sale_payments"."tendered_cents" >= "sale_payments"."amount_cents" AND "sale_payments"."change_cents" = "sale_payments"."tendered_cents" - "sale_payments"."amount_cents"))
);
--> statement-breakpoint
CREATE TABLE "sale_receipts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"shop_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"receipt_number" text NOT NULL,
	"recorded_by_user_id" uuid,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"shop_id" uuid NOT NULL,
	"cash_day" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"barber_id" uuid NOT NULL,
	"manager_id" uuid NOT NULL,
	"device_id" uuid,
	"created_by_user_id" uuid,
	"subtotal_cents" bigint NOT NULL,
	"discount_cents" bigint DEFAULT 0 NOT NULL,
	"total_cents" bigint NOT NULL,
	"request_hash" text NOT NULL,
	CONSTRAINT "sales_subtotal_cents_nonnegative" CHECK ("sales"."subtotal_cents" >= 0),
	CONSTRAINT "sales_discount_cents_nonnegative" CHECK ("sales"."discount_cents" >= 0),
	CONSTRAINT "sales_total_cents_consistent" CHECK ("sales"."total_cents" = "sales"."subtotal_cents" - "sales"."discount_cents"),
	CONSTRAINT "sales_cash_day_format" CHECK ("sales"."cash_day" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
);
--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_receipts" ADD CONSTRAINT "sale_receipts_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_receipts" ADD CONSTRAINT "sale_receipts_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_receipts" ADD CONSTRAINT "sale_receipts_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_barber_id_barbers_id_fk" FOREIGN KEY ("barber_id") REFERENCES "public"."barbers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_manager_id_users_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sale_lines_sale_id_index" ON "sale_lines" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "sale_payments_sale_id_index" ON "sale_payments" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "sale_receipts_sale_id_index" ON "sale_receipts" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "sales_shop_id_cash_day_index" ON "sales" USING btree ("shop_id","cash_day");--> statement-breakpoint
CREATE INDEX "sales_shop_id_occurred_at_index" ON "sales" USING btree ("shop_id","occurred_at");