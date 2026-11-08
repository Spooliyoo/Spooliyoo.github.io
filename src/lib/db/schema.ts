import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  doublePrecision,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
  check,
  index,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "string" });
const audit = {
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
};

export const MATERIALS = ["PLA", "PETG", "ABS", "ASA", "TPU", "Nylon", "Other"] as const;
export type Material = (typeof MATERIALS)[number];

export const spools = pgTable(
  "spools",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spoolCode: text("spool_code").notNull(),
    name: text("name").notNull(),
    brand: text("brand").notNull().default(""),
    material: text("material").notNull().default("PLA"),
    colourName: text("colour_name").notNull().default(""),
    colourHex: text("colour_hex").notNull().default("#888888"),
    diameterMm: doublePrecision("diameter_mm").notNull().default(1.75),
    price: doublePrecision("price").notNull().default(0),
    netWeightG: doublePrecision("net_weight_g").notNull().default(1000),
    tareWeightG: doublePrecision("tare_weight_g").notNull().default(0),
    purchaseDate: date("purchase_date", { mode: "string" }),
    status: text("status").notNull().default("active"),
    notes: text("notes").notNull().default(""),
    ...audit,
    deletedAt: ts("deleted_at"),
  },
  (t) => [
    check("spools_weights_nonneg", sql`${t.price} >= 0 AND ${t.netWeightG} >= 0 AND ${t.tareWeightG} >= 0`),
  ],
);

export const prints = pgTable(
  "prints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    modelName: text("model_name").notNull(),
    printedAt: ts("printed_at").notNull(),
    printMinutes: integer("print_minutes").notNull(),
    status: text("status").notNull().default("success"),
    labourMinutes: integer("labour_minutes").notNull().default(0),
    // Rate snapshot — so later changes to Settings never change past prices.
    electricityRate: doublePrecision("electricity_rate").notNull(),
    printerWatts: doublePrecision("printer_watts").notNull(),
    wearRate: doublePrecision("wear_rate").notNull(),
    labourRate: doublePrecision("labour_rate").notNull(),
    bufferPct: doublePrecision("buffer_pct").notNull(),
    markupPct: doublePrecision("markup_pct").notNull(),
    filamentCost: doublePrecision("filament_cost").notNull(),
    electricityCost: doublePrecision("electricity_cost").notNull(),
    wearCost: doublePrecision("wear_cost").notNull(),
    labourCost: doublePrecision("labour_cost").notNull(),
    bufferCost: doublePrecision("buffer_cost").notNull(),
    totalCost: doublePrecision("total_cost").notNull(),
    sellingPrice: doublePrecision("selling_price").notNull(),
    priceOverridden: boolean("price_overridden").notNull().default(false),
    profit: doublePrecision("profit").notNull(),
    notes: text("notes").notNull().default(""),
    ...audit,
    deletedAt: ts("deleted_at"),
  },
  (t) => [
    check("prints_minutes_pos", sql`${t.printMinutes} > 0`),
    index("prints_printed_at_idx").on(t.printedAt),
  ],
);

export const printSpools = pgTable(
  "print_spools",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    printId: uuid("print_id")
      .notNull()
      .references(() => prints.id),
    spoolId: uuid("spool_id")
      .notNull()
      .references(() => spools.id),
    modelG: doublePrecision("model_g").notNull(),
    purgeG: doublePrecision("purge_g").notNull(),
    extraG: doublePrecision("extra_g").notNull(),
    totalG: doublePrecision("total_g").notNull(),
    costPerGSnapshot: doublePrecision("cost_per_g_snapshot").notNull(),
    ...audit,
    deletedAt: ts("deleted_at"),
  },
  (t) => [
    check("print_spools_nonneg", sql`${t.modelG} >= 0 AND ${t.purgeG} >= 0 AND ${t.extraG} >= 0`),
    index("print_spools_spool_idx").on(t.spoolId),
    index("print_spools_print_idx").on(t.printId),
  ],
);

export const spoolAdjustments = pgTable(
  "spool_adjustments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spoolId: uuid("spool_id")
      .notNull()
      .references(() => spools.id),
    measuredGrossG: doublePrecision("measured_gross_g").notNull(),
    remainingBeforeG: doublePrecision("remaining_before_g").notNull(),
    remainingAfterG: doublePrecision("remaining_after_g").notNull(),
    deltaG: doublePrecision("delta_g").notNull(),
    adjustedAt: ts("adjusted_at").notNull().defaultNow(),
    note: text("note").notNull().default(""),
    ...audit,
  },
  (t) => [index("spool_adjustments_spool_idx").on(t.spoolId)],
);

/** Photo metadata. The compressed image itself lives in a separate IndexedDB store keyed by id
 * (see photo-store.ts) so the Postgres data directory stays small and fast to load. */
export const photos = pgTable(
  "photos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    printId: uuid("print_id")
      .notNull()
      .references(() => prints.id),
    mimeType: text("mime_type").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    ...audit,
    deletedAt: ts("deleted_at"),
  },
  (t) => [index("photos_print_idx").on(t.printId)],
);

export const settings = pgTable("settings", {
  id: integer("id").primaryKey().default(1),
  currency: text("currency").notNull().default("INR"),
  defaultPurgeG: doublePrecision("default_purge_g").notNull().default(5),
  electricityRate: doublePrecision("electricity_rate").notNull().default(8),
  printerWatts: doublePrecision("printer_watts").notNull().default(150),
  wearRate: doublePrecision("wear_rate").notNull().default(5),
  labourRate: doublePrecision("labour_rate").notNull().default(200),
  bufferPct: doublePrecision("buffer_pct").notNull().default(10),
  markupPct: doublePrecision("markup_pct").notNull().default(50),
  lowStockG: doublePrecision("low_stock_g").notNull().default(100),
  theme: text("theme").notNull().default("light"),
  lastBackupAt: ts("last_backup_at"),
  ...audit,
});

export type Spool = typeof spools.$inferSelect;
export type NewSpool = typeof spools.$inferInsert;
export type Print = typeof prints.$inferSelect;
export type PrintSpool = typeof printSpools.$inferSelect;
export type SpoolAdjustment = typeof spoolAdjustments.$inferSelect;
export type Photo = typeof photos.$inferSelect;
export type Settings = typeof settings.$inferSelect;
