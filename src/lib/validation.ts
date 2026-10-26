import { z } from "zod";
import { MATERIALS } from "./db/schema";

const nonNeg = (label: string) =>
  z
    .number({ error: `${label} is required` })
    .finite()
    .min(0, `${label} can't be negative`);

export const spoolInputSchema = z.object({
  spoolCode: z.string().trim().min(1, "Spool ID is required").max(100),
  name: z.string().trim().min(1, "Name is required").max(120),
  brand: z.string().trim().max(80).default(""),
  material: z.enum(MATERIALS),
  colourName: z.string().trim().max(60).default(""),
  colourHex: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Pick a colour"),
  diameterMm: z.union([z.literal(1.75), z.literal(2.85)]),
  price: nonNeg("Price"),
  netWeightG: nonNeg("Net weight").positive("Net weight must be more than 0"),
  tareWeightG: nonNeg("Empty-spool weight"),
  purchaseDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .default(null),
  notes: z.string().max(2000).default(""),
});
export type SpoolInput = z.infer<typeof spoolInputSchema>;

export const printLineSchema = z.object({
  spoolId: z.string().uuid("Choose a spool"),
  modelG: nonNeg("Model weight"),
  purgeG: nonNeg("Purge"),
  extraG: nonNeg("Extra"),
});

export const printInputSchema = z.object({
  modelName: z.string().trim().min(1, "Model name is required").max(200),
  printedAt: z.string().min(1, "Date is required"),
  printMinutes: z.number().int().positive("Print time must be more than 0"),
  status: z.enum(["success", "failed"]),
  labourMinutes: z.number().int().min(0).default(0),
  notes: z.string().max(4000).default(""),
  lines: z
    .array(printLineSchema)
    .min(1, "Add at least one spool")
    .refine((ls) => new Set(ls.map((l) => l.spoolId)).size === ls.length, "Each spool can only be used once"),
  rates: z.object({
    electricityRate: nonNeg("Electricity rate"),
    printerWatts: nonNeg("Printer wattage"),
    wearRate: nonNeg("Wear rate"),
    labourRate: nonNeg("Labour rate"),
    bufferPct: nonNeg("Buffer"),
    markupPct: nonNeg("Markup"),
  }),
  priceOverride: nonNeg("Selling price").nullable().default(null),
});
export type PrintInput = z.infer<typeof printInputSchema>;

export const settingsInputSchema = z.object({
  currency: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/, "Use a 3-letter currency code, e.g. INR")
    .transform((s) => s.toUpperCase()),
  defaultPurgeG: nonNeg("Purge waste"),
  electricityRate: nonNeg("Electricity rate"),
  printerWatts: nonNeg("Printer wattage"),
  wearRate: nonNeg("Wear rate"),
  labourRate: nonNeg("Labour rate"),
  bufferPct: nonNeg("Buffer"),
  markupPct: nonNeg("Markup"),
  lowStockG: nonNeg("Low-stock threshold"),
  theme: z.enum(["light", "dark", "system"]),
});
export type SettingsInput = z.infer<typeof settingsInputSchema>;
