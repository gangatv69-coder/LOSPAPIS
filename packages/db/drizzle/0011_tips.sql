CREATE TABLE "sale_tips" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"shop_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"barber_id" uuid NOT NULL,
	"amount_cents" bigint NOT NULL,
	"method" "payment_method" NOT NULL,
	"recorded_by_user_id" uuid NOT NULL,
	"device_id" uuid,
	"created_by_user_id" uuid,
	"cash_day" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sale_tips_amount_positive" CHECK ("sale_tips"."amount_cents" >= 1),
	CONSTRAINT "sale_tips_cash_day_format" CHECK ("sale_tips"."cash_day" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
);
--> statement-breakpoint
ALTER TABLE "sale_tips" ADD CONSTRAINT "sale_tips_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_tips" ADD CONSTRAINT "sale_tips_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_tips" ADD CONSTRAINT "sale_tips_barber_id_barbers_id_fk" FOREIGN KEY ("barber_id") REFERENCES "public"."barbers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_tips" ADD CONSTRAINT "sale_tips_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_tips" ADD CONSTRAINT "sale_tips_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_tips" ADD CONSTRAINT "sale_tips_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sale_tips_sale_id_index" ON "sale_tips" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "sale_tips_shop_id_cash_day_index" ON "sale_tips" USING btree ("shop_id","cash_day");