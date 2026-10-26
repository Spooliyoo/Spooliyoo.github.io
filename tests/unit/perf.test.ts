import { expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { createDb } from "@/lib/db/client";
import * as repo from "@/lib/db/repo";

// NFR-2: saving a print (and updating spools) stays under 300 ms with 5,000 prints stored.
it("saves a print quickly with 5,000 prints stored", async () => {
  const pg = await PGlite.create();
  const db = await createDb(pg);
  const spoolIds: string[] = [];
  for (let i = 0; i < 20; i++)
    spoolIds.push(
      await repo.createSpool(db, {
        spoolCode: `S-${i}`,
        name: `Spool ${i}`,
        brand: "",
        material: "PLA",
        colourName: "",
        colourHex: "#000000",
        diameterMm: 1.75,
        price: 1000,
        netWeightG: 1000000,
        tareWeightG: 0,
        purchaseDate: null,
        notes: "",
      }),
    );
  await pg.exec(`
    INSERT INTO prints (id, model_name, printed_at, print_minutes, electricity_rate, printer_watts, wear_rate, labour_rate,
      buffer_pct, markup_pct, filament_cost, electricity_cost, wear_cost, labour_cost, buffer_cost, total_cost, selling_price, profit)
    SELECT gen_random_uuid(), 'm' || g, now() - (g || ' minutes')::interval, 60, 8, 150, 5, 200, 10, 50, 1, 1, 1, 0, 0, 3, 4, 1
    FROM generate_series(1, 5000) g;
    INSERT INTO print_spools (print_id, spool_id, model_g, purge_g, extra_g, total_g, cost_per_g_snapshot)
    SELECT p.id, (ARRAY[${spoolIds.map((s) => `'${s}'::uuid`).join(",")}])[1 + (row_number() OVER () % 20)], 10, 1, 0, 11, 1 FROM prints p;
  `);
  const input = {
    modelName: "Timed",
    printedAt: new Date().toISOString(),
    printMinutes: 30,
    status: "success" as const,
    labourMinutes: 0,
    notes: "",
    priceOverride: null,
    lines: [{ spoolId: spoolIds[0]!, modelG: 10, purgeG: 1, extraG: 0 }],
    rates: {
      electricityRate: 8,
      printerWatts: 150,
      wearRate: 5,
      labourRate: 200,
      bufferPct: 10,
      markupPct: 50,
    },
  };
  await repo.savePrint(db, input); // warm-up
  const t = performance.now();
  await repo.savePrint(db, input);
  await repo.getSpool(db, spoolIds[0]!);
  const ms = performance.now() - t;
  console.log(`save + spool refresh: ${ms.toFixed(1)} ms`);
  expect(ms).toBeLessThan(300);
  const t2 = performance.now();
  await repo.getDashboard(db);
  console.log(`dashboard: ${(performance.now() - t2).toFixed(1)} ms`);
  await pg.close();
});
