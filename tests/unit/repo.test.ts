import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { createDb, runMigrations, type DB } from "@/lib/db/client";
import { MemoryPhotoStore } from "@/lib/db/photo-store";
import * as repo from "@/lib/db/repo";
import { exportBackup, exportPrintsCsv, importBackup, parseBackup } from "@/lib/db/backup";
import { LEGACY_MODEL_CONVERSION } from "@/lib/db/legacy";
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
  await pg.exec("TRUNCATE photos, print_spools, print_parts, spool_adjustments, prints, spools, models");
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
    await repo.deletePrint(db, id);
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

  it("keeps photos while a print is in Recently deleted, removes them when deleted forever", async () => {
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
    await repo.deletePrint(db, id);
    expect(await store.keys()).toHaveLength(1);
    await repo.purgePrint(db, id, store);
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

    await pg.exec("TRUNCATE photos, print_spools, print_parts, spool_adjustments, prints, spools, models");
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
    expect(csv.split("\r\n")[0]).toMatch(/^Date,Model,Parts,Status/);
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

describe("parts inside one print", () => {
  it("logs several parts in one print with their own times and spools", async () => {
    const a = await repo.createSpool(db, spool());
    const b = await repo.createSpool(db, spool({ spoolCode: "PETG-1", price: 2000 }));
    const id = await repo.savePrint(
      db,
      print(a, {
        modelName: "Dragon",
        printMinutes: 1, // ignored: parts' times are added up
        parts: [
          { name: "Head", printMinutes: 60 },
          { name: "Body", printMinutes: 90 },
        ],
        lines: [
          { spoolId: a, modelG: 50, purgeG: 5, extraG: 0, partIndex: 0 },
          { spoolId: a, modelG: 100, purgeG: 0, extraG: 0, partIndex: 1 },
          { spoolId: b, modelG: 20, purgeG: 0, extraG: 0, partIndex: 1 },
        ],
      }),
    );
    const p = (await repo.getPrint(db, id))!;
    expect(p.printMinutes).toBe(150);
    expect(p.parts.map((x) => x.name)).toEqual(["Head", "Body"]);
    const [head, body] = p.parts;
    expect(p.lines.filter((l) => l.partId === head!.id)).toHaveLength(1);
    expect(p.lines.filter((l) => l.partId === body!.id)).toHaveLength(2);
    expect((await repo.getSpool(db, a))!.remainingG).toBe(845); // same spool used by both parts
    expect(p.filamentCost).toBe(226); // 155 g × 1.2 + 20 g × 2
    const [row] = await repo.listPrints(db);
    expect(row!.partNames).toEqual(["Head", "Body"]);

    // Editing replaces the parts
    await repo.savePrint(
      db,
      print(a, {
        modelName: "Dragon",
        parts: [{ name: "Whole", printMinutes: 30 }],
        lines: [{ spoolId: a, modelG: 10, purgeG: 0, extraG: 0, partIndex: 0 }],
      }),
      id,
    );
    const edited = (await repo.getPrint(db, id))!;
    expect(edited.parts.map((x) => x.name)).toEqual(["Whole"]);
    expect(edited.printMinutes).toBe(30);
  });

  it("rejects parts without a name or without spools", async () => {
    const a = await repo.createSpool(db, spool());
    await expect(
      repo.savePrint(
        db,
        print(a, {
          parts: [{ name: "", printMinutes: 10 }],
          lines: [{ spoolId: a, modelG: 1, purgeG: 0, extraG: 0, partIndex: 0 }],
        }),
      ),
    ).rejects.toThrow();
    await expect(
      repo.savePrint(
        db,
        print(a, {
          parts: [
            { name: "A", printMinutes: 10 },
            { name: "B", printMinutes: 10 },
          ],
          lines: [{ spoolId: a, modelG: 1, purgeG: 0, extraG: 0, partIndex: 0 }],
        }),
      ),
    ).rejects.toThrow();
  });

  it("converts old multi-print models into one print with parts", async () => {
    const a = await repo.createSpool(db, spool());
    const p1 = await repo.savePrint(
      db,
      print(a, { modelName: "Old", printMinutes: 60, printedAt: "2026-01-01T10:00:00Z" }),
    );
    const p2 = await repo.savePrint(
      db,
      print(a, {
        modelName: "Old",
        printMinutes: 30,
        printedAt: "2026-01-02T10:00:00Z",
        lines: [{ spoolId: a, modelG: 40, purgeG: 0, extraG: 0 }],
      }),
    );
    // Recreate the legacy shape: a models row with both prints linked to it as parts.
    await pg.exec(
      `INSERT INTO models (id, name) VALUES ('11111111-1111-4111-8111-111111111111', 'Old model')`,
    );
    await pg.exec(
      `UPDATE prints SET model_id = '11111111-1111-4111-8111-111111111111', part_name = CASE WHEN id = '${p1}' THEN 'Head' ELSE 'Body' END`,
    );
    await pg.transaction(async (tx) => {
      for (const stmt of LEGACY_MODEL_CONVERSION) await tx.exec(stmt);
    });
    const list = await repo.listPrints(db);
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(p1);
    expect(list[0]!.modelName).toBe("Old model");
    expect(list[0]!.partNames).toEqual(["Head", "Body"]);
    expect(list[0]!.printMinutes).toBe(90);
    expect(list[0]!.totalG).toBe(145);
    expect(await repo.getPrint(db, p2)).toBeNull();
    expect((await repo.getSpool(db, a))!.remainingG).toBe(855);
    expect(await repo.listDeletedPrints(db)).toEqual([]); // merged prints don't show up as deleted
  });
});

describe("recently deleted", () => {
  it("restores exactly what was deleted", async () => {
    const a = await repo.createSpool(db, spool());
    const id = await repo.savePrint(
      db,
      print(a, {
        parts: [{ name: "A", printMinutes: 20 }],
        lines: [{ spoolId: a, modelG: 100, purgeG: 0, extraG: 0, partIndex: 0 }],
      }),
    );
    // An earlier edit leaves an old, already-deleted line that must NOT come back.
    await repo.savePrint(
      db,
      print(a, {
        parts: [{ name: "A", printMinutes: 20 }],
        lines: [{ spoolId: a, modelG: 50, purgeG: 0, extraG: 0, partIndex: 0 }],
      }),
      id,
    );
    await new Promise((r) => setTimeout(r, 5));
    await repo.deletePrint(db, id);
    expect((await repo.getSpool(db, a))!.remainingG).toBe(1000);
    const [d] = await repo.listDeletedPrints(db);
    expect(d).toMatchObject({ id, totalG: 50, partCount: 1 });

    await repo.restorePrint(db, id);
    const p = (await repo.getPrint(db, id))!;
    expect(p.lines).toHaveLength(1);
    expect(p.parts).toHaveLength(1);
    expect((await repo.getSpool(db, a))!.remainingG).toBe(950);
    expect(await repo.listDeletedPrints(db)).toEqual([]);
  });

  it("purges prints deleted more than 30 days ago", async () => {
    const a = await repo.createSpool(db, spool());
    const oldId = await repo.savePrint(db, print(a));
    const newId = await repo.savePrint(db, print(a));
    await repo.deletePrint(db, oldId);
    await repo.deletePrint(db, newId);
    await pg.exec(`UPDATE prints SET deleted_at = now() - interval '31 days' WHERE id = '${oldId}'`);
    expect(await repo.purgeExpiredDeleted(db, store)).toBe(1);
    expect((await repo.listDeletedPrints(db)).map((d) => d.id)).toEqual([newId]);
  });
});

describe("backup upgrades", () => {
  it("upgrades old (v1) backups", async () => {
    const a = await repo.createSpool(db, spool());
    await repo.savePrint(db, print(a));
    const b = await exportBackup(db, store);
    const v1 = JSON.parse(JSON.stringify(b));
    v1.schemaVersion = 1;
    delete v1.data.models;
    delete v1.data.printParts;
    for (const p of v1.data.prints) {
      delete p.modelId;
      delete p.partName;
    }
    for (const l of v1.data.printSpools) delete l.partId;
    const preview = parseBackup(JSON.stringify(v1));
    expect(preview.backup.data.printParts).toEqual([]);
    expect(preview.counts.prints).toBe(1);
  });

  it("round-trips prints with parts", async () => {
    const a = await repo.createSpool(db, spool());
    await repo.savePrint(
      db,
      print(a, {
        parts: [{ name: "Lid", printMinutes: 15 }],
        lines: [{ spoolId: a, modelG: 10, purgeG: 0, extraG: 0, partIndex: 0 }],
      }),
    );
    const text = JSON.stringify(await exportBackup(db, store));
    await pg.exec("TRUNCATE photos, print_spools, print_parts, spool_adjustments, prints, spools, models");
    await importBackup(db, store, parseBackup(text).backup);
    expect((await repo.listPrints(db))[0]!.partNames).toEqual(["Lid"]);
  });
});
