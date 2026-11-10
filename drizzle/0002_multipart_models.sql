CREATE TABLE "models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "prints" ADD COLUMN "model_id" uuid;--> statement-breakpoint
ALTER TABLE "prints" ADD COLUMN "part_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "prints" ADD CONSTRAINT "prints_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prints_model_idx" ON "prints" ("model_id");
