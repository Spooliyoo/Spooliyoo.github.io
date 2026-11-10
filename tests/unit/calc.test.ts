import { describe, expect, it } from "vitest";
import {
  calculatePrice,
  costPerGram,
  defaultPurgeSplit,
  formatDuration,
  lineTotalG,
  normaliseSpoolCode,
  parseDuration,
  parseTimestamp,
  percentLeft,
  remainingGrams,
  round2,
  weightCorrection,
  type Rates,
} from "@/lib/calc";

const rates: Rates = {
  electricityRate: 8,
  printerWatts: 150,
  wearRate: 5,
  labourRate: 200,
  bufferPct: 10,
  markupPct: 50,
};

describe("price calculator (SRS 3.3)", () => {
  it("matches the worked formula", () => {
    // 100 g model + 5 g purge + 0 extra @ ₹1/g; 2 h print; 30 min labour
    const r = calculatePrice({
      lines: [{ modelG: 100, purgeG: 5, extraG: 0, costPerG: 1 }],
      printMinutes: 120,
      labourMinutes: 30,
      rates,
    });
    expect(r.filamentG).toBe(105);
    expect(r.filamentCost).toBe(105);
    expect(r.electricityCost).toBe(2.4); // 2 h × 0.15 kW × 8
    expect(r.wearCost).toBe(10); // 2 h × 5
    expect(r.labourCost).toBe(100); // 0.5 h × 200
    expect(r.bufferCost).toBe(21.74); // 10% of 217.4
    expect(r.totalCost).toBe(239.14);
    expect(r.sellingPrice).toBe(358.71); // × 1.5
    expect(r.profit).toBe(119.57);
    expect(r.priceOverridden).toBe(false);
  });

  it("sums filament across several spools at their own cost per gram", () => {
    const r = calculatePrice({
      lines: [
        { modelG: 50, purgeG: 10, extraG: 0, costPerG: 1.2 },
        { modelG: 20, purgeG: 0, extraG: 5, costPerG: 2 },
      ],
      printMinutes: 60,
      rates: { ...rates, bufferPct: 0, markupPct: 0, wearRate: 0, electricityRate: 0 },
    });
    expect(r.filamentCost).toBe(122);
    expect(r.totalCost).toBe(122);
  });

  it("treats blank labour as 0 (FR-PC-4)", () => {
    const r = calculatePrice({ lines: [], printMinutes: 60, labourMinutes: null, rates });
    expect(r.labourCost).toBe(0);
  });

  it("applies a manual selling price and recalculates profit (FR-PC-3)", () => {
    const r = calculatePrice({
      lines: [{ modelG: 100, purgeG: 0, extraG: 0, costPerG: 1 }],
      printMinutes: 60,
      rates: { ...rates, electricityRate: 0, wearRate: 0, bufferPct: 0 },
      priceOverride: 500,
    });
    expect(r.sellingPrice).toBe(500);
    expect(r.calculatedPrice).toBe(150);
    expect(r.profit).toBe(400);
    expect(r.priceOverridden).toBe(true);
  });

  it("gives failed prints no revenue — whole cost is a loss", () => {
    const r = calculatePrice({
      lines: [{ modelG: 40, purgeG: 0, extraG: 0, costPerG: 1 }],
      printMinutes: 30,
      rates: { ...rates, electricityRate: 0, wearRate: 0, bufferPct: 0 },
      failed: true,
      priceOverride: 999,
    });
    expect(r.sellingPrice).toBe(0);
    expect(r.profit).toBe(-40);
  });

  it("rounds to 2 decimals (FR-PC-5)", () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(2.675)).toBe(2.68);
  });
});

describe("spool maths (SRS 4.2)", () => {
  it("derives remaining grams and percentage", () => {
    expect(remainingGrams(1000, 250, -10)).toBe(740);
    expect(percentLeft(250, 1000)).toBe(25);
    expect(percentLeft(-20, 1000)).toBe(0);
    expect(percentLeft(10, 0)).toBe(0);
  });
  it("cost per gram", () => {
    expect(costPerGram(1200, 1000)).toBe(1.2);
    expect(costPerGram(1200, 0)).toBe(0);
  });
  it("weight correction sets remaining = gross − tare", () => {
    expect(weightCorrection(950, 200, 800)).toEqual({ remainingAfterG: 750, deltaG: -50 });
  });
  it("line total is model + purge + extra", () => {
    expect(lineTotalG({ modelG: 10, purgeG: 2, extraG: 1.5 })).toBe(13.5);
  });
  it("default purge split puts everything on the first spool", () => {
    expect(defaultPurgeSplit(3, 6)).toEqual([6, 0, 0]);
  });
});

describe("helpers", () => {
  it("parses h:mm and minutes", () => {
    expect(parseDuration("1:30")).toBe(90);
    expect(parseDuration("0:05")).toBe(5);
    expect(parseDuration("45")).toBe(45);
    expect(parseDuration("1:75")).toBeNaN();
    expect(parseDuration("")).toBeNaN();
    expect(formatDuration(95)).toBe("1:35");
  });
  it("normalises spool codes case-insensitively", () => {
    expect(normaliseSpoolCode("  PLA-01 ")).toBe("pla-01");
  });
  it("parses Postgres timestamps", () => {
    expect(parseTimestamp("2026-10-26 03:50:12.5+00")?.toISOString()).toBe("2026-10-26T03:50:12.500Z");
    expect(parseTimestamp("2026-10-26 09:20:00+05:30")?.toISOString()).toBe("2026-10-26T03:50:00.000Z");
    expect(parseTimestamp("2026-10-26T03:50:00.000Z")?.toISOString()).toBe("2026-10-26T03:50:00.000Z");
  });
});

describe("print time boxes", () => {
  it("combines hours and minutes", async () => {
    const { durationFromParts } = await import("@/lib/calc");
    expect(durationFromParts("1", "30")).toBe(90);
    expect(durationFromParts("", "45")).toBe(45);
    expect(durationFromParts("2", "")).toBe(120);
    expect(durationFromParts("", "")).toBeNaN();
    expect(durationFromParts("1", "60")).toBeNaN();
    expect(durationFromParts("1.5", "0")).toBeNaN();
  });
});
