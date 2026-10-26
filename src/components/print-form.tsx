"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Camera, ImagePlus, Plus, Save, Trash2, X, ChevronDown } from "lucide-react";
import { useApp, useMoney, useToast, useWrite } from "./providers";
import { Alert, Button, Card, CardHeader, Field, Input, Select, Swatch, Textarea } from "./ui";
import { PhotoImg } from "./shared";
import { listSpools, savePrint, type NewPhoto, type PrintDetail, type SpoolWithStats } from "@/lib/db/repo";
import type { Settings } from "@/lib/db/schema";
import {
  calculatePrice,
  formatDuration,
  formatGrams,
  lineTotalG,
  parseDuration,
  parseTimestamp,
  type Rates,
} from "@/lib/calc";
import { printInputSchema, type PrintInput } from "@/lib/validation";
import { compressPhoto } from "@/lib/photos";
import { cn, errorMessage, num, toLocalInput } from "@/lib/utils";

interface LineState {
  key: string;
  spoolId: string;
  modelG: string;
  purgeG: string;
  extraG: string;
}

interface Preview extends NewPhoto {
  key: string;
  url: string;
}

const rateFields: { key: keyof Rates; label: string; unit: (c: string) => string }[] = [
  { key: "electricityRate", label: "Electricity", unit: (c) => `${c}/kWh` },
  { key: "printerWatts", label: "Printer power", unit: () => "W" },
  { key: "wearRate", label: "Wear", unit: (c) => `${c}/h` },
  { key: "labourRate", label: "Labour", unit: (c) => `${c}/h` },
  { key: "bufferPct", label: "Failure buffer", unit: () => "%" },
  { key: "markupPct", label: "Markup", unit: () => "%" },
];

const newKey = () => Math.random().toString(36).slice(2);

export function PrintForm({
  settings,
  existing,
  presetSpoolId,
}: {
  settings: Settings;
  existing?: PrintDetail;
  presetSpoolId?: string | null;
}) {
  const router = useRouter();
  const { db, photos: photoStore } = useApp();
  const write = useWrite();
  const toast = useToast();
  const money = useMoney();
  const [spools, setSpools] = React.useState<SpoolWithStats[] | null>(null);

  const [modelName, setModelName] = React.useState(existing?.modelName ?? "");
  const [printedAt, setPrintedAt] = React.useState(
    toLocalInput(parseTimestamp(existing?.printedAt) ?? new Date()),
  );
  const [printTime, setPrintTime] = React.useState(existing ? formatDuration(existing.printMinutes) : "");
  const [status, setStatus] = React.useState<"success" | "failed">(
    (existing?.status as "success" | "failed") ?? "success",
  );
  const [labour, setLabour] = React.useState(existing?.labourMinutes ? String(existing.labourMinutes) : "");
  const [notes, setNotes] = React.useState(existing?.notes ?? "");
  const [lines, setLines] = React.useState<LineState[]>(
    existing
      ? existing.lines.map((l) => ({
          key: newKey(),
          spoolId: l.spoolId,
          modelG: String(l.modelG),
          purgeG: String(l.purgeG),
          extraG: l.extraG ? String(l.extraG) : "",
        }))
      : [
          {
            key: newKey(),
            spoolId: presetSpoolId ?? "",
            modelG: "",
            purgeG: String(settings.defaultPurgeG),
            extraG: "",
          },
        ],
  );
  const [rates, setRates] = React.useState<Record<keyof Rates, string>>(() => {
    const src = existing ?? settings;
    return Object.fromEntries(rateFields.map((f) => [f.key, String(src[f.key])])) as Record<
      keyof Rates,
      string
    >;
  });
  const [ratesOpen, setRatesOpen] = React.useState(false);
  const [override, setOverride] = React.useState(
    existing?.priceOverridden ? String(existing.sellingPrice) : "",
  );
  const [keptPhotos, setKeptPhotos] = React.useState(existing?.photos ?? []);
  const [newPhotos, setNewPhotos] = React.useState<Preview[]>([]);
  const [busyPhotos, setBusyPhotos] = React.useState(0);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    listSpools(db, { includeArchived: true }).then((all) => {
      setSpools(all);
      // Pre-select the most recently used active spool to make logging fast (NFR-9).
      if (!existing && !presetSpoolId) {
        const recent = all
          .filter((s) => s.status === "active" && s.lastUsedAt)
          .sort((a, b) => (b.lastUsedAt ?? "").localeCompare(a.lastUsedAt ?? ""))[0];
        const first = recent ?? all.find((s) => s.status === "active");
        if (first)
          setLines((ls) => ls.map((l, i) => (i === 0 && !l.spoolId ? { ...l, spoolId: first.id } : l)));
      }
    });
  }, [db, existing, presetSpoolId]);

  React.useEffect(() => () => newPhotos.forEach((p) => URL.revokeObjectURL(p.url)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const spoolById = React.useMemo(() => new Map((spools ?? []).map((s) => [s.id, s])), [spools]);
  // Usage already counted from this print (when editing) is available again.
  const previousUse = React.useMemo(
    () => new Map((existing?.lines ?? []).map((l) => [l.spoolId, l.totalG])),
    [existing],
  );
  const selectable = (spools ?? []).filter(
    (s) => s.status === "active" || lines.some((l) => l.spoolId === s.id),
  );

  const failed = status === "failed";
  const minutes = parseDuration(printTime);
  const rateNums = Object.fromEntries(
    rateFields.map((f) => [f.key, num(rates[f.key], 0)]),
  ) as unknown as Rates;
  const lineNums = lines.map((l) => ({
    spoolId: l.spoolId,
    modelG: num(l.modelG, 0),
    purgeG: num(l.purgeG, 0),
    extraG: num(l.extraG, 0),
  }));
  const price = calculatePrice({
    lines: lineNums.map((l) => {
      const s = spoolById.get(l.spoolId);
      const old = existing?.lines.find((x) => x.spoolId === l.spoolId);
      return { ...l, costPerG: old?.costPerGSnapshot ?? (s ? s.costPerG : 0) };
    }),
    printMinutes: Number.isFinite(minutes) ? minutes : 0,
    labourMinutes: num(labour, 0),
    rates: rateNums,
    failed,
    priceOverride: override.trim() === "" ? null : Number(override),
  });

  // FR-WN-1: warn when a line needs more than the spool has.
  const shortages = lineNums
    .map((l) => {
      const s = spoolById.get(l.spoolId);
      if (!s) return null;
      const available = s.remainingG + (previousUse.get(s.id) ?? 0);
      const need = lineTotalG(l);
      return need > available ? { spool: s, need, available } : null;
    })
    .filter((x): x is NonNullable<typeof x> => !!x);

  const updateLine = (key: string, patch: Partial<LineState>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    const list = Array.from(files);
    setBusyPhotos((n) => n + list.length);
    for (const f of list) {
      try {
        const p = await compressPhoto(f);
        setNewPhotos((ps) => [...ps, { ...p, key: newKey(), url: URL.createObjectURL(p.blob) }]);
      } catch (e) {
        toast(`Couldn't read ${f.name}: ${errorMessage(e)}`, "danger");
      } finally {
        setBusyPhotos((n) => n - 1);
      }
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const input: PrintInput = {
      modelName,
      printedAt: printedAt ? new Date(printedAt).toISOString() : "",
      printMinutes: Number.isFinite(minutes) ? minutes : NaN,
      status,
      labourMinutes: num(labour, 0),
      notes,
      lines: lineNums,
      rates: Object.fromEntries(rateFields.map((f) => [f.key, num(rates[f.key])])) as unknown as Rates,
      priceOverride: failed || override.trim() === "" ? null : num(override),
    };
    const parsed = printInputSchema.safeParse(input);
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const i of parsed.error.issues) {
        const k = i.path.join(".");
        if (!errs[k]) errs[k] = i.message;
      }
      if (errs.printMinutes || !Number.isFinite(minutes))
        errs.printMinutes = "Enter print time as h:mm, e.g. 1:45";
      setErrors(errs);
      const first = Object.keys(errs)[0];
      document.getElementById(first === "printMinutes" ? "printTime" : (first ?? ""))?.focus();
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const id = await write(({ db }) =>
        savePrint(db, parsed.data, existing?.id, {
          photoStore,
          newPhotos: newPhotos.map(({ blob, mimeType, width, height }) => ({
            blob,
            mimeType,
            width,
            height,
          })),
          removePhotoIds: (existing?.photos ?? [])
            .filter((p) => !keptPhotos.some((k) => k.id === p.id))
            .map((p) => p.id),
        }),
      );
      toast(existing ? "Print updated" : "Print logged");
      router.replace(`/prints/view/?id=${id}`);
    } catch (err) {
      setFormError(errorMessage(err));
      setSaving(false);
    }
  }

  const cur = settings.currency;

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {formError && <Alert variant="danger">{formError}</Alert>}

      <Card className="grid gap-4 p-4 sm:grid-cols-2">
        <Field label="Model name" htmlFor="modelName" error={errors.modelName} className="sm:col-span-2">
          <Input
            id="modelName"
            autoFocus={!existing}
            value={modelName}
            onChange={(e) => setModelName(e.target.value)}
            aria-invalid={!!errors.modelName}
            placeholder="e.g. Articulated dragon"
          />
        </Field>
        <Field
          label="Print time (h:mm)"
          htmlFor="printTime"
          error={errors.printMinutes}
          hint="From your slicer"
        >
          <Input
            id="printTime"
            inputMode="numeric"
            placeholder="1:45"
            value={printTime}
            onChange={(e) => setPrintTime(e.target.value)}
            aria-invalid={!!errors.printMinutes}
          />
        </Field>
        <Field label="Date" htmlFor="printedAt" error={errors.printedAt}>
          <Input
            id="printedAt"
            type="datetime-local"
            value={printedAt}
            onChange={(e) => setPrintedAt(e.target.value)}
          />
        </Field>
        <fieldset className="flex flex-col gap-1.5 sm:col-span-2">
          <legend className="mb-1.5 text-sm font-medium">Result</legend>
          <div className="grid grid-cols-2 gap-2">
            {(["success", "failed"] as const).map((v) => (
              <label
                key={v}
                className={cn(
                  "has-[:focus-visible]:ring-ring flex h-10 cursor-pointer items-center justify-center rounded-lg border text-sm has-[:focus-visible]:ring-2",
                  status === v &&
                    (v === "success"
                      ? "border-success bg-success/10 font-medium"
                      : "border-danger bg-danger/10 font-medium"),
                )}
              >
                <input
                  type="radio"
                  name="status"
                  value={v}
                  checked={status === v}
                  onChange={() => setStatus(v)}
                  className="sr-only"
                />
                {v === "success" ? "Success" : "Failed"}
              </label>
            ))}
          </div>
          {failed && (
            <p className="text-muted-foreground text-xs">
              Enter the grams actually used before it failed. All of it counts as waste, with no revenue.
            </p>
          )}
        </fieldset>
      </Card>

      <Card>
        <CardHeader title="Filament" />
        <div className="flex flex-col gap-3 p-4">
          {errors.lines && <p className="text-danger text-xs">{errors.lines}</p>}
          {spools && spools.filter((s) => s.status === "active").length === 0 && !existing && (
            <Alert>
              <AlertTriangle /> Add a spool first — prints are deducted from spools.
            </Alert>
          )}
          {lines.map((l, i) => {
            const s = spoolById.get(l.spoolId);
            const lineN = lineNums[i]!;
            return (
              <div key={l.key} className="flex flex-col gap-3 rounded-lg border p-3">
                <div className="flex items-end gap-2">
                  <Field
                    label={lines.length > 1 ? `Spool ${i + 1}` : "Spool"}
                    htmlFor={`lines.${i}.spoolId`}
                    error={errors[`lines.${i}.spoolId`]}
                    className="flex-1"
                  >
                    <div className="flex items-center gap-2">
                      {s && <Swatch hex={s.colourHex} className="size-6" />}
                      <Select
                        id={`lines.${i}.spoolId`}
                        value={l.spoolId}
                        onChange={(e) => updateLine(l.key, { spoolId: e.target.value })}
                        aria-invalid={!!errors[`lines.${i}.spoolId`]}
                      >
                        <option value="">Choose a spool…</option>
                        {selectable.map((sp) => (
                          <option
                            key={sp.id}
                            value={sp.id}
                            disabled={lines.some((x) => x.key !== l.key && x.spoolId === sp.id)}
                          >
                            {sp.spoolCode} — {sp.name} (
                            {formatGrams(sp.remainingG + (previousUse.get(sp.id) ?? 0))} left)
                          </option>
                        ))}
                      </Select>
                    </div>
                  </Field>
                  {lines.length > 1 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove spool ${i + 1}`}
                      onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                    >
                      <Trash2 />
                    </Button>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <Field
                    label={failed ? "Used (g)" : "Model (g)"}
                    htmlFor={`lines.${i}.modelG`}
                    error={errors[`lines.${i}.modelG`]}
                  >
                    <Input
                      id={`lines.${i}.modelG`}
                      type="number"
                      inputMode="decimal"
                      step="any"
                      min={0}
                      value={l.modelG}
                      onChange={(e) => updateLine(l.key, { modelG: e.target.value })}
                      aria-invalid={!!errors[`lines.${i}.modelG`]}
                    />
                  </Field>
                  <Field label="Purge (g)" htmlFor={`lines.${i}.purgeG`} error={errors[`lines.${i}.purgeG`]}>
                    <Input
                      id={`lines.${i}.purgeG`}
                      type="number"
                      inputMode="decimal"
                      step="any"
                      min={0}
                      value={l.purgeG}
                      onChange={(e) => updateLine(l.key, { purgeG: e.target.value })}
                    />
                  </Field>
                  <Field label="Extra (g)" htmlFor={`lines.${i}.extraG`} error={errors[`lines.${i}.extraG`]}>
                    <Input
                      id={`lines.${i}.extraG`}
                      type="number"
                      inputMode="decimal"
                      step="any"
                      min={0}
                      placeholder="0"
                      value={l.extraG}
                      onChange={(e) => updateLine(l.key, { extraG: e.target.value })}
                    />
                  </Field>
                </div>
                <p className="tabular text-muted-foreground text-xs">
                  Total from this spool: {formatGrams(lineTotalG(lineN))}
                </p>
              </div>
            );
          })}
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() =>
              setLines((ls) => [...ls, { key: newKey(), spoolId: "", modelG: "", purgeG: "0", extraG: "" }])
            }
          >
            <Plus /> Add another spool
          </Button>
          {lines.length > 1 && (
            <p className="text-muted-foreground text-xs">
              Purge starts on the first spool. Move some to other spools if the colour changes used them.
            </p>
          )}
          {shortages.map((x) => (
            <Alert key={x.spool.id}>
              <AlertTriangle />
              <span>
                <b>{x.spool.spoolCode}</b> has {formatGrams(x.available)} left but this print needs{" "}
                {formatGrams(x.need)}. You can still save; correct the spool&apos;s weight on a scale
                afterwards.
              </span>
            </Alert>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader title="Photos" />
        <div className="flex flex-col gap-3 p-4">
          <div className="flex flex-wrap gap-2">
            {keptPhotos.map((p) => (
              <div key={p.id} className="relative">
                <PhotoImg id={p.id} alt="Print photo" className="size-20 rounded-lg" />
                <RemoveBadge onClick={() => setKeptPhotos((ps) => ps.filter((x) => x.id !== p.id))} />
              </div>
            ))}
            {newPhotos.map((p) => (
              <div key={p.key} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt="New photo" className="size-20 rounded-lg object-cover" />
                <RemoveBadge
                  onClick={() => {
                    URL.revokeObjectURL(p.url);
                    setNewPhotos((ps) => ps.filter((x) => x.key !== p.key));
                  }}
                />
              </div>
            ))}
            {busyPhotos > 0 && (
              <div className="bg-muted size-20 animate-pulse rounded-lg" aria-label="Processing photo" />
            )}
          </div>
          <div className="flex gap-2">
            <label className="border-input bg-card hover:bg-muted has-[:focus-visible]:ring-ring inline-flex h-8 cursor-pointer items-center gap-2 rounded-lg border px-3 text-xs font-medium has-[:focus-visible]:ring-2">
              <Camera className="size-4" /> Take photo
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
            <label className="border-input bg-card hover:bg-muted has-[:focus-visible]:ring-ring inline-flex h-8 cursor-pointer items-center gap-2 rounded-lg border px-3 text-xs font-medium has-[:focus-visible]:ring-2">
              <ImagePlus className="size-4" /> Choose
              <input
                type="file"
                accept="image/*"
                multiple
                className="sr-only"
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Price" />
        <div className="flex flex-col gap-4 p-4">
          <Field
            label="Labour (minutes)"
            htmlFor="labour"
            hint="Setup, removal, post-processing. Leave blank for none."
          >
            <Input
              id="labour"
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              placeholder="0"
              value={labour}
              onChange={(e) => setLabour(e.target.value)}
            />
          </Field>

          <button
            type="button"
            className="text-primary flex items-center gap-1 self-start text-sm"
            aria-expanded={ratesOpen}
            onClick={() => setRatesOpen((o) => !o)}
          >
            <ChevronDown className={cn("size-4 transition-transform", ratesOpen && "rotate-180")} /> Rates for
            this print
          </button>
          {ratesOpen && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {rateFields.map((f) => (
                <Field
                  key={f.key}
                  label={`${f.label} (${f.unit(cur)})`}
                  htmlFor={`rate-${f.key}`}
                  error={errors[`rates.${f.key}`]}
                >
                  <Input
                    id={`rate-${f.key}`}
                    type="number"
                    inputMode="decimal"
                    step="any"
                    min={0}
                    value={rates[f.key]}
                    onChange={(e) => setRates((r) => ({ ...r, [f.key]: e.target.value }))}
                  />
                </Field>
              ))}
            </div>
          )}

          <dl className="tabular grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">Filament ({formatGrams(price.filamentG)})</dt>
            <dd className="text-right">{money(price.filamentCost)}</dd>
            <dt className="text-muted-foreground">Electricity</dt>
            <dd className="text-right">{money(price.electricityCost)}</dd>
            <dt className="text-muted-foreground">Printer wear</dt>
            <dd className="text-right">{money(price.wearCost)}</dd>
            <dt className="text-muted-foreground">Labour</dt>
            <dd className="text-right">{money(price.labourCost)}</dd>
            <dt className="text-muted-foreground">Failure buffer ({rates.bufferPct || 0}%)</dt>
            <dd className="text-right">{money(price.bufferCost)}</dd>
            <dt className="border-t pt-1.5 font-medium">Cost</dt>
            <dd className="border-t pt-1.5 text-right font-medium">{money(price.totalCost)}</dd>
            {!failed && (
              <>
                <dt className="text-muted-foreground">Suggested price (+{rates.markupPct || 0}%)</dt>
                <dd className="text-right">{money(price.calculatedPrice)}</dd>
              </>
            )}
          </dl>

          {!failed && (
            <Field
              label={`Selling price (${cur})`}
              htmlFor="override"
              hint="Leave blank to use the suggested price"
              error={errors.priceOverride}
            >
              <Input
                id="override"
                type="number"
                inputMode="decimal"
                step="0.01"
                min={0}
                placeholder={price.calculatedPrice.toFixed(2)}
                value={override}
                onChange={(e) => setOverride(e.target.value)}
              />
            </Field>
          )}
          <div className="bg-muted flex items-center justify-between rounded-lg px-3 py-2">
            <span className="text-sm">
              {failed ? "Loss" : "Profit"} at {money(price.sellingPrice)}
            </span>
            <span
              className={cn(
                "tabular text-lg font-semibold",
                price.profit < 0 ? "text-danger" : "text-success",
              )}
            >
              {money(price.profit)}
            </span>
          </div>
        </div>
      </Card>

      <Card className="p-4">
        <Field label="Notes" htmlFor="notes">
          <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </Card>

      <div className="sticky bottom-20 z-10 flex justify-end gap-2 md:bottom-4">
        <Button variant="outline" className="bg-card" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" size="lg" disabled={saving || busyPhotos > 0} className="shadow-lg">
          <Save /> {existing ? "Save changes" : "Save print"}
        </Button>
      </div>
    </form>
  );
}

function RemoveBadge({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="Remove photo"
      onClick={onClick}
      className="bg-foreground text-background absolute -top-2 -right-2 flex size-6 items-center justify-center rounded-full shadow"
    >
      <X className="size-3.5" />
    </button>
  );
}
