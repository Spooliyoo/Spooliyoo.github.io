"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Copy, Pencil, Printer, Scale, Trash2, AlertTriangle } from "lucide-react";
import { useLocalQuery, useMoney, useSettings, useToast, useWrite } from "@/components/providers";
import { BackButton, StockBadge, spoolTone, useSearchParam, withSuspense } from "@/components/shared";
import {
  Alert,
  Button,
  Card,
  CardHeader,
  Dialog,
  EmptyState,
  Field,
  Input,
  PageHeader,
  ProgressBar,
  Spinner,
  Stat,
  Swatch,
  buttonVariants,
} from "@/components/ui";
import { correctSpoolWeight, deleteSpool, getSpool, setSpoolStatus, spoolHistory } from "@/lib/db/repo";
import { formatGrams, round2 } from "@/lib/calc";
import { errorMessage, formatDate } from "@/lib/utils";

function SpoolDetailPage() {
  const id = useSearchParam("id");
  const router = useRouter();
  const write = useWrite();
  const toast = useToast();
  const money = useMoney();
  const settings = useSettings();
  const { data: s, isLoading } = useLocalQuery(["spool", id], ({ db }) => getSpool(db, id!), !!id);
  const { data: history } = useLocalQuery(["spool-history", id], ({ db }) => spoolHistory(db, id!), !!id);
  const [weighOpen, setWeighOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);

  if (isLoading) return <Spinner />;
  if (!s || !id) return <EmptyState title="Spool not found" />;

  const tone = spoolTone(s, settings?.lowStockG ?? 100);
  const archived = s.status === "archived";

  const toggleArchive = async () => {
    await write(({ db }) => setSpoolStatus(db, id, archived ? "active" : "archived"));
    toast(archived ? "Spool restored" : "Spool archived");
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={s.name}
        back={<BackButton fallback="/spools/" />}
        actions={
          <Link
            href={`/spools/edit/?id=${id}`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <Pencil /> Edit
          </Link>
        }
      />

      {s.remainingG < 0 && (
        <Alert variant="danger">
          <AlertTriangle />
          <span>
            Logged usage is more than this spool holds. Put the spool on a scale and{" "}
            <button className="font-medium underline" onClick={() => setWeighOpen(true)}>
              correct its weight
            </button>
            .
          </span>
        </Alert>
      )}

      <Card className="flex flex-col gap-4 p-4">
        <div className="flex items-center gap-3">
          <Swatch hex={s.colourHex} className="size-12" />
          <div className="min-w-0 flex-1">
            <div className="font-mono text-sm">{s.spoolCode}</div>
            <div className="text-muted-foreground text-sm">
              {[s.material, s.brand, s.colourName, `${s.diameterMm} mm`].filter(Boolean).join(" · ")}
            </div>
          </div>
          <StockBadge spool={s} />
        </div>
        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <span className={`tabular text-3xl font-semibold ${s.remainingG < 0 ? "text-danger" : ""}`}>
              {formatGrams(s.remainingG)}
            </span>
            <span className="tabular text-muted-foreground text-sm">
              {Math.round(s.pctLeft)}% of {formatGrams(s.netWeightG)}
            </span>
          </div>
          <ProgressBar value={s.pctLeft} tone={tone} />
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Used" value={formatGrams(s.usedG)} sub={`${s.printCount} prints`} />
          <Stat label="Cost per gram" value={money(round2(s.costPerG))} />
          <Stat label="Value left" value={money(Math.max(0, s.remainingG) * s.costPerG)} />
          <Stat
            label="Bought"
            value={s.purchaseDate ? formatDate(s.purchaseDate) : "—"}
            sub={money(s.price)}
          />
        </div>
        {s.notes && <p className="text-muted-foreground text-sm whitespace-pre-wrap">{s.notes}</p>}
        <div className="flex flex-wrap gap-2">
          {!archived && (
            <Link href={`/prints/new/?spool=${id}`} className={buttonVariants({ size: "sm" })}>
              <Printer /> Log print
            </Link>
          )}
          <Button size="sm" variant="outline" onClick={() => setWeighOpen(true)}>
            <Scale /> Correct weight
          </Button>
          <Link
            href={`/spools/new/?duplicate=${id}`}
            className={buttonVariants({ size: "sm", variant: "outline" })}
          >
            <Copy /> Duplicate
          </Link>
          <Button size="sm" variant="outline" onClick={toggleArchive}>
            {archived ? (
              <>
                <ArchiveRestore /> Restore
              </>
            ) : (
              <>
                <Archive /> Archive
              </>
            )}
          </Button>
          {s.printCount === 0 && (
            <Button size="sm" variant="ghost" className="text-danger" onClick={() => setDeleteOpen(true)}>
              <Trash2 /> Delete
            </Button>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Usage history" />
        {!history?.length ? (
          <p className="text-muted-foreground px-4 py-4 text-sm">Nothing logged on this spool yet.</p>
        ) : (
          <ul className="divide-y pt-2">
            {history.map((h) =>
              h.kind === "print" ? (
                <li key={`p-${h.printId}`}>
                  <Link
                    href={`/prints/view/?id=${h.printId}`}
                    className="hover:bg-muted/60 flex items-center gap-3 px-4 py-3"
                  >
                    <Printer className="text-muted-foreground size-4 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {h.modelName} {h.status === "failed" && <span className="text-danger">(failed)</span>}
                      </div>
                      <div className="text-muted-foreground text-xs">
                        {formatDate(h.at)} · model {h.modelG} g · purge {h.purgeG} g
                        {h.extraG ? ` · extra ${h.extraG} g` : ""}
                      </div>
                    </div>
                    <span className="tabular text-sm font-medium">−{formatGrams(h.totalG)}</span>
                  </Link>
                </li>
              ) : (
                <li key={`a-${h.id}`} className="flex items-center gap-3 px-4 py-3">
                  <Scale className="text-muted-foreground size-4 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">Weight correction</div>
                    <div className="text-muted-foreground text-xs">
                      {formatDate(h.at)} · scale read {formatGrams(h.measuredGrossG)}
                      {h.note && ` · ${h.note}`}
                    </div>
                  </div>
                  <span className="tabular text-sm font-medium">
                    {h.deltaG >= 0 ? "+" : "−"}
                    {formatGrams(Math.abs(h.deltaG))}
                  </span>
                </li>
              ),
            )}
          </ul>
        )}
      </Card>

      <WeighDialog
        open={weighOpen}
        onClose={() => setWeighOpen(false)}
        tare={s.tareWeightG}
        remaining={s.remainingG}
        onSave={async (gross, note) => {
          const r = await write(({ db }) => correctSpoolWeight(db, id, gross, note));
          toast(`Remaining set to ${formatGrams(r.remainingAfterG)}`);
          setWeighOpen(false);
        }}
      />

      <Dialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete this spool?"
        footer={
          <>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                try {
                  await write(({ db }) => deleteSpool(db, id));
                  toast("Spool deleted");
                  router.replace("/spools/");
                } catch (e) {
                  toast(errorMessage(e), "danger");
                }
              }}
            >
              Delete
            </Button>
          </>
        }
      >
        It has no prints logged, so it will be removed completely.
      </Dialog>
    </div>
  );
}

function WeighDialog({
  open,
  onClose,
  tare,
  remaining,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  tare: number;
  remaining: number;
  onSave: (gross: number, note: string) => Promise<void>;
}) {
  const [gross, setGross] = React.useState("");
  const [note, setNote] = React.useState("");
  const [err, setErr] = React.useState<string | null>(null);
  const g = Number(gross);
  const valid = gross.trim() !== "" && Number.isFinite(g) && g >= 0;
  const after = valid ? round2(g - tare) : null;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Correct weight"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!valid}
            onClick={async () => {
              try {
                await onSave(g, note);
                setGross("");
                setNote("");
                setErr(null);
              } catch (e) {
                setErr(errorMessage(e));
              }
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-muted-foreground">
          Weigh the spool with its filament. Empty-spool weight is {formatGrams(tare)}.
        </p>
        <Field label="Scale reading (g)" htmlFor="gross">
          <Input
            id="gross"
            type="number"
            inputMode="decimal"
            step="any"
            min={0}
            autoFocus
            value={gross}
            onChange={(e) => setGross(e.target.value)}
          />
        </Field>
        <Field label="Note (optional)" htmlFor="weigh-note">
          <Input id="weigh-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {after != null && (
          <p className="tabular">
            Remaining: {formatGrams(remaining)} → <b>{formatGrams(after)}</b> (
            {after - remaining >= 0 ? "+" : "−"}
            {formatGrams(Math.abs(round2(after - remaining)))})
          </p>
        )}
        {err && <p className="text-danger">{err}</p>}
      </div>
    </Dialog>
  );
}

export default withSuspense(SpoolDetailPage);
