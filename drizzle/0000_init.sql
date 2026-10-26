CREATE TABLE "photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"print_id" uuid NOT NULL,
	"mime_type" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "print_spools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"print_id" uuid NOT NULL,
	"spool_id" uuid NOT NULL,
	"model_g" double precision NOT NULL,
	"purge_g" double precision NOT NULL,
	"extra_g" double precision NOT NULL,
	"total_g" double precision NOT NULL,
	"cost_per_g_snapshot" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "print_spools_nonneg" CHECK ("print_spools"."model_g" >= 0 AND "print_spools"."purge_g" >= 0 AND "print_spools"."extra_g" >= 0)
);
--> statement-breakpoint
CREATE TABLE "prints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model_name" text NOT NULL,
	"printed_at" timestamp with time zone NOT NULL,
	"print_minutes" integer NOT NULL,
	"status" text DEFAULT 'success' NOT NULL,
	"labour_minutes" integer DEFAULT 0 NOT NULL,
	"electricity_rate" double precision NOT NULL,
	"printer_watts" double precision NOT NULL,
	"wear_rate" double precision NOT NULL,
	"labour_rate" double precision NOT NULL,
	"buffer_pct" double precision NOT NULL,
	"markup_pct" double precision NOT NULL,
	"filament_cost" double precision NOT NULL,
	"electricity_cost" double precision NOT NULL,
	"wear_cost" double precision NOT NULL,
	"labour_cost" double precision NOT NULL,
	"buffer_cost" double precision NOT NULL,
	"total_cost" double precision NOT NULL,
	"selling_price" double precision NOT NULL,
	"price_overridden" boolean DEFAULT false NOT NULL,
	"profit" double precision NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "prints_minutes_pos" CHECK ("prints"."print_minutes" > 0)
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"default_purge_g" double precision DEFAULT 5 NOT NULL,
	"electricity_rate" double precision DEFAULT 8 NOT NULL,
	"printer_watts" double precision DEFAULT 150 NOT NULL,
	"wear_rate" double precision DEFAULT 5 NOT NULL,
	"labour_rate" double precision DEFAULT 200 NOT NULL,
	"buffer_pct" double precision DEFAULT 10 NOT NULL,
	"markup_pct" double precision DEFAULT 50 NOT NULL,
	"low_stock_g" double precision DEFAULT 100 NOT NULL,
	"theme" text DEFAULT 'system' NOT NULL,
	"last_backup_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spool_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"spool_id" uuid NOT NULL,
	"measured_gross_g" double precision NOT NULL,
	"remaining_before_g" double precision NOT NULL,
	"remaining_after_g" double precision NOT NULL,
	"delta_g" double precision NOT NULL,
	"adjusted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"spool_code" text NOT NULL,
	"name" text NOT NULL,
	"brand" text DEFAULT '' NOT NULL,
	"material" text DEFAULT 'PLA' NOT NULL,
	"colour_name" text DEFAULT '' NOT NULL,
	"colour_hex" text DEFAULT '#888888' NOT NULL,
	"diameter_mm" double precision DEFAULT 1.75 NOT NULL,
	"price" double precision DEFAULT 0 NOT NULL,
	"net_weight_g" double precision DEFAULT 1000 NOT NULL,
	"tare_weight_g" double precision DEFAULT 0 NOT NULL,
	"purchase_date" date,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "spools_weights_nonneg" CHECK ("spools"."price" >= 0 AND "spools"."net_weight_g" >= 0 AND "spools"."tare_weight_g" >= 0)
);
--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_print_id_prints_id_fk" FOREIGN KEY ("print_id") REFERENCES "public"."prints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_spools" ADD CONSTRAINT "print_spools_print_id_prints_id_fk" FOREIGN KEY ("print_id") REFERENCES "public"."prints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_spools" ADD CONSTRAINT "print_spools_spool_id_spools_id_fk" FOREIGN KEY ("spool_id") REFERENCES "public"."spools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spool_adjustments" ADD CONSTRAINT "spool_adjustments_spool_id_spools_id_fk" FOREIGN KEY ("spool_id") REFERENCES "public"."spools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "photos_print_idx" ON "photos" USING btree ("print_id");--> statement-breakpoint
CREATE INDEX "print_spools_spool_idx" ON "print_spools" USING btree ("spool_id");--> statement-breakpoint
CREATE INDEX "print_spools_print_idx" ON "print_spools" USING btree ("print_id");--> statement-breakpoint
CREATE INDEX "prints_printed_at_idx" ON "prints" USING btree ("printed_at");--> statement-breakpoint
CREATE INDEX "spool_adjustments_spool_idx" ON "spool_adjustments" USING btree ("spool_id");--> statement-breakpoint
-- Hand-written additions (not expressible in the Drizzle schema)
CREATE UNIQUE INDEX "spools_code_unique" ON "spools" (lower(btrim("spool_code"))) WHERE "deleted_at" IS NULL;--> statement-breakpoint
INSERT INTO "settings" ("id") VALUES (1) ON CONFLICT DO NOTHING;
