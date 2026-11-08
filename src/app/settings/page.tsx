"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import {
  Download,
  FileSpreadsheet,
  HardDrive,
  Save,
  Upload,
  ShieldCheck,
  ShieldAlert,
  ExternalLink,
} from "lucide-react";
import { useApp, useSettings, useToast, useWrite } from "@/components/providers";
import {
  InstallButton,
  requestPersistence,
  storageStatus,
  useInstall,
  type StorageStatus,
} from "@/components/pwa";
import { LocalDataNotice } from "@/components/shared";
import {
  Alert,
  Button,
  Card,
  CardHeader,
  Dialog,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
} from "@/components/ui";
import { updateSettings } from "@/lib/db/repo";
import { exportPrintsCsv, importBackup, parseBackup, type BackupPreview } from "@/lib/db/backup";
import { settingsInputSchema, type SettingsInput } from "@/lib/validation";
import { zodResolver } from "@/lib/zod-resolver";
import { downloadBlob, errorMessage, formatDate } from "@/lib/utils";
import { downloadBackupFile } from "@/lib/backup-download";
import type { Settings } from "@/lib/db/schema";

const VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "1.0.0";
const REPO_URL = process.env.NEXT_PUBLIC_REPO_URL ?? "";

export default function SettingsPage() {
  const settings = useSettings();
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Settings" />
      {settings ? <RatesForm key={settings.updatedAt} settings={settings} /> : <Spinner />}
      <BackupCard />
      <StorageCard />
      <AboutCard />
    </div>
  );
}

function RatesForm({ settings }: { settings: Settings }) {
  const write = useWrite();
  const toast = useToast();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<SettingsInput>({
    resolver: zodResolver(settingsInputSchema as unknown as z.ZodType<SettingsInput>),
    defaultValues: {
      currency: settings.currency,
      defaultPurgeG: settings.defaultPurgeG,
      electricityRate: settings.electricityRate,
      printerWatts: settings.printerWatts,
      wearRate: settings.wearRate,
      labourRate: settings.labourRate,
      bufferPct: settings.bufferPct,
      markupPct: settings.markupPct,
      lowStockG: settings.lowStockG,
      theme: settings.theme as SettingsInput["theme"],
    },
  });
  const c = settings.currency;
  const n = { valueAsNumber: true } as const;
  const numField = (name: keyof SettingsInput, label: string, hint?: string) => (
    <Field label={label} htmlFor={name} error={errors[name]?.message} hint={hint}>
      <Input
        id={name}
        type="number"
        inputMode="decimal"
        step="any"
        min={0}
        aria-invalid={!!errors[name]}
        {...register(name, n)}
      />
    </Field>
  );

  return (
    <form
      noValidate
      onSubmit={handleSubmit(async (v) => {
        await write(({ db }) => updateSettings(db, v));
        toast("Settings saved");
      })}
    >
      <Card>
        <CardHeader title="Defaults for new prints" />
        <div className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-3">
          {numField("defaultPurgeG", "Purge waste (g)", "Prime line, calibration, flushing")}
          {numField("electricityRate", `Electricity (${c}/kWh)`)}
          {numField("printerWatts", "Printer power (W)", "Average draw while printing")}
          {numField("wearRate", `Printer wear (${c}/hour)`, "Nozzles, belts, parts")}
          {numField("labourRate", `Labour (${c}/hour)`)}
          {numField("bufferPct", "Failure buffer (%)", "Covers failed prints")}
          {numField("markupPct", "Markup (%)", "Added to cost for the price")}
          {numField("lowStockG", "Low-stock warning (g)")}
          <Field
            label="Currency"
            htmlFor="currency"
            error={errors.currency?.message}
            hint="3-letter code: INR, USD, EUR…"
          >
            <Input
              id="currency"
              maxLength={3}
              autoCapitalize="characters"
              className="uppercase"
              {...register("currency")}
            />
          </Field>
          <Field label="Theme" htmlFor="theme">
            <Select id="theme" {...register("theme")}>
              <option value="system">Match device</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </Select>
          </Field>
        </div>
        <div className="flex items-center justify-between gap-2 border-t px-4 py-3">
          <p className="text-muted-foreground text-xs">
            Changes apply to new prints. Saved prints keep their own rates.
          </p>
          <Button type="submit" size="sm" disabled={isSubmitting || !isDirty}>
            <Save /> Save
          </Button>
        </div>
      </Card>
    </form>
  );
}

function BackupCard() {
  const { db, photos } = useApp();
  const write = useWrite();
  const toast = useToast();
  const settings = useSettings();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<BackupPreview | null>(null);
  const [importError, setImportError] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const stamp = () => new Date().toISOString().slice(0, 10);

  return (
    <Card id="backup">
      <CardHeader title="Backup and export" />
      <div className="flex flex-col gap-3 p-4">
        <LocalDataNotice />
        <p className="text-sm">
          Last backup:{" "}
          <b>
            {settings?.lastBackupAt
              ? formatDate(settings.lastBackupAt, { dateStyle: "medium", timeStyle: "short" })
              : "never"}
          </b>
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={!!busy}
            onClick={async () => {
              setBusy("export");
              try {
                await write((app) => downloadBackupFile(app));
                toast("Backup downloaded");
              } catch (e) {
                toast(errorMessage(e), "danger");
              } finally {
                setBusy(null);
              }
            }}
          >
            <Download /> {busy === "export" ? "Preparing…" : "Export backup"}
          </Button>
          <Button variant="outline" disabled={!!busy} onClick={() => fileRef.current?.click()}>
            <Upload /> Import backup
          </Button>
          <Button
            variant="outline"
            disabled={!!busy}
            onClick={async () => {
              const csv = await exportPrintsCsv(db);
              downloadBlob(
                new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }),
                `prints-${stamp()}.csv`,
              );
            }}
          >
            <FileSpreadsheet /> Prints CSV
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            aria-label="Backup file"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              setImportError(null);
              try {
                setPreview(parseBackup(await f.text()));
              } catch (err) {
                setImportError(errorMessage(err));
              }
            }}
          />
        </div>
        {importError && <Alert variant="danger">{importError}</Alert>}
      </div>
      <Dialog
        open={!!preview}
        onClose={() => setPreview(null)}
        title="Replace all data?"
        footer={
          <>
            <Button variant="outline" onClick={() => setPreview(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={busy === "import"}
              onClick={async () => {
                if (!preview) return;
                setBusy("import");
                try {
                  await write(({ db }) => importBackup(db, photos, preview.backup));
                  toast("Backup restored");
                  setPreview(null);
                } catch (err) {
                  setImportError(errorMessage(err));
                  setPreview(null);
                } finally {
                  setBusy(null);
                }
              }}
            >
              {busy === "import" ? "Restoring…" : "Replace my data"}
            </Button>
          </>
        }
      >
        {preview && (
          <div className="flex flex-col gap-3">
            <p>
              Backup from <b>{formatDate(preview.exportedAt, { dateStyle: "medium", timeStyle: "short" })}</b>{" "}
              contains:
            </p>
            <ul className="tabular list-disc pl-5">
              <li>{preview.counts.spools} spools</li>
              <li>{preview.counts.prints} prints</li>
              <li>{preview.counts.photos} photos</li>
              <li>{preview.counts.adjustments} weight corrections</li>
            </ul>
            <p className="text-danger">
              Everything currently in the app will be replaced. Export a backup first if unsure.
            </p>
          </div>
        )}
      </Dialog>
    </Card>
  );
}

function StorageCard() {
  const [st, setSt] = React.useState<StorageStatus | null>(null);
  const refresh = React.useCallback(() => storageStatus().then(setSt), []);
  React.useEffect(() => {
    refresh();
  }, [refresh]);
  const mb = (b?: number) => (b == null ? "—" : `${(b / 1024 / 1024).toFixed(1)} MB`);
  return (
    <Card>
      <CardHeader title="Storage" />
      <div className="flex flex-col gap-3 p-4 text-sm">
        {!st ? (
          <Spinner />
        ) : !st.supported ? (
          <p>This browser doesn&apos;t report storage details.</p>
        ) : (
          <>
            <div className="flex items-start gap-2">
              {st.persisted ? (
                <ShieldCheck className="text-success size-5" />
              ) : (
                <ShieldAlert className="text-warning size-5" />
              )}
              <div className="flex-1">
                <p className="font-medium">
                  {st.persisted ? "Persistent storage on" : "Persistent storage off"}
                </p>
                <p className="text-muted-foreground">
                  {st.persisted
                    ? "The browser won't clear your data to free space."
                    : "The browser may clear data when the device is low on space. Installing the app usually turns this on."}
                </p>
              </div>
              {!st.persisted && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    await requestPersistence();
                    refresh();
                  }}
                >
                  Request
                </Button>
              )}
            </div>
            <p className="flex items-center gap-2">
              <HardDrive className="text-muted-foreground size-4" /> Using {mb(st.usage)} of {mb(st.quota)}{" "}
              available
            </p>
          </>
        )}
      </div>
    </Card>
  );
}

function AboutCard() {
  const { installed } = useInstall();
  return (
    <Card>
      <CardHeader title="App" />
      <div className="flex flex-col gap-3 p-4 text-sm">
        {installed ? (
          <p className="text-muted-foreground">Installed on this device.</p>
        ) : (
          <InstallButton className="self-start" />
        )}
        <p className="text-muted-foreground">
          Spooliyoo v{VERSION} · Free and open source (MIT). Works offline; no account, no tracking.
        </p>
        {REPO_URL && (
          <a
            href={REPO_URL}
            className="text-primary flex items-center gap-1 self-start"
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink className="size-4" /> Source code
          </a>
        )}
      </div>
    </Card>
  );
}
