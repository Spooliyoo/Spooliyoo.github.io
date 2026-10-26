"use client";

import * as React from "react";
import { useForm, useWatch } from "react-hook-form";
import { useRouter } from "next/navigation";
import type { z } from "zod";
import { Save } from "lucide-react";
import { MATERIALS } from "@/lib/db/schema";
import { spoolInputSchema, type SpoolInput } from "@/lib/validation";
import { zodResolver } from "@/lib/zod-resolver";
import { createSpool, updateSpool, UserError } from "@/lib/db/repo";
import { useSettings, useToast, useWrite } from "./providers";
import { Alert, Button, Card, Field, Input, Select, Textarea } from "./ui";
import { errorMessage } from "@/lib/utils";

const PRESET_COLOURS = [
  ["Black", "#1a1a1a"],
  ["White", "#f5f5f5"],
  ["Grey", "#8a8a8a"],
  ["Red", "#d63a2f"],
  ["Orange", "#f07c22"],
  ["Yellow", "#f5c518"],
  ["Green", "#3aa655"],
  ["Blue", "#2f6fd6"],
  ["Purple", "#7d4bc9"],
  ["Pink", "#ee7fb5"],
  ["Brown", "#7a4b2a"],
  ["Silver", "#c0c4c8"],
] as const;

export const EMPTY_SPOOL: SpoolInput = {
  spoolCode: "",
  name: "",
  brand: "",
  material: "PLA",
  colourName: "",
  colourHex: "#1a1a1a",
  diameterMm: 1.75,
  price: NaN,
  netWeightG: 1000,
  tareWeightG: NaN,
  purchaseDate: null,
  notes: "",
};

export function SpoolForm({
  spoolId,
  initial,
  codeTaken,
}: {
  spoolId?: string;
  initial: SpoolInput;
  codeTaken?: boolean;
}) {
  const router = useRouter();
  const write = useWrite();
  const toast = useToast();
  const settings = useSettings();
  const [formError, setFormError] = React.useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setValue,
    control,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<SpoolInput>({
    resolver: zodResolver(spoolInputSchema as unknown as z.ZodType<SpoolInput>),
    defaultValues: initial,
  });
  const hex = useWatch({ control, name: "colourHex" });

  const onSubmit = handleSubmit(async (v) => {
    setFormError(null);
    try {
      const id = await write(({ db }) =>
        spoolId ? updateSpool(db, spoolId, v).then(() => spoolId) : createSpool(db, v),
      );
      toast(spoolId ? "Spool updated" : "Spool added");
      router.replace(`/spools/view/?id=${id}`);
    } catch (e) {
      if (e instanceof UserError && /Spool ID/.test(e.message)) setError("spoolCode", { message: e.message });
      else setFormError(errorMessage(e));
    }
  });

  const numOpts = { valueAsNumber: true } as const;

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {formError && <Alert variant="danger">{formError}</Alert>}
      <Card className="grid gap-4 p-4 sm:grid-cols-2">
        <Field
          label="Spool ID"
          htmlFor="spoolCode"
          error={errors.spoolCode?.message}
          hint={
            codeTaken
              ? "Change this — duplicates need their own ID."
              : "Any unique code: box label, NFC tag ID, your own number"
          }
        >
          <Input
            id="spoolCode"
            autoFocus={!spoolId}
            autoCapitalize="characters"
            className="font-mono"
            aria-invalid={!!errors.spoolCode}
            {...register("spoolCode")}
          />
        </Field>
        <Field label="Display name" htmlFor="name" error={errors.name?.message}>
          <Input
            id="name"
            placeholder="e.g. Matte Black PLA"
            aria-invalid={!!errors.name}
            {...register("name")}
          />
        </Field>
        <Field label="Brand" htmlFor="brand">
          <Input id="brand" {...register("brand")} />
        </Field>
        <Field label="Material" htmlFor="material">
          <Select id="material" {...register("material")}>
            {MATERIALS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </Select>
        </Field>
        <Field label="Colour" htmlFor="colourName" className="sm:col-span-2">
          <div className="flex gap-2">
            <input
              type="color"
              aria-label="Colour swatch"
              className="border-input bg-card h-10 w-12 shrink-0 cursor-pointer rounded-lg border p-1"
              value={hex}
              onChange={(e) => setValue("colourHex", e.target.value, { shouldDirty: true })}
            />
            <Input id="colourName" placeholder="Colour name" {...register("colourName")} />
          </div>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {PRESET_COLOURS.map(([n, c]) => (
              <button
                key={c}
                type="button"
                title={n}
                aria-label={n}
                onClick={() => {
                  setValue("colourHex", c, { shouldDirty: true });
                  setValue("colourName", n, { shouldDirty: true });
                }}
                className="ring-offset-card focus-visible:ring-ring aria-pressed:ring-primary size-7 rounded-full border border-black/10 ring-offset-2 focus-visible:ring-2 aria-pressed:ring-2"
                aria-pressed={hex.toLowerCase() === c}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </Field>
        <Field label="Diameter" htmlFor="diameterMm">
          <Select id="diameterMm" {...register("diameterMm", { setValueAs: Number })}>
            <option value={1.75}>1.75 mm</option>
            <option value={2.85}>2.85 mm</option>
          </Select>
        </Field>
        <Field label={`Price (${settings?.currency ?? "INR"})`} htmlFor="price" error={errors.price?.message}>
          <Input
            id="price"
            type="number"
            inputMode="decimal"
            step="0.01"
            min={0}
            aria-invalid={!!errors.price}
            {...register("price", numOpts)}
          />
        </Field>
        <Field
          label="Net filament weight (g)"
          htmlFor="netWeightG"
          error={errors.netWeightG?.message}
          hint="Filament only, as on the label"
        >
          <Input
            id="netWeightG"
            type="number"
            inputMode="decimal"
            step="any"
            min={0}
            aria-invalid={!!errors.netWeightG}
            {...register("netWeightG", numOpts)}
          />
        </Field>
        <Field
          label="Empty-spool weight (g)"
          htmlFor="tareWeightG"
          error={errors.tareWeightG?.message}
          hint="Used for weight corrections on a scale"
        >
          <Input
            id="tareWeightG"
            type="number"
            inputMode="decimal"
            step="any"
            min={0}
            aria-invalid={!!errors.tareWeightG}
            {...register("tareWeightG", numOpts)}
          />
        </Field>
        <Field label="Purchase date" htmlFor="purchaseDate">
          <Input
            id="purchaseDate"
            type="date"
            {...register("purchaseDate", { setValueAs: (v: string) => v || null })}
          />
        </Field>
        <Field label="Notes" htmlFor="notes" className="sm:col-span-2">
          <Textarea id="notes" {...register("notes")} />
        </Field>
      </Card>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          <Save /> {spoolId ? "Save changes" : "Add spool"}
        </Button>
      </div>
    </form>
  );
}
