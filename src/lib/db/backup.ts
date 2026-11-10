import { z } from "zod";
import { sql } from "drizzle-orm";
import type { DB } from "./client";
import { models, photos, printSpools, prints, settings, spoolAdjustments, spools } from "./schema";
import type { PhotoStore } from "./photo-store";
import { listPrints } from "./repo";
import { formatDuration } from "../calc";

export const BACKUP_FORMAT = "filament-tracker-backup";
/** Bump when the backup shape changes, and add a step to MIGRATE_BACKUP below. */
export const BACKUP_SCHEMA_VERSION = 2;

// ---------- base64 helpers (work in browsers and Node) ----------

export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

export function base64ToBlob(b64: string, type: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

// ---------- Export ----------

export async function exportBackup(db: DB, store: PhotoStore) {
  const [md, sp, pr, ps, adj, ph, st] = await Promise.all([
    db.select().from(models),
    db.select().from(spools),
    db.select().from(prints),
    db.select().from(printSpools),
    db.select().from(spoolAdjustments),
    db.select().from(photos),
    db.select().from(settings),
  ]);
  const photoRows = [];
  for (const p of ph) {
    if (p.deletedAt) continue;
    const blob = await store.get(p.id);
    photoRows.push({ ...p, dataBase64: blob ? await blobToBase64(blob) : null });
  }
  return {
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      models: md,
      spools: sp,
      prints: pr,
      printSpools: ps,
      spoolAdjustments: adj,
      photos: photoRows,
      settings: st[0] ?? null,
    },
  };
}
export type Backup = Awaited<ReturnType<typeof exportBackup>>;

// ---------- Validation ----------

const tsz = z.string().nullable();
const num = z.number();
const spoolZ = z.object({
  id: z.string().uuid(),
  spoolCode: z.string(),
  name: z.string(),
  brand: z.string(),
  material: z.string(),
  colourName: z.string(),
  colourHex: z.string(),
  diameterMm: num,
  price: num,
  netWeightG: num,
  tareWeightG: num,
  purchaseDate: z.string().nullable(),
  status: z.string(),
  notes: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: tsz,
});
const printZ = z.object({
  id: z.string().uuid(),
  modelName: z.string(),
  modelId: z.string().uuid().nullable(),
  partName: z.string(),
  printedAt: z.string(),
  printMinutes: z.number().int(),
  status: z.string(),
  labourMinutes: z.number().int(),
  electricityRate: num,
  printerWatts: num,
  wearRate: num,
  labourRate: num,
  bufferPct: num,
  markupPct: num,
  filamentCost: num,
  electricityCost: num,
  wearCost: num,
  labourCost: num,
  bufferCost: num,
  totalCost: num,
  sellingPrice: num,
  priceOverridden: z.boolean(),
  profit: num,
  notes: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: tsz,
});
const printSpoolZ = z.object({
  id: z.string().uuid(),
  printId: z.string().uuid(),
  spoolId: z.string().uuid(),
  modelG: num,
  purgeG: num,
  extraG: num,
  totalG: num,
  costPerGSnapshot: num,
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: tsz,
});
const adjZ = z.object({
  id: z.string().uuid(),
  spoolId: z.string().uuid(),
  measuredGrossG: num,
  remainingBeforeG: num,
  remainingAfterG: num,
  deltaG: num,
  adjustedAt: z.string(),
  note: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const photoZ = z.object({
  id: z.string().uuid(),
  printId: z.string().uuid(),
  mimeType: z.string(),
  width: z.number().int(),
  height: z.number().int(),
  sizeBytes: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: tsz,
  dataBase64: z.string().nullable(),
});
const settingsZ = z.object({
  id: z.number().int(),
  currency: z.string(),
  defaultPurgeG: num,
  electricityRate: num,
  printerWatts: num,
  wearRate: num,
  labourRate: num,
  bufferPct: num,
  markupPct: num,
  lowStockG: num,
  theme: z.string(),
  lastBackupAt: tsz,
  createdAt: z.string(),
  updatedAt: z.string(),
});
const modelZ = z.object({
  id: z.string().uuid(),
  name: z.string(),
  notes: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: tsz,
});
const backupZ = z.object({
  format: z.literal(BACKUP_FORMAT),
  schemaVersion: z.literal(BACKUP_SCHEMA_VERSION),
  exportedAt: z.string(),
  data: z.object({
    models: z.array(modelZ),
    spools: z.array(spoolZ),
    prints: z.array(printZ),
    printSpools: z.array(printSpoolZ),
    spoolAdjustments: z.array(adjZ),
    photos: z.array(photoZ),
    settings: settingsZ.nullable(),
  }),
});
export type ValidBackup = z.infer<typeof backupZ>;

/** Upgrades older backup shapes step by step: MIGRATE_BACKUP[n] turns version n into n+1. */
const MIGRATE_BACKUP: Record<number, (b: Record<string, unknown>) => Record<string, unknown>> = {
  // v1 → v2: multi-part models added.
  1: (b) => {
    const data = (b.data ?? {}) as Record<string, unknown>;
    const printsV1 = Array.isArray(data.prints) ? (data.prints as Record<string, unknown>[]) : [];
    return {
      ...b,
      schemaVersion: 2,
      data: { ...data, models: [], prints: printsV1.map((p) => ({ modelId: null, partName: "", ...p })) },
    };
  },
};

export function migrateBackup(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  let b = raw as Record<string, unknown>;
  let v = Number(b.schemaVersion);
  if (v > BACKUP_SCHEMA_VERSION)
    throw new Error(`This backup was made by a newer version of the app (v${v}). Update the app first.`);
  while (v < BACKUP_SCHEMA_VERSION) {
    const step = MIGRATE_BACKUP[v];
    if (!step) throw new Error(`Can't upgrade backup from version ${v}`);
    b = step(b);
    v = Number(b.schemaVersion);
  }
  return b;
}

export interface BackupPreview {
  backup: ValidBackup;
  counts: { spools: number; prints: number; photos: number; adjustments: number };
  exportedAt: string;
}

export function parseBackup(text: string): BackupPreview {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("This file isn't valid JSON.");
  }
  if ((raw as { format?: unknown })?.format !== BACKUP_FORMAT)
    throw new Error("This file isn't a Spooliyoo backup.");
  const res = backupZ.safeParse(migrateBackup(raw));
  if (!res.success) {
    const issue = res.error.issues[0];
    throw new Error(`Backup file is damaged or incomplete (${issue?.path.join(".")}: ${issue?.message}).`);
  }
  const b = res.data;
  const ids = new Set(b.data.spools.map((s) => s.id));
  const printIds = new Set(b.data.prints.map((p) => p.id));
  for (const l of b.data.printSpools)
    if (!ids.has(l.spoolId) || !printIds.has(l.printId))
      throw new Error("Backup has usage lines with missing spools or prints.");
  return {
    backup: b,
    exportedAt: b.exportedAt,
    counts: {
      spools: b.data.spools.filter((s) => !s.deletedAt).length,
      prints: b.data.prints.filter((p) => !p.deletedAt).length,
      photos: b.data.photos.filter((p) => !p.deletedAt).length,
      adjustments: b.data.spoolAdjustments.length,
    },
  };
}

/** Replaces ALL current data with the backup, in one transaction. Photos are swapped only after it commits. */
export async function importBackup(db: DB, store: PhotoStore, b: ValidBackup): Promise<void> {
  const d = b.data;
  const chunks = <T>(arr: T[], n = 200) =>
    Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
  await db.transaction(async (tx) => {
    await tx.execute(sql`DELETE FROM photos`);
    await tx.execute(sql`DELETE FROM print_spools`);
    await tx.execute(sql`DELETE FROM spool_adjustments`);
    await tx.execute(sql`DELETE FROM prints`);
    await tx.execute(sql`DELETE FROM spools`);
    await tx.execute(sql`DELETE FROM models`);
    for (const c of chunks(d.models)) await tx.insert(models).values(c);
    for (const c of chunks(d.spools)) await tx.insert(spools).values(c);
    for (const c of chunks(d.prints)) await tx.insert(prints).values(c);
    for (const c of chunks(d.printSpools)) await tx.insert(printSpools).values(c);
    for (const c of chunks(d.spoolAdjustments)) await tx.insert(spoolAdjustments).values(c);
    const ph = d.photos.map(({ dataBase64: _ignored, ...rest }) => rest);
    for (const c of chunks(ph)) await tx.insert(photos).values(c);
    if (d.settings) {
      const { id: _id, ...st } = d.settings;
      await tx
        .update(settings)
        .set(st)
        .where(sql`id = 1`);
    }
  });
  await store.clear();
  for (const p of d.photos) if (p.dataBase64) await store.put(p.id, base64ToBlob(p.dataBase64, p.mimeType));
}

// ---------- CSV ----------

const csvCell = (v: unknown): string => {
  const s = v == null ? "" : String(v);
  // Escape quotes and neutralise spreadsheet formula injection.
  const safe = /^[=+\-@]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export async function exportPrintsCsv(db: DB): Promise<string> {
  const rows = await listPrints(db, { limit: 1_000_000 });
  const header = [
    "Date",
    "Model",
    "Part",
    "Status",
    "Spools",
    "Filament (g)",
    "Print time (h:mm)",
    "Cost",
    "Selling price",
    "Profit",
  ];
  const lines = rows.map((r) =>
    [
      r.printedAt.slice(0, 10),
      r.modelName,
      r.partName,
      r.status,
      r.spoolLabels,
      r.totalG,
      formatDuration(r.printMinutes),
      r.totalCost.toFixed(2),
      r.sellingPrice.toFixed(2),
      r.profit.toFixed(2),
    ]
      .map(csvCell)
      .join(","),
  );
  return [header.join(","), ...lines].join("\r\n") + "\r\n";
}
