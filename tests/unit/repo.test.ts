import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { createDb, runMigrations, type DB } from "@/lib/db/client";
import { MemoryPhotoStore } from "@/lib/db/photo-store";
import * as repo from "@/lib/db/repo";
import { exportBackup, exportPrintsCsv, importBackup, parseBackup } from "@/lib/db/backup";
import type { SpoolInput, PrintInput } from "@/lib/validation";

const spool = (over: Partial<SpoolInput> = {}): SpoolInput => ({
  spoolCode: "PLA-01",
  name: "Black PLA",
  brand: "eSun",
  material: "PLA",
  colourName: "Black",
  colourHex: "#111111",
  diameterMm: 1.75,
  price: 1200,
  netWeightG: 1000,
  tareWeightG: 200,
  purchaseDate: null,
  notes: "",
  ...over,
});

const rates = {
  electricityRate: 8,
  printerWatts: 150,
  wearRate: 5,
  labourRate: 200,
  bufferPct: 10,
  markupPct: 50,
};
const print = (spoolId: string, over: Partial<PrintInput> = {}): PrintInput => ({
  modelName: "Benchy",
  printedAt: new Date().toISOString(),
  printMinutes: 60,
  status: "success",
  labourMinutes: 0,
  notes: "",
  lines: [{ spoolId, modelG: 100, purgeG: 5, extraG: 0 }],
  rates,
  priceOverride: null,
  ...over,
});

let pg: PGlite;
let db: DB;
let store: MemoryPhotoStore;

// One PGlite instance for the file (startup is slow); tables are wiped between tests.
beforeEach(async () => {
  if (!pg) {
    pg = await PGlite.create();
    db = await createDb(pg);
  }
  await pg.exec("TRUNCATE photos, print_spools, spool_adjustments, prints, spools, models");
  store = new MemoryPhotoStore();
});

describe("migrations", () => {
  it("are idempotent and seed settings", async () => {
    await runMigrations(pg);
    const s = await repo.getSettings(db);
    expect(s.currency).toBe("INR");
    expect(s.lowStockG).toBe(100);
  });
});

describe("spools", () => {
  it("enforces unique spool ID, case-insensitive and trimmed (FR-SP-1)", async () => {
    await repo.createSpool(db, spool());
    await expect(repo.createSpool(db, spool({ spoolCode: "  pla-01 " }))).rejects.toThrow(/already used/);
  });

  it("derives remaining grams from usage and adjustments", async () => {
    const id = await repo.createSpool(db, spool());
    await repo.savePrint(db, print(id));
    let s = (await repo.getSpool(db, id))!;
    expect(s.remainingG).toBe(895);
    expect(s.pctLeft).toBeCloseTo(89.5);

    const adj = await repo.correctSpoolWeight(db, id, 1050); // gross 1050 − tare 200 = 850
    expect(adj).toEqual({ remainingAfterG: 850, deltaG: -45 });
    s = (await repo.getSpool(db, id))!;
    expect(s.remainingG).toBe(850);
    const hist = await repo.spoolHistory(db, id);
    expect(hist.map((h) => h.kind).sort()).toEqual(["adjustment", "print"]);
  });

  it("only archives spools that have prints (FR-SP-6)", async () => {
    const used = await repo.createSpool(db, spool());
    const unused = await repo.createSpool(db, spool({ spoolCode: "PLA-02" }));
    await repo.savePrint(db, print(used));
    await expect(repo.deleteSpool(db, used)).rejects.toThrow(/archived/);
    await repo.deleteSpool(db, unused);
    expect(await repo.getSpool(db, unused)).toBeNull();
    // the freed ID can be reused
    await repo.createSpool(db, spool({ spoolCode: "PLA-02" }));

    await repo.setSpoolStatus(db, used, "archived");
    expect((await repo.listSpools(db)).map((s) => s.id)).not.toContain(used);
    expect((await repo.listSpools(db, { includeArchived: true })).map((s) => s.id)).toContain(used);
  });
});

describe("prints", () => {
  it("stores the price snapshot and deducts from several spools", async () => {
    const a = await repo.createSpool(db, spool());
    const b = await repo.createSpool(db, spool({ spoolCode: "PETG-01", price: 2000 }));
    const id = await repo.savePrint(
      db,
      print(a, {
        lines: [
          { spoolId: a, modelG: 50, purgeG: 10, extraG: 0 },
          { spoolId: b, modelG: 20, purgeG: 0, extraG: 5 },
        ],
      }),
    );
    const p = (await repo.getPrint(db, id))!;
    expect(p.lines).toHaveLength(2);
    expect(p.filamentCost).toBe(122); // 60×1.2 + 25×2
    expect((await repo.getSpool(db, a))!.remainingG).toBe(940);
    expect((await repo.getSpool(db, b))!.remainingG).toBe(975);

    // Changing settings or spool price later must not change the stored price.
    await repo.updateSpool(db, a, spool({ price: 5000 }));
    expect((await repo.getPrint(db, id))!.filamentCost).toBe(122);
  });

  it("recalculates spools when a print is edited or deleted (FR-PR-9)", async () => {
    const a = await repo.createSpool(db, spool());
    const id = await repo.savePrint(db, print(a));
    await repo.savePrint(db, print(a, { lines: [{ spoolId: a, modelG: 300, purgeG: 0, extraG: 0 }] }), id);
    expect((await repo.getSpool(db, a))!.remainingG).toBe(700);
    await repo.deletePrint(db, id, store);
    expect((await repo.getSpool(db, a))!.remainingG).toBe(1000);
    expect(await repo.getPrint(db, id)).toBeNull();
  });

  it("allows saving past zero so the UI can warn (FR-WN-1/3)", async () => {
    const a = await repo.createSpool(db, spool({ netWeightG: 50 }));
    await repo.savePrint(db, print(a));
    expect((await repo.getSpool(db, a))!.remainingG).toBe(-55);
  });

  it("rolls back everything when a save fails (NFR-4)", async () => {
    const a = await repo.createSpool(db, spool());
    await expect(
      repo.savePrint(
        db,
        print(a, { lines: [{ spoolId: crypto.randomUUID(), modelG: 1, purgeG: 0, extraG: 0 }] }),
      ),
    ).rejects.toThrow();
    expect(await repo.listPrints(db)).toHaveLength(0);
  });

  it("filters history", async () => {
    const a = await repo.createSpool(db, spool());
    const b = await repo.createSpool(db, spool({ spoolCode: "TPU-1", material: "TPU" }));
    await repo.savePrint(db, print(a, { modelName: "Phone stand", printedAt: "2026-01-10T10:00:00Z" }));
    await repo.savePrint(
      db,
      print(b, { modelName: "Gasket", status: "failed", printedAt: "2026-02-10T10:00:00Z" }),
    );
    expect((await repo.listPrints(db, { search: "stand" })).map((p) => p.modelName)).toEqual(["Phone stand"]);
    expect((await repo.listPrints(db, { material: "TPU" })).map((p) => p.modelName)).toEqual(["Gasket"]);
    expect((await repo.listPrints(db, { status: "failed" }))[0]!.sellingPrice).toBe(0);
    expect(
      (await repo.listPrints(db, { from: "2026-02-01T00:00:00Z", to: "2026-03-01T00:00:00Z" })).length,
    ).toBe(1);
    expect((await repo.listPrints(db, { spoolId: a })).length).toBe(1);
  });

  it("stores photos and removes them on delete", async () => {
    const a = await repo.createSpool(db, spool());
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/webp" });
    const id = await repo.savePrint(db, print(a), null, {
      photoStore: store,
      newPhotos: [{ blob, mimeType: "image/webp", width: 10, height: 10 }],
    });
    const p = (await repo.getPrint(db, id))!;
    expect(p.photos).toHaveLength(1);
    expect(await store.keys()).toEqual([p.photos[0]!.id]);
    expect((await repo.listPrints(db))[0]!.thumbId).toBe(p.photos[0]!.id);
    await repo.deletePrint(db, id, store);
    expect(await store.keys()).toEqual([]);
  });
});

describe("dashboard", () => {
  it("summarises stock and this month", async () => {
    const a = await repo.createSpool(db, spool());
    await repo.createSpool(db, spool({ spoolCode: "LOW", netWeightG: 50, price: 100 }));
    await repo.savePrint(db, print(a));
    const d = await repo.getDashboard(db);
    expect(d.activeCount).toBe(2);
    expect(d.totalStockG).toBe(945);
    expect(d.stockValue).toBe(1174); // 895×1.2 + 50×2
    expect(d.lowStock.map((s) => s.spoolCode)).toEqual(["LOW"]);
    expect(d.month.grams).toBe(105);
    expect(d.recent).toHaveLength(1);
  });
});

describe("backup", () => {
  it("round-trips all data including photos (FR-BK-1/2)", async () => {
    const a = await repo.createSpool(db, spool());
    const blob = new Blob([new Uint8Array([9, 8, 7, 6])], { type: "image/jpeg" });
    await repo.savePrint(db, print(a), null, {
      photoStore: store,
      newPhotos: [{ blob, mimeType: "image/jpeg", width: 1, height: 1 }],
    });
    await repo.correctSpoolWeight(db, a, 1000);
    const backup = await exportBackup(db, store);
    const text = JSON.stringify(backup);

    await pg.exec("TRUNCATE photos, print_spools, spool_adjustments, prints, spools, models");
    await store.clear();

    const preview = parseBackup(text);
    expect(preview.counts).toEqual({ spools: 1, prints: 1, photos: 1, adjustments: 1 });
    await importBackup(db, store, preview.backup);
    expect((await repo.getSpool(db, a))!.remainingG).toBe(800);
    const [key] = await store.keys();
    expect(new Uint8Array(await (await store.get(key!))!.arrayBuffer())).toEqual(
      new Uint8Array([9, 8, 7, 6]),
    );
  });

  it("rejects files that aren't backups or are from a newer version", () => {
    expect(() => parseBackup("not json")).toThrow(/valid JSON/);
    expect(() => parseBackup(JSON.stringify({ foo: 1 }))).toThrow(/isn't a Spooliyoo backup/);
    expect(() =>
      parseBackup(JSON.stringify({ format: "filament-tracker-backup", schemaVersion: 99 })),
    ).toThrow(/newer version/);
  });

  it("exports prints as CSV with escaping", async () => {
    const a = await repo.createSpool(db, spool());
    await repo.savePrint(db, print(a, { modelName: 'Box, "large"' }));
    await repo.savePrint(db, print(a, { modelName: "=HYPERLINK(1)" }));
    const csv = await exportPrintsCsv(db);
    expect(csv.split("\r\n")[0]).toMatch(/^Date,Model,Part,Status/);
    expect(csv).toContain('"Box, ""large"""');
    expect(csv).toContain("'=HYPERLINK(1)");
  });
});

describe("lookups", () => {
  it("return null for malformed ids instead of throwing", async () => {
    expect(await repo.getSpool(db, "nope")).toBeNull();
    expect(await repo.getPrint(db, "nope")).toBeNull();
    expect(await repo.spoolHistory(db, "nope")).toEqual([]);
  });
});

describe("backup reminder", () => {
  it("counts changes since the last backup", async () => {
    await pg.exec("UPDATE settings SET last_backup_at = NULL");
    const a = await repo.createSpool(db, spool());
    await repo.savePrint(db, print(a));
    expect((await repo.changesSinceBackup(db)).changes).toBe(2);
    await repo.markBackedUp(db);
    expect((await repo.changesSinceBackup(db)).changes).toBe(0);
    await new Promise((r) => setTimeout(r, 5));
    await repo.correctSpoolWeight(db, a, 900);
    expect((await repo.changesSinceBackup(db)).changes).toBe(1);
  });
});

describe("multi-part models", () => {
  it("groups parts under one model with combined totals", async () => {
    const a = await repo.createSpool(db, spool());
    const first = await repo.savePrint(
      db,
      print(a, { modelName: "Dragon", multiPart: true, partName: "Head", printMinutes: 60 }),
    );
    const p1 = (await repo.getPrint(db, first))!;
    expect(p1.modelId).toBeTruthy();
    expect(p1.partName).toBe("Head");

    await repo.savePrint(
      db,
      print(a, { modelName: "ignored", modelId: p1.modelId, partName: "Body", printMinutes: 90 }),
    );
    const m = (await repo.getModel(db, p1.modelId!))!;
    expect(m.name).toBe("Dragon");
    expect(m.parts.map((p) => p.partName)).toEqual(["Head", "Body"]);
    expect(m.parts[1]!.modelName).toBe("Dragon");
    expect(m.totals.grams).toBe(210);
    expect(m.totals.minutes).toBe(150);
    expect((await repo.listModels(db))[0]).toMatchObject({ name: "Dragon", parts: 2 });

    await repo.renameModel(db, m.id, "Fire dragon");
    expect((await repo.getPrint(db, first))!.modelName).toBe("Fire dragon");
    await expect(repo.deleteModel(db, m.id)).rejects.toThrow(/parts/);
  });

  it("requires a part name", async () => {
    const a = await repo.createSpool(db, spool());
    await expect(repo.savePrint(db, print(a, { multiPart: true, partName: "" }))).rejects.toThrow();
  });

  it("upgrades old (v1) backups without models", async () => {
    const a = await repo.createSpool(db, spool());
    await repo.savePrint(db, print(a));
    const b = await exportBackup(db, store);
    const v1 = JSON.parse(JSON.stringify(b));
    v1.schemaVersion = 1;
    delete v1.data.models;
    for (const p of v1.data.prints) {
      delete p.modelId;
      delete p.partName;
    }
    const preview = parseBackup(JSON.stringify(v1));
    expect(preview.backup.data.models).toEqual([]);
    expect(preview.counts.prints).toBe(1);
  });
});
