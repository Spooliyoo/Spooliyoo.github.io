/**
 * Converts the short-lived "multi-part model" format (each part saved as its own print, linked by
 * prints.model_id) into the current format: ONE print with its parts in print_parts.
 * Runs once as part of migration 0003, and again after importing an older backup.
 * Each part keeps its id as the new part id, so filament lines can be re-linked without lookups.
 */
export const LEGACY_MODEL_CONVERSION: string[] = [
  `CREATE TEMP TABLE _legacy_parts AS
     SELECT id, model_id, part_name, print_minutes,
       row_number() OVER w AS rn,
       first_value(id) OVER w AS parent_id
     FROM prints
     WHERE model_id IS NOT NULL AND deleted_at IS NULL
     WINDOW w AS (PARTITION BY model_id ORDER BY printed_at, created_at)`,
  `INSERT INTO print_parts (id, print_id, name, print_minutes, sort_order)
     SELECT id, parent_id, coalesce(nullif(part_name, ''), 'Part ' || rn), print_minutes, rn FROM _legacy_parts`,
  `UPDATE print_spools ps SET part_id = l.id, print_id = l.parent_id FROM _legacy_parts l WHERE ps.print_id = l.id`,
  `UPDATE photos ph SET print_id = l.parent_id FROM _legacy_parts l WHERE ph.print_id = l.id AND l.rn > 1`,
  `UPDATE prints p SET
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
     WHERE p.id = s.parent_id`,
  `DELETE FROM prints p USING _legacy_parts l WHERE p.id = l.id AND l.rn > 1`,
  `UPDATE models SET deleted_at = now() WHERE deleted_at IS NULL`,
  `DROP TABLE _legacy_parts`,
];
