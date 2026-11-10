/** Pure calculation functions. No I/O — every formula in SRS §3.3 and §4.2 lives here and is unit-tested. */

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export interface Rates {
  electricityRate: number; // currency per kWh
  printerWatts: number;
  wearRate: number; // currency per print hour
  labourRate: number; // currency per labour hour
  bufferPct: number;
  markupPct: number;
}

export interface UsageLineInput {
  modelG: number;
  purgeG: number;
  extraG: number;
  costPerG: number;
}

export interface PriceInput {
  lines: UsageLineInput[];
  printMinutes: number;
  labourMinutes?: number | null;
  rates: Rates;
  failed?: boolean;
  /** Manually overridden selling price (FR-PC-3). null/undefined = use calculated price. */
  priceOverride?: number | null;
}

export interface PriceBreakdown {
  filamentG: number;
  filamentCost: number;
  electricityCost: number;
  wearCost: number;
  labourCost: number;
  bufferCost: number;
  totalCost: number;
  calculatedPrice: number;
  sellingPrice: number;
  priceOverridden: boolean;
  profit: number;
}

export const lineTotalG = (l: Pick<UsageLineInput, "modelG" | "purgeG" | "extraG">): number =>
  (l.modelG || 0) + (l.purgeG || 0) + (l.extraG || 0);

export const costPerGram = (price: number, netWeightG: number): number =>
  netWeightG > 0 ? price / netWeightG : 0;

export function calculatePrice(input: PriceInput): PriceBreakdown {
  const { rates } = input;
  const hours = Math.max(0, input.printMinutes || 0) / 60;
  const labourHours = Math.max(0, input.labourMinutes || 0) / 60;

  const filamentG = input.lines.reduce((s, l) => s + lineTotalG(l), 0);
  const filament = input.lines.reduce((s, l) => s + lineTotalG(l) * l.costPerG, 0);
  const electricity = hours * (rates.printerWatts / 1000) * rates.electricityRate;
  const wear = hours * rates.wearRate;
  const labour = labourHours * rates.labourRate;
  const subtotal = filament + electricity + wear + labour;
  const buffer = subtotal * (rates.bufferPct / 100);
  const cost = subtotal + buffer;
  // A failed print earns nothing; its whole cost is a loss.
  const calculated = input.failed ? 0 : cost * (1 + rates.markupPct / 100);
  const overridden = !input.failed && input.priceOverride != null && Number.isFinite(input.priceOverride);
  const price = overridden ? (input.priceOverride as number) : calculated;

  return {
    filamentG: round2(filamentG),
    filamentCost: round2(filament),
    electricityCost: round2(electricity),
    wearCost: round2(wear),
    labourCost: round2(labour),
    bufferCost: round2(buffer),
    totalCost: round2(cost),
    calculatedPrice: round2(calculated),
    sellingPrice: round2(price),
    priceOverridden: overridden,
    profit: round2(price - cost),
  };
}

/** SRS §4.2: remaining = net − Σ usage + Σ adjustments. */
export const remainingGrams = (netWeightG: number, usedG: number, adjustmentsG: number): number =>
  netWeightG - usedG + adjustmentsG;

export const percentLeft = (remainingG: number, netWeightG: number): number =>
  netWeightG > 0 ? Math.max(0, Math.min(100, (remainingG / netWeightG) * 100)) : 0;

/** FR-SP-5: weight correction from a scale reading. */
export function weightCorrection(measuredGrossG: number, tareWeightG: number, remainingBeforeG: number) {
  const remainingAfterG = measuredGrossG - tareWeightG;
  return { remainingAfterG, deltaG: remainingAfterG - remainingBeforeG };
}

/** "h:mm" or plain minutes → minutes. Returns NaN when invalid. */
export function parseDuration(value: string): number {
  const v = value.trim();
  if (!v) return NaN;
  const m = /^(\d+):([0-5]?\d)$/.exec(v);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  if (/^\d+$/.test(v)) return Number(v);
  return NaN;
}

export const formatDuration = (minutes: number): string =>
  `${Math.floor(minutes / 60)}:${String(Math.round(minutes % 60)).padStart(2, "0")}`;

export const normaliseSpoolCode = (code: string): string => code.trim().toLowerCase();

/** FR-PR-5: split a print's purge across lines — by default all of it on the first line. */
export function defaultPurgeSplit(lineCount: number, purgeG: number): number[] {
  return Array.from({ length: lineCount }, (_, i) => (i === 0 ? purgeG : 0));
}

/** Formats money with Intl, falling back gracefully for unknown currency codes. */
export function formatMoney(value: number, currency: string, locale?: string): string {
  try {
    return new Intl.NumberFormat(locale ?? (currency === "INR" ? "en-IN" : undefined), {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

export const formatGrams = (g: number): string =>
  `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(g)} g`;

/** Parses Postgres timestamp text ("2026-10-26 03:50:12.1+00") or ISO strings into a Date, Safari-safe. */
export function parseTimestamp(v: string | Date | null | undefined): Date | null {
  if (v == null) return null;
  if (v instanceof Date) return v;
  let s = v.trim().replace(" ", "T");
  s = s.replace(/([+-]\d{2})$/, "$1:00").replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Hours + minutes boxes → total minutes. Blank counts as 0; both blank, decimals or minutes ≥ 60 → NaN. */
export function durationFromParts(hours: string, minutes: string): number {
  const h = hours.trim();
  const m = minutes.trim();
  if (!h && !m) return NaN;
  const hn = h ? Number(h) : 0;
  const mn = m ? Number(m) : 0;
  if (!Number.isInteger(hn) || !Number.isInteger(mn) || hn < 0 || mn < 0 || mn > 59) return NaN;
  return hn * 60 + mn;
}
