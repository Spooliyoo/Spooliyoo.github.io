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
  durationFromParts,
  formatDuration,
  formatGrams,
  lineTotalG,
  parseTimestamp,
  type Rates,
} from "@/lib/calc";
import { printInputSchema, type PrintInput } from "@/lib/validation";
import { compressPhoto } from "@/lib/photos";
import { cn, errorMessage, num, toLocalInput } from "@/lib/utils";

interface LineState {
  key: string;
  /** Which part this spool belongs to (null for single-part prints). */
  partKey: string | null;
  spoolId: string;
  modelG: string;
  purgeG: string;
  extraG: string;
}

interface PartState {
  key: string;
  name: string;
  hours: string;
  mins: string;
}

const TIME_ERROR = "Enter hours and/or minutes (minutes 0–59)";

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
  // Separate hour and minute boxes: iPhone number keypads have no ":" key.
  const [hours, setHours] = React.useState(existing ? String(Math.floor(existing.printMinutes / 60)) : "");
  const [mins, setMins] = React.useState(existing ? String(existing.printMinutes % 60) : "");
  // Parts: empty = single-part print. Each part has its own name, time and spools.
  const [initialParts] = React.useState(() =>
    (existing?.parts ?? []).map((p) => ({
      id: p.id,
      key: newKey(),
      name: p.name,
      hours: String(Math.floor(p.printMinutes / 60)),
      mins: String(p.printMinutes % 60),
    })),
  );
  const [parts, setParts] = React.useState<PartState[]>(() =>
    initialParts.map(({ key, name, hours, mins }) => ({ key, name, hours, mins })),
  );
  const multiPart = parts.length > 0;
  const [status, setStatus] = React.useState<"success" | "failed">(
    (existing?.status as "success" | "failed") ?? "success",
  );
  const [labour, setLabour] = React.useState(existing?.labourMinutes ? String(existing.labourMinutes) : "");
  const [notes, setNotes] = React.useState(existing?.notes ?? "");
  const [lines, setLines] = React.useState<LineState[]>(() =>
    existing
      ? existing.lines.map((l) => ({
          key: newKey(),
          partKey: initialParts.find((p) => p.id === l.partId)?.key ?? null,
          spoolId: l.spoolId,
          modelG: String(l.modelG),
          purgeG: String(l.purgeG),
          extraG: l.extraG ? String(l.extraG) : "",
        }))
      : [
          {
            key: newKey(),
            partKey: null,
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
  const previousUse = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const l of existing?.lines ?? []) m.set(l.spoolId, (m.get(l.spoolId) ?? 0) + l.totalG);
    return m;
  }, [existing]);
  const selectable = (spools ?? []).filter(
    (s) => s.status === "active" || lines.some((l) => l.spoolId === s.id),
  );

  const failed = status === "failed";
  const singleMinutes = durationFromParts(hours, mins);
  const partMinutes = parts.map((p) => durationFromParts(p.hours, p.mins));
  const totalMinutes = multiPart
    ? partMinutes.reduce((s, m) => s + (Number.isFinite(m) ? m : 0), 0)
    : Number.isFinite(singleMinutes)
      ? singleMinutes
      : 0;
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
    printMinutes: totalMinutes,
    labourMinutes: num(labour, 0),
    rates: rateNums,
    failed,
    priceOverride: override.trim() === "" ? null : Number(override),
  });

  // FR-WN-1: warn when a spool is asked for more than it has (adding up every part that uses it).
  const needBySpool = new Map<string, number>();
  for (const l of lineNums)
    if (l.spoolId) needBySpool.set(l.spoolId, (needBySpool.get(l.spoolId) ?? 0) + lineTotalG(l));
  const shortages = [...needBySpool.entries()]
    .map(([id, need]) => {
      const s = spoolById.get(id);
      if (!s) return null;
      const available = s.remainingG + (previousUse.get(id) ?? 0);
      return need > available ? { spool: s, need, available } : null;
    })
    .filter((x): x is NonNullable<typeof x> => !!x);

  const updateLine = (key: string, patch: Partial<LineState>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const updatePart = (key: string, patch: Partial<PartState>) =>
    setParts((ps) => ps.map((p) => (p.key === key ? { ...p, ...patch } : p)));

  function setMultiPart(on: boolean) {
    if (on) {
      // The current spools and time become Part 1.
      const first: PartState = { key: newKey(), name: "", hours, mins };
      setParts([first]);
      setLines((ls) => ls.map((l) => ({ ...l, partKey: first.key })));
    } else if (parts.length <= 1) {
      if (parts[0]) {
        setHours(parts[0].hours);
        setMins(parts[0].mins);
      }
      setParts([]);
      setLines((ls) => ls.map((l) => ({ ...l, partKey: null })));
    }
  }

  function addPart() {
    const p: PartState = { key: newKey(), name: "", hours: "", mins: "" };
    setParts((ps) => [...ps, p]);
    setLines((ls) => [
      ...ls,
      {
        key: newKey(),
        partKey: p.key,
        spoolId: ls.at(-1)?.spoolId ?? "",
        modelG: "",
        purgeG: "0",
        extraG: "",
      },
    ]);
  }

  function removePart(key: string) {
    setParts((ps) => ps.filter((p) => p.key !== key));
    setLines((ls) => ls.filter((l) => l.partKey !== key));
  }

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
      // For multi-part prints the server adds up the parts' times.
      printMinutes: multiPart
        ? Math.max(1, totalMinutes)
        : Number.isFinite(singleMinutes)
          ? singleMinutes
          : NaN,
      status,
      labourMinutes: num(labour, 0),
      notes,
      parts: parts.map((p, i) => ({ name: p.name, printMinutes: partMinutes[i] ?? NaN })),
      lines: lines.map((l, i) => ({
        ...lineNums[i]!,
        partIndex: l.partKey ? parts.findIndex((p) => p.key === l.partKey) : null,
      })),
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
      if (!multiPart && (errs.printMinutes || !Number.isFinite(singleMinutes)))
        errs.printMinutes = TIME_ERROR;
      partMinutes.forEach((m, i) => {
        if (!Number.isFinite(m) || errs[`parts.${i}.printMinutes`])
          errs[`parts.${i}.printMinutes`] = TIME_ERROR;
      });
      setErrors(errs);
      const first = Object.keys(errs)[0] ?? "";
      const focusId =
        first === "printMinutes"
          ? "printHours"
          : /^parts\.\d+\.printMinutes$/.test(first)
            ? first.replace("printMinutes", "hours")
            : first;
      document.getElementById(focusId)?.focus();
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

  /** One spool row. `i` is the line's position in the whole print (used for ids and errors). */
  const renderLine = (
    l: LineState,
    i: number,
    numberInGroup: number,
    groupSize: number,
    canRemove: boolean,
  ) => {
    const s = spoolById.get(l.spoolId);
    const lineN = lineNums[i]!;
    return (
      <div key={l.key} className="flex flex-col gap-3 rounded-2xl border p-3">
        <div className="flex items-end gap-2">
          <Field
            label={groupSize > 1 ? `Spool ${numberInGroup}` : "Spool"}
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
                    disabled={lines.some(
                      (x) => x.key !== l.key && x.partKey === l.partKey && x.spoolId === sp.id,
                    )}
                  >
                    {sp.spoolCode} — {sp.name} ({formatGrams(sp.remainingG + (previousUse.get(sp.id) ?? 0))}{" "}
                    left)
                  </option>
                ))}
              </Select>
            </div>
          </Field>
          {canRemove && (
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Remove spool ${numberInGroup}`}
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
  };

  const shortageAlerts = shortages.map((x) => (
    <Alert key={x.spool.id}>
      <AlertTriangle />
      <span>
        <b>{x.spool.spoolCode}</b> has {formatGrams(x.available)} left but this print needs{" "}
        {formatGrams(x.need)}. You can still save; correct the spool&apos;s weight on a scale afterwards.
      </span>
    </Alert>
  ));

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
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input
            type="checkbox"
            className="accent-primary size-4"
            checked={multiPart}
            disabled={parts.length > 1}
            onChange={(e) => setMultiPart(e.target.checked)}
          />
          This model has several parts printed separately
          {parts.length > 1 && (
            <span className="text-muted-foreground text-xs">(remove parts to untick)</span>
          )}
        </label>
        {!multiPart && (
          <TimeInputs
            idPrefix="print"
            hours={hours}
            mins={mins}
            onHours={setHours}
            onMins={setMins}
            error={errors.printMinutes}
          />
        )}
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
                  "has-[:focus-visible]:ring-ring flex h-10 cursor-pointer items-center justify-center rounded-full border text-sm has-[:focus-visible]:ring-2",
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

      {spools && spools.filter((s) => s.status === "active").length === 0 && !existing && (
        <Alert>
          <AlertTriangle /> Add a spool first — prints are deducted from spools.
        </Alert>
      )}

      {!multiPart ? (
        <Card>
          <CardHeader title="Filament" />
          <div className="flex flex-col gap-3 p-4">
            {errors.lines && <p className="text-danger text-xs">{errors.lines}</p>}
            {lines.map((l, i) => renderLine(l, i, i + 1, lines.length, lines.length > 1))}
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() =>
                setLines((ls) => [
                  ...ls,
                  { key: newKey(), partKey: null, spoolId: "", modelG: "", purgeG: "0", extraG: "" },
                ])
              }
            >
              <Plus /> Add another spool
            </Button>
            {lines.length > 1 && (
              <p className="text-muted-foreground text-xs">
                Purge starts on the first spool. Move some to other spools if the colour changes used them.
              </p>
            )}
            {shortageAlerts}
          </div>
        </Card>
      ) : (
        <>
          {parts.map((p, pi) => {
            const partLines = lines.map((l, i) => ({ l, i })).filter(({ l }) => l.partKey === p.key);
            return (
              <Card key={p.key}>
                <CardHeader
                  title={`Part ${pi + 1}${p.name.trim() ? ` · ${p.name.trim()}` : ""}`}
                  action={
                    parts.length > 1 ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-danger"
                        onClick={() => removePart(p.key)}
                        aria-label={`Remove part ${pi + 1}`}
                      >
                        <Trash2 /> Remove part
                      </Button>
                    ) : undefined
                  }
                />
                <div className="flex flex-col gap-3 p-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field
                      label="Part name"
                      htmlFor={`parts.${pi}.name`}
                      error={errors[`parts.${pi}.name`]}
                      hint="e.g. Head, Body, Base"
                    >
                      <Input
                        id={`parts.${pi}.name`}
                        value={p.name}
                        onChange={(e) => updatePart(p.key, { name: e.target.value })}
                        aria-invalid={!!errors[`parts.${pi}.name`]}
                      />
                    </Field>
                    <TimeInputs
                      idPrefix={`parts.${pi}.`}
                      hours={p.hours}
                      mins={p.mins}
                      onHours={(v) => updatePart(p.key, { hours: v })}
                      onMins={(v) => updatePart(p.key, { mins: v })}
                      error={errors[`parts.${pi}.printMinutes`]}
                    />
                  </div>
                  {partLines.map(({ l, i }, n) =>
                    renderLine(l, i, n + 1, partLines.length, partLines.length > 1),
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="self-start"
                    onClick={() =>
                      setLines((ls) => [
                        ...ls,
                        { key: newKey(), partKey: p.key, spoolId: "", modelG: "", purgeG: "0", extraG: "" },
                      ])
                    }
                  >
                    <Plus /> Add spool to this part
                  </Button>
                </div>
              </Card>
            );
          })}
          <div className="flex flex-col gap-3">
            <Button variant="outline" className="self-start" onClick={addPart}>
              <Plus /> Add another part
            </Button>
            <p className="tabular text-muted-foreground text-sm">
              {parts.length} parts · total {formatDuration(totalMinutes)} ·{" "}
              {formatGrams(lineNums.reduce((s, l) => s + lineTotalG(l), 0))}
            </p>
            {errors.lines && <p className="text-danger text-xs">{errors.lines}</p>}
            {shortageAlerts}
          </div>
        </>
      )}

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

      <div className="sticky bottom-[calc(6rem+env(safe-area-inset-bottom))] z-10 flex justify-end gap-2 md:bottom-8">
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

/** Hours + minutes boxes (iPhone number keypads have no ":" key). */
function TimeInputs({
  idPrefix,
  hours,
  mins,
  onHours,
  onMins,
  error,
}: {
  idPrefix: string;
  hours: string;
  mins: string;
  onHours: (v: string) => void;
  onMins: (v: string) => void;
  error?: string;
}) {
  const hoursId = idPrefix === "print" ? "printHours" : `${idPrefix}hours`;
  const minsId = idPrefix === "print" ? "printMins" : `${idPrefix}mins`;
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-sm font-medium">Print time</legend>
      <div className="grid grid-cols-2 gap-2">
        <div className="relative">
          <Input
            id={hoursId}
            aria-label="Hours"
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            placeholder="0"
            className="pr-10"
            value={hours}
            onChange={(e) => onHours(e.target.value)}
            aria-invalid={!!error}
          />
          <span className="text-muted-foreground pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm">
            h
          </span>
        </div>
        <div className="relative">
          <Input
            id={minsId}
            aria-label="Minutes"
            type="number"
            inputMode="numeric"
            min={0}
            max={59}
            step={1}
            placeholder="0"
            className="pr-12"
            value={mins}
            onChange={(e) => onMins(e.target.value)}
            aria-invalid={!!error}
          />
          <span className="text-muted-foreground pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm">
            min
          </span>
        </div>
      </div>
      {error ? (
        <p className="text-danger text-xs" role="alert">
          {error}
        </p>
      ) : (
        <p className="text-muted-foreground text-xs">From your slicer</p>
      )}
    </fieldset>
  );
}
