CREATE TABLE "print_parts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"print_id" uuid NOT NULL,
	"name" text NOT NULL,
	"print_minutes" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "print_spools" ADD COLUMN "part_id" uuid;--> statement-breakpoint
ALTER TABLE "print_parts" ADD CONSTRAINT "print_parts_print_id_prints_id_fk" FOREIGN KEY ("print_id") REFERENCES "public"."prints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "print_parts_print_idx" ON "print_parts" USING btree ("print_id");--> statement-breakpoint
ALTER TABLE "print_spools" ADD CONSTRAINT "print_spools_part_id_print_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."print_parts"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- Convert old multi-print models into single prints with parts (same SQL as src/lib/db/legacy.ts)
CREATE TEMP TABLE _legacy_parts AS
     SELECT id, model_id, part_name, print_minutes,
       row_number() OVER w AS rn,
       first_value(id) OVER w AS parent_id
     FROM prints
     WHERE model_id IS NOT NULL AND deleted_at IS NULL
     WINDOW w AS (PARTITION BY model_id ORDER BY printed_at, created_at);
--> statement-breakpoint
INSERT INTO print_parts (id, print_id, name, print_minutes, sort_order)
     SELECT id, parent_id, coalesce(nullif(part_name, ''), 'Part ' || rn), print_minutes, rn FROM _legacy_parts;
--> statement-breakpoint
UPDATE print_spools ps SET part_id = l.id, print_id = l.parent_id FROM _legacy_parts l WHERE ps.print_id = l.id;
--> statement-breakpoint
UPDATE photos ph SET print_id = l.parent_id FROM _legacy_parts l WHERE ph.print_id = l.id AND l.rn > 1;
--> statement-breakpoint
UPDATE prints p SET
       print_minutes = s.mins, labour_minutes = s.labour,
       filament_cost = s.fc, electricity_cost = s.ec, wear_cost = s.wc, labour_cost = s.lc,
       buffer_cost = s.bc, total_cost = s.tc, selling_price = s.sp, profit = s.pr,
       price_overridden = s.po, status = s.st, model_name = coalesce(s.mname, p.model_name),
       model_id = NULL, part_name = ''
     FROM (
       SELECT l.parent_id, sum(c.print_minutes) AS mins, sum(c.labour_minutes) AS labour,
         sum(c.filament_cost) AS fc, sum(c.electricity_cost) AS ec, sum(c.wear_cost) AS wc,
         sum(c.labour_cost) AS lc, sum(c.buffer_cost) AS bc, sum(c.total_cost) AS tc,
         sum(c.selling_price) AS sp, sum(c.profit) AS pr, bool_or(c.price_overridden) AS po,
         CASE WHEN bool_and(c.status = 'failed') THEN 'failed' ELSE 'success' END AS st,
         max(m.name) AS mname
       FROM _legacy_parts l
       JOIN prints c ON c.id = l.id
       LEFT JOIN models m ON m.id = l.model_id
       GROUP BY l.parent_id
     ) s
     WHERE p.id = s.parent_id;
--> statement-breakpoint
DELETE FROM prints p USING _legacy_parts l WHERE p.id = l.id AND l.rn > 1;
--> statement-breakpoint
UPDATE models SET deleted_at = now() WHERE deleted_at IS NULL;
--> statement-breakpoint
DROP TABLE _legacy_parts;
