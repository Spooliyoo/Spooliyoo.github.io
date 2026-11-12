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
  /** Index into `parts` for multi-part prints; null for single-part prints. */
  partIndex: z.number().int().min(0).nullable().default(null),
});

export const printPartSchema = z.object({
  name: z.string().trim().min(1, "Name this part, e.g. Head or Base").max(120),
  printMinutes: z.number().int().positive("Enter this part's print time"),
});

export const printInputSchema = z
  .object({
    modelName: z.string().trim().min(1, "Model name is required").max(200),
    printedAt: z.string().min(1, "Date is required"),
    /** Total print time. For multi-part prints the parts' times are added up instead. */
    printMinutes: z.number().int().positive("Print time must be more than 0"),
    status: z.enum(["success", "failed"]),
    labourMinutes: z.number().int().min(0).default(0),
    notes: z.string().max(4000).default(""),
    /** Empty for a single-part print. */
    parts: z.array(printPartSchema).default([]),
    lines: z
      .array(printLineSchema)
      .min(1, "Add at least one spool")
      .refine(
        (ls) => new Set(ls.map((l) => `${l.partIndex ?? "-"}:${l.spoolId}`)).size === ls.length,
        "Each spool can only be used once per part",
      ),
    rates: z.object({
      electricityRate: nonNeg("Electricity rate"),
      printerWatts: nonNeg("Printer wattage"),
      wearRate: nonNeg("Wear rate"),
      labourRate: nonNeg("Labour rate"),
      bufferPct: nonNeg("Buffer"),
      markupPct: nonNeg("Markup"),
    }),
    priceOverride: nonNeg("Selling price").nullable().default(null),
  })
  .superRefine((v, ctx) => {
    if (v.parts.length === 0) {
      if (v.lines.some((l) => l.partIndex != null))
        ctx.addIssue({ code: "custom", path: ["lines"], message: "Lines refer to parts that don't exist" });
      return;
    }
    v.lines.forEach((l, i) => {
      if (l.partIndex == null || l.partIndex >= v.parts.length)
        ctx.addIssue({ code: "custom", path: ["lines", i, "partIndex"], message: "Choose a part" });
    });
    v.parts.forEach((_, pi) => {
      if (!v.lines.some((l) => l.partIndex === pi))
        ctx.addIssue({ code: "custom", path: ["parts", pi, "name"], message: "Add a spool to this part" });
    });
  });
export type PrintInput = z.input<typeof printInputSchema>;

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
