import { and, eq, isNull, sql } from "drizzle-orm";
import type { DB } from "./client";
import {
  photos,
  printParts,
  printSpools,
  prints,
  settings,
  spoolAdjustments,
  spools,
  type Settings,
  type Spool,
} from "./schema";
import type { PhotoStore } from "./photo-store";
import {
  calculatePrice,
  costPerGram,
  lineTotalG,
  parseTimestamp,
  percentLeft,
  round2,
  weightCorrection,
} from "../calc";
import {
  printInputSchema,
  settingsInputSchema,
  spoolInputSchema,
  type PrintInput,
  type SettingsInput,
  type SpoolInput,
} from "../validation";

export class UserError extends Error {}

const now = () => new Date().toISOString();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: string | null | undefined): v is string => !!v && UUID_RE.test(v);

// ---------- Settings ----------

export async function getSettings(db: DB): Promise<Settings> {
  const row = (await db.select().from(settings).where(eq(settings.id, 1)))[0];
  if (row) return row;
  await db.insert(settings).values({ id: 1 }).onConflictDoNothing();
  return (await db.select().from(settings).where(eq(settings.id, 1)))[0]!;
}

export async function updateSettings(db: DB, input: SettingsInput): Promise<void> {
  const v = settingsInputSchema.parse(input);
  await db
    .update(settings)
    .set({ ...v, updatedAt: now() })
    .where(eq(settings.id, 1));
}

export async function markBackedUp(db: DB): Promise<void> {
  await db.update(settings).set({ lastBackupAt: now() }).where(eq(settings.id, 1));
}

/** How many spools, prints and weight corrections were added, edited or deleted since the last backup. */
export async function changesSinceBackup(db: DB): Promise<{ changes: number; lastBackupAt: string | null }> {
  const res = await db.execute(sql`
    WITH b AS (SELECT coalesce(last_backup_at, '-infinity'::timestamptz) AS t, last_backup_at FROM settings WHERE id = 1)
    SELECT b.last_backup_at,
      (SELECT count(*) FROM spools, b WHERE spools.updated_at > b.t)
      + (SELECT count(*) FROM prints, b WHERE prints.updated_at > b.t)
      + (SELECT count(*) FROM spool_adjustments, b WHERE spool_adjustments.updated_at > b.t) AS changes
    FROM b`);
  const row = res.rows[0] as { changes: unknown; last_backup_at: string | null } | undefined;
  return { changes: Number(row?.changes ?? 0), lastBackupAt: tsToIso(row?.last_backup_at ?? null) };
}

// ---------- Spools ----------

export interface SpoolWithStats extends Spool {
  usedG: number;
  adjustmentsG: number;
  remainingG: number;
  pctLeft: number;
  costPerG: number;
  lastUsedAt: string | null;
  printCount: number;
}

const usageAgg = sql`
  SELECT ps.spool_id, sum(ps.total_g) AS used_g, max(p.printed_at) AS last_used, count(*) AS n
  FROM print_spools ps JOIN prints p ON p.id = ps.print_id
  WHERE ps.deleted_at IS NULL AND p.deleted_at IS NULL
  GROUP BY ps.spool_id`;

const adjAgg = sql`SELECT spool_id, sum(delta_g) AS adj_g FROM spool_adjustments GROUP BY spool_id`;

function withStats(s: Spool, used: number, adj: number, lastUsed: string | null, n: number): SpoolWithStats {
  const remainingG = round2(s.netWeightG - used + adj);
  return {
    ...s,
    usedG: round2(used),
    adjustmentsG: round2(adj),
    remainingG,
    pctLeft: percentLeft(remainingG, s.netWeightG),
    costPerG: costPerGram(s.price, s.netWeightG),
    lastUsedAt: lastUsed,
    printCount: n,
  };
}

type SpoolRow = Record<string, unknown>;
function mapSpoolRow(r: SpoolRow): Spool {
  return {
    id: r.id as string,
    spoolCode: r.spool_code as string,
    name: r.name as string,
    brand: r.brand as string,
    material: r.material as string,
    colourName: r.colour_name as string,
    colourHex: r.colour_hex as string,
    diameterMm: Number(r.diameter_mm),
    price: Number(r.price),
    netWeightG: Number(r.net_weight_g),
    tareWeightG: Number(r.tare_weight_g),
    purchaseDate: (r.purchase_date as string | null) ?? null,
    status: r.status as string,
    notes: r.notes as string,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    deletedAt: (r.deleted_at as string | null) ?? null,
  };
}

const tsToIso = (v: unknown): string | null => parseTimestamp(v as string | null)?.toISOString() ?? null;

export async function listSpools(
  db: DB,
  opts: { includeArchived?: boolean } = {},
): Promise<SpoolWithStats[]> {
  const res = await db.execute(sql`
    SELECT s.*, coalesce(u.used_g, 0) AS used_g, coalesce(a.adj_g, 0) AS adj_g, u.last_used, coalesce(u.n, 0) AS n
    FROM spools s
    LEFT JOIN (${usageAgg}) u ON u.spool_id = s.id
    LEFT JOIN (${adjAgg}) a ON a.spool_id = s.id
    WHERE s.deleted_at IS NULL ${opts.includeArchived ? sql`` : sql`AND s.status = 'active'`}
    ORDER BY s.created_at`);
  return (res.rows as SpoolRow[]).map((r) =>
    withStats(mapSpoolRow(r), Number(r.used_g), Number(r.adj_g), tsToIso(r.last_used), Number(r.n)),
  );
}

export async function getSpool(db: DB, id: string): Promise<SpoolWithStats | null> {
  if (!isUuid(id)) return null;
  const all = await db.execute(sql`
    SELECT s.*, coalesce(u.used_g, 0) AS used_g, coalesce(a.adj_g, 0) AS adj_g, u.last_used, coalesce(u.n, 0) AS n
    FROM spools s
    LEFT JOIN (${usageAgg}) u ON u.spool_id = s.id
    LEFT JOIN (${adjAgg}) a ON a.spool_id = s.id
    WHERE s.id = ${id} AND s.deleted_at IS NULL`);
  const r = all.rows[0] as SpoolRow | undefined;
  return r
    ? withStats(mapSpoolRow(r), Number(r.used_g), Number(r.adj_g), tsToIso(r.last_used), Number(r.n))
    : null;
}

async function assertCodeFree(db: DB, code: string, exceptId?: string) {
  const res = await db.execute(sql`
    SELECT id FROM spools WHERE deleted_at IS NULL AND lower(btrim(spool_code)) = lower(btrim(${code}))
    ${exceptId ? sql`AND id <> ${exceptId}` : sql``} LIMIT 1`);
  if (res.rows.length) throw new UserError(`Spool ID "${code.trim()}" is already used by another spool`);
}

export async function createSpool(db: DB, input: SpoolInput): Promise<string> {
  const v = spoolInputSchema.parse(input);
  await assertCodeFree(db, v.spoolCode);
  const [row] = await db.insert(spools).values(v).returning({ id: spools.id });
  return row!.id;
}

export async function updateSpool(db: DB, id: string, input: SpoolInput): Promise<void> {
  const v = spoolInputSchema.parse(input);
  await assertCodeFree(db, v.spoolCode, id);
  await db
    .update(spools)
    .set({ ...v, updatedAt: now() })
    .where(eq(spools.id, id));
}

export async function setSpoolStatus(db: DB, id: string, status: "active" | "archived"): Promise<void> {
  await db.update(spools).set({ status, updatedAt: now() }).where(eq(spools.id, id));
}

/** FR-SP-6: a spool used by any print can only be archived, never deleted. */
export async function deleteSpool(db: DB, id: string): Promise<void> {
  const s = await getSpool(db, id);
  if (!s) return;
  if (s.printCount > 0) throw new UserError("This spool has prints logged, so it can only be archived.");
  await db.update(spools).set({ deletedAt: now(), updatedAt: now() }).where(eq(spools.id, id));
}

export async function correctSpoolWeight(db: DB, spoolId: string, measuredGrossG: number, note = "") {
  if (!Number.isFinite(measuredGrossG) || measuredGrossG < 0)
    throw new UserError("Enter the weight shown on the scale");
  return db.transaction(async (tx) => {
    const s = await getSpool(tx as unknown as DB, spoolId);
    if (!s) throw new UserError("Spool not found");
    const { remainingAfterG, deltaG } = weightCorrection(measuredGrossG, s.tareWeightG, s.remainingG);
    await tx.insert(spoolAdjustments).values({
      spoolId,
      measuredGrossG,
      remainingBeforeG: s.remainingG,
      remainingAfterG: round2(remainingAfterG),
      deltaG: round2(deltaG),
      note,
    });
    return { remainingAfterG: round2(remainingAfterG), deltaG: round2(deltaG) };
  });
}

export type SpoolHistoryItem =
  | {
      kind: "print";
      at: string;
      printId: string;
      modelName: string;
      status: string;
      modelG: number;
      purgeG: number;
      extraG: number;
      totalG: number;
    }
  | { kind: "adjustment"; at: string; id: string; deltaG: number; measuredGrossG: number; note: string };

export async function spoolHistory(db: DB, spoolId: string): Promise<SpoolHistoryItem[]> {
  if (!isUuid(spoolId)) return [];
  const usage = await db
    .select({
      at: prints.printedAt,
      printId: prints.id,
      modelName: prints.modelName,
      status: prints.status,
      modelG: printSpools.modelG,
      purgeG: printSpools.purgeG,
      extraG: printSpools.extraG,
      totalG: printSpools.totalG,
    })
    .from(printSpools)
    .innerJoin(prints, eq(prints.id, printSpools.printId))
    .where(and(eq(printSpools.spoolId, spoolId), isNull(printSpools.deletedAt), isNull(prints.deletedAt)));
  const adj = await db.select().from(spoolAdjustments).where(eq(spoolAdjustments.spoolId, spoolId));
  const items: SpoolHistoryItem[] = [
    ...usage.map((u) => ({ kind: "print" as const, ...u })),
    ...adj.map((a) => ({
      kind: "adjustment" as const,
      at: a.adjustedAt,
      id: a.id,
      deltaG: a.deltaG,
      measuredGrossG: a.measuredGrossG,
      note: a.note,
    })),
  ];
  return items
    .map((i) => ({ ...i, at: tsToIso(i.at)! }))
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

// ---------- Prints ----------

export interface NewPhoto {
  blob: Blob;
  mimeType: string;
  width: number;
  height: number;
}

export interface SavePrintOptions {
  newPhotos?: NewPhoto[];
  removePhotoIds?: string[];
  photoStore?: PhotoStore;
}

/** Validates, prices and saves a print in ONE transaction (NFR-4). Returns the print id. */
export async function savePrint(
  db: DB,
  input: PrintInput,
  existingId?: string | null,
  opts: SavePrintOptions = {},
): Promise<string> {
  const v = printInputSchema.parse(input);
  const spoolRows = await db
    .select()
    .from(spools)
    .where(
      sql`${spools.id} IN (${sql.join(
        v.lines.map((l) => sql`${l.spoolId}`),
        sql`, `,
      )})`,
    );
  const byId = new Map(spoolRows.map((s) => [s.id, s]));

  // When editing, keep each line's original cost-per-gram snapshot if the spool is unchanged.
  const oldSnapshots = new Map<string, number>();
  if (existingId) {
    const old = await db
      .select()
      .from(printSpools)
      .where(and(eq(printSpools.printId, existingId), isNull(printSpools.deletedAt)));
    for (const o of old) oldSnapshots.set(o.spoolId, o.costPerGSnapshot);
  }

  const lines = v.lines.map((l) => {
    const s = byId.get(l.spoolId);
    if (!s || s.deletedAt) throw new UserError("One of the selected spools no longer exists");
    const costPerG = oldSnapshots.get(l.spoolId) ?? costPerGram(s.price, s.netWeightG);
    return { ...l, costPerG, totalG: lineTotalG(l) };
  });
  const failed = v.status === "failed";
  // Multi-part prints: total time is the sum of the parts' times.
  const totalMinutes = v.parts.length ? v.parts.reduce((s, p) => s + p.printMinutes, 0) : v.printMinutes;
  const price = calculatePrice({
    lines,
    printMinutes: totalMinutes,
    labourMinutes: v.labourMinutes,
    rates: v.rates,
    failed,
    priceOverride: v.priceOverride,
  });

  const printValues: typeof prints.$inferInsert = {
    modelName: v.modelName,
    printedAt: new Date(v.printedAt).toISOString(),
    printMinutes: totalMinutes,
    status: v.status,
    labourMinutes: v.labourMinutes,
    ...v.rates,
    filamentCost: price.filamentCost,
    electricityCost: price.electricityCost,
    wearCost: price.wearCost,
    labourCost: price.labourCost,
    bufferCost: price.bufferCost,
    totalCost: price.totalCost,
    sellingPrice: price.sellingPrice,
    priceOverridden: price.priceOverridden,
    profit: price.profit,
    notes: v.notes,
  };

  const photoStore = opts.photoStore;
  const newPhotoIds: string[] = [];
  // Blobs are written before the DB transaction; if anything fails (e.g. storage full) they're removed again,
  // so a failed save never leaves orphaned photos behind.
  const preparedPhotos = (opts.newPhotos ?? []).map((p) => ({ ...p, id: crypto.randomUUID() }));

  try {
    if (photoStore) for (const p of preparedPhotos) await photoStore.put(p.id, p.blob);
    const id = await db.transaction(async (tx) => {
      let printId = existingId ?? null;
      if (printId) {
        const res = await tx
          .update(prints)
          .set({ ...printValues, updatedAt: now() })
          .where(and(eq(prints.id, printId), isNull(prints.deletedAt)))
          .returning({ id: prints.id });
        if (!res.length) throw new UserError("Print not found");
        await tx
          .update(printSpools)
          .set({ deletedAt: now(), updatedAt: now() })
          .where(and(eq(printSpools.printId, printId), isNull(printSpools.deletedAt)));
        await tx
          .update(printParts)
          .set({ deletedAt: now(), updatedAt: now() })
          .where(and(eq(printParts.printId, printId), isNull(printParts.deletedAt)));
      } else {
        const [row] = await tx.insert(prints).values(printValues).returning({ id: prints.id });
        printId = row!.id;
      }
      const partIds = v.parts.length
        ? (
            await tx
              .insert(printParts)
              .values(
                v.parts.map((p, i) => ({
                  printId: printId!,
                  name: p.name,
                  printMinutes: p.printMinutes,
                  sortOrder: i,
                })),
              )
              .returning({ id: printParts.id, sortOrder: printParts.sortOrder })
          )
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((p) => p.id)
        : [];
      await tx.insert(printSpools).values(
        lines.map((l) => ({
          printId: printId!,
          spoolId: l.spoolId,
          partId: l.partIndex != null ? partIds[l.partIndex] : null,
          modelG: l.modelG,
          purgeG: l.purgeG,
          extraG: l.extraG,
          totalG: round2(l.totalG),
          costPerGSnapshot: l.costPerG,
        })),
      );
      if (preparedPhotos.length) {
        await tx.insert(photos).values(
          preparedPhotos.map((p) => ({
            id: p.id,
            printId: printId!,
            mimeType: p.mimeType,
            width: p.width,
            height: p.height,
            sizeBytes: p.blob.size,
          })),
        );
        newPhotoIds.push(...preparedPhotos.map((p) => p.id));
      }
      for (const pid of opts.removePhotoIds ?? []) {
        await tx
          .update(photos)
          .set({ deletedAt: now(), updatedAt: now() })
          .where(and(eq(photos.id, pid), eq(photos.printId, printId!)));
      }
      return printId!;
    });
    if (photoStore) for (const pid of opts.removePhotoIds ?? []) await photoStore.delete(pid);
    return id;
  } catch (e) {
    if (photoStore) for (const p of preparedPhotos) await photoStore.delete(p.id).catch(() => {}); // best effort
    throw e;
  }
}

/**
 * Moves a print to Recently deleted: soft-deletes it with its parts, usage lines and photos (all with the
 * same timestamp, so a restore brings back exactly these rows). Spools get the grams back immediately.
 * Photo files are kept until the print is deleted forever.
 */
export async function deletePrint(db: DB, id: string): Promise<void> {
  const ts = now();
  await db.transaction(async (tx) => {
    await tx.update(prints).set({ deletedAt: ts, updatedAt: ts }).where(eq(prints.id, id));
    await tx
      .update(printSpools)
      .set({ deletedAt: ts, updatedAt: ts })
      .where(and(eq(printSpools.printId, id), isNull(printSpools.deletedAt)));
    await tx
      .update(printParts)
      .set({ deletedAt: ts, updatedAt: ts })
      .where(and(eq(printParts.printId, id), isNull(printParts.deletedAt)));
    await tx
      .update(photos)
      .set({ deletedAt: ts, updatedAt: ts })
      .where(and(eq(photos.printId, id), isNull(photos.deletedAt)));
  });
}

export async function getPrint(db: DB, id: string) {
  if (!isUuid(id)) return null;
  const p = (
    await db
      .select()
      .from(prints)
      .where(and(eq(prints.id, id), isNull(prints.deletedAt)))
  )[0];
  if (!p) return null;
  const lines = await db
    .select({
      id: printSpools.id,
      spoolId: printSpools.spoolId,
      partId: printSpools.partId,
      modelG: printSpools.modelG,
      purgeG: printSpools.purgeG,
      extraG: printSpools.extraG,
      totalG: printSpools.totalG,
      costPerGSnapshot: printSpools.costPerGSnapshot,
      spoolCode: spools.spoolCode,
      spoolName: spools.name,
      material: spools.material,
      colourHex: spools.colourHex,
    })
    .from(printSpools)
    .innerJoin(spools, eq(spools.id, printSpools.spoolId))
    .where(and(eq(printSpools.printId, id), isNull(printSpools.deletedAt)))
    .orderBy(printSpools.createdAt);
  const pics = await db
    .select()
    .from(photos)
    .where(and(eq(photos.printId, id), isNull(photos.deletedAt)))
    .orderBy(photos.createdAt);
  const parts = await db
    .select()
    .from(printParts)
    .where(and(eq(printParts.printId, id), isNull(printParts.deletedAt)))
    .orderBy(printParts.sortOrder);
  return { ...p, lines, parts, photos: pics };
}
export type PrintDetail = NonNullable<Awaited<ReturnType<typeof getPrint>>>;

export interface PrintFilters {
  search?: string;
  spoolId?: string;
  material?: string;
  status?: "success" | "failed" | "";
  /** ISO instant, inclusive (convert local dates in the UI so time zones are respected). */
  from?: string;
  /** ISO instant, exclusive. */
  to?: string;
  limit?: number;
}

export interface PrintListItem {
  id: string;
  modelName: string;
  /** Names of the parts, in order (empty for single-part prints). */
  partNames: string[];
  printedAt: string;
  status: string;
  printMinutes: number;
  totalG: number;
  totalCost: number;
  sellingPrice: number;
  profit: number;
  thumbId: string | null;
  spoolLabels: string;
  colours: string[];
}

export async function listPrints(db: DB, f: PrintFilters = {}): Promise<PrintListItem[]> {
  const conds = [sql`p.deleted_at IS NULL`];
  if (f.search?.trim()) conds.push(sql`p.model_name ILIKE ${"%" + f.search.trim() + "%"}`);
  if (f.status) conds.push(sql`p.status = ${f.status}`);
  if (f.from) conds.push(sql`p.printed_at >= ${f.from}`);
  if (f.to) conds.push(sql`p.printed_at < ${f.to}`);
  if (f.spoolId || f.material) {
    const sub = [sql`ps2.deleted_at IS NULL`, sql`ps2.print_id = p.id`];
    if (f.spoolId) sub.push(sql`ps2.spool_id = ${f.spoolId}`);
    if (f.material) sub.push(sql`s2.material = ${f.material}`);
    conds.push(
      sql`EXISTS (SELECT 1 FROM print_spools ps2 JOIN spools s2 ON s2.id = ps2.spool_id WHERE ${sql.join(sub, sql` AND `)})`,
    );
  }
  const res = await db.execute(sql`
    SELECT p.id, p.model_name, p.printed_at, p.status, p.print_minutes, p.total_cost, p.selling_price, p.profit,
      (SELECT coalesce(sum(ps.total_g), 0) FROM print_spools ps WHERE ps.print_id = p.id AND ps.deleted_at IS NULL) AS total_g,
      (SELECT ph.id FROM photos ph WHERE ph.print_id = p.id AND ph.deleted_at IS NULL ORDER BY ph.created_at LIMIT 1) AS thumb_id,
      (SELECT string_agg(s.spool_code, ', ' ORDER BY ps.created_at) FROM print_spools ps JOIN spools s ON s.id = ps.spool_id
        WHERE ps.print_id = p.id AND ps.deleted_at IS NULL) AS spool_labels,
      (SELECT array_agg(s.colour_hex ORDER BY ps.created_at) FROM print_spools ps JOIN spools s ON s.id = ps.spool_id
        WHERE ps.print_id = p.id AND ps.deleted_at IS NULL) AS colours,
      (SELECT array_agg(pp.name ORDER BY pp.sort_order) FROM print_parts pp
        WHERE pp.print_id = p.id AND pp.deleted_at IS NULL) AS part_names
    FROM prints p
    WHERE ${sql.join(conds, sql` AND `)}
    ORDER BY p.printed_at DESC, p.created_at DESC
    LIMIT ${f.limit ?? 1000}`);
  return (res.rows as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    modelName: r.model_name as string,
    partNames: (r.part_names as string[] | null) ?? [],
    printedAt: tsToIso(r.printed_at)!,
    status: r.status as string,
    printMinutes: Number(r.print_minutes),
    totalG: Number(r.total_g),
    totalCost: Number(r.total_cost),
    sellingPrice: Number(r.selling_price),
    profit: Number(r.profit),
    thumbId: (r.thumb_id as string | null) ?? null,
    spoolLabels: (r.spool_labels as string | null) ?? "",
    colours: (r.colours as string[] | null) ?? [],
  }));
}

// ---------- Dashboard ----------

export async function getDashboard(db: DB, at = new Date()) {
  const s = await getSettings(db);
  const active = await listSpools(db);
  const totalG = active.reduce((sum, x) => sum + Math.max(0, x.remainingG), 0);
  const value = active.reduce((sum, x) => sum + Math.max(0, x.remainingG) * x.costPerG, 0);
  const lowStock = active
    .filter((x) => x.remainingG < s.lowStockG)
    .sort((a, b) => a.remainingG - b.remainingG);
  const recent = await listPrints(db, { limit: 5 });
  const monthStart = new Date(at.getFullYear(), at.getMonth(), 1).toISOString();
  const monthEnd = new Date(at.getFullYear(), at.getMonth() + 1, 1).toISOString();
  const m = await db.execute(sql`
    SELECT
      coalesce((SELECT sum(ps.total_g) FROM print_spools ps JOIN prints p ON p.id = ps.print_id
        WHERE ps.deleted_at IS NULL AND p.deleted_at IS NULL AND p.printed_at >= ${monthStart} AND p.printed_at < ${monthEnd}), 0) AS grams,
      coalesce(sum(total_cost), 0) AS cost, coalesce(sum(selling_price), 0) AS revenue,
      coalesce(sum(profit), 0) AS profit, count(*) AS n
    FROM prints WHERE deleted_at IS NULL AND printed_at >= ${monthStart} AND printed_at < ${monthEnd}`);
  const row = m.rows[0] as Record<string, unknown>;
  return {
    settings: s,
    activeCount: active.length,
    totalStockG: round2(totalG),
    stockValue: round2(value),
    lowStock,
    recent,
    month: {
      grams: round2(Number(row.grams)),
      cost: round2(Number(row.cost)),
      revenue: round2(Number(row.revenue)),
      profit: round2(Number(row.profit)),
      prints: Number(row.n),
    },
  };
}
export type Dashboard = Awaited<ReturnType<typeof getDashboard>>;

// ---------- Recently deleted ----------

/** Deleted prints stay restorable for this many days, then are removed for good. */
export const RECENTLY_DELETED_DAYS = 30;

export interface DeletedPrint {
  id: string;
  modelName: string;
  printedAt: string;
  deletedAt: string;
  totalG: number;
  partCount: number;
}

export async function listDeletedPrints(db: DB): Promise<DeletedPrint[]> {
  const res = await db.execute(sql`
    SELECT p.id, p.model_name, p.printed_at, p.deleted_at,
      (SELECT coalesce(sum(ps.total_g), 0) FROM print_spools ps WHERE ps.print_id = p.id AND ps.deleted_at = p.deleted_at) AS total_g,
      (SELECT count(*) FROM print_parts pp WHERE pp.print_id = p.id AND pp.deleted_at = p.deleted_at) AS parts
    FROM prints p
    WHERE p.deleted_at IS NOT NULL
    ORDER BY p.deleted_at DESC`);
  return (res.rows as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    modelName: r.model_name as string,
    printedAt: tsToIso(r.printed_at)!,
    deletedAt: tsToIso(r.deleted_at)!,
    totalG: Number(r.total_g),
    partCount: Number(r.parts),
  }));
}

/** Brings a deleted print back with exactly the parts, lines and photos that were deleted with it. */
export async function restorePrint(db: DB, id: string): Promise<void> {
  if (!isUuid(id)) return;
  await db.transaction(async (tx) => {
    const p = (await tx.select().from(prints).where(eq(prints.id, id)))[0];
    if (!p?.deletedAt) throw new UserError("This print isn't in Recently deleted");
    const ts = p.deletedAt;
    const at = now();
    await tx.update(prints).set({ deletedAt: null, updatedAt: at }).where(eq(prints.id, id));
    await tx
      .update(printSpools)
      .set({ deletedAt: null, updatedAt: at })
      .where(and(eq(printSpools.printId, id), eq(printSpools.deletedAt, ts)));
    await tx
      .update(printParts)
      .set({ deletedAt: null, updatedAt: at })
      .where(and(eq(printParts.printId, id), eq(printParts.deletedAt, ts)));
    await tx
      .update(photos)
      .set({ deletedAt: null, updatedAt: at })
      .where(and(eq(photos.printId, id), eq(photos.deletedAt, ts)));
  });
}

/** Removes a deleted print and everything attached to it permanently, including photo files. */
export async function purgePrint(db: DB, id: string, photoStore?: PhotoStore): Promise<void> {
  if (!isUuid(id)) return;
  const photoIds = await db.transaction(async (tx) => {
    const p = (await tx.select().from(prints).where(eq(prints.id, id)))[0];
    if (!p?.deletedAt) throw new UserError("Only deleted prints can be removed permanently");
    const ph = await tx.delete(photos).where(eq(photos.printId, id)).returning({ id: photos.id });
    await tx.delete(printSpools).where(eq(printSpools.printId, id));
    await tx.delete(printParts).where(eq(printParts.printId, id));
    await tx.delete(prints).where(eq(prints.id, id));
    return ph.map((x) => x.id);
  });
  if (photoStore) for (const pid of photoIds) await photoStore.delete(pid).catch(() => {});
}

/** Permanently removes prints deleted more than RECENTLY_DELETED_DAYS ago. Returns how many. */
export async function purgeExpiredDeleted(db: DB, photoStore?: PhotoStore, at = new Date()): Promise<number> {
  const cutoff = new Date(at.getTime() - RECENTLY_DELETED_DAYS * 86_400_000).toISOString();
  const res = await db.execute(
    sql`SELECT id FROM prints WHERE deleted_at IS NOT NULL AND deleted_at < ${cutoff}`,
  );
  const ids = (res.rows as { id: string }[]).map((r) => r.id);
  for (const id of ids) await purgePrint(db, id, photoStore);
  return ids.length;
}
