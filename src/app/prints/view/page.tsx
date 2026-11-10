"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil, Trash2, Copy } from "lucide-react";
import { useApp, useLocalQuery, useMoney, useToast, useWrite } from "@/components/providers";
import { BackButton, PhotoImg, useSearchParam, withSuspense } from "@/components/shared";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Dialog,
  EmptyState,
  PageHeader,
  Spinner,
  Stat,
  Swatch,
  buttonVariants,
} from "@/components/ui";
import { deletePrint, getPrint } from "@/lib/db/repo";
import { formatDuration, formatGrams } from "@/lib/calc";
import { formatDate } from "@/lib/utils";

function PrintDetailPage() {
  const id = useSearchParam("id");
  const router = useRouter();
  const write = useWrite();
  const toast = useToast();
  const money = useMoney();
  const { photos } = useApp();
  const { data: p, isLoading } = useLocalQuery(["print", id], ({ db }) => getPrint(db, id!), !!id);
  const [confirm, setConfirm] = React.useState(false);
  const [zoom, setZoom] = React.useState<string | null>(null);

  if (isLoading) return <Spinner />;
  if (!p || !id) return <EmptyState title="Print not found" />;

  const totalG = p.lines.reduce((s, l) => s + l.totalG, 0);
  const failed = p.status === "failed";

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={p.partName ? `${p.modelName} — ${p.partName}` : p.modelName}
        back={<BackButton fallback="/prints/" />}
        actions={
          <Link
            href={`/prints/edit/?id=${id}`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <Pencil /> Edit
          </Link>
        }
      />

      {p.photos.length > 0 && (
        <div className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 md:mx-0 md:px-0">
          {p.photos.map((ph) => (
            <button
              key={ph.id}
              onClick={() => setZoom(ph.id)}
              className="shrink-0 snap-start"
              aria-label="View photo"
            >
              <PhotoImg id={ph.id} alt={p.modelName} className="h-48 w-64 rounded-xl" />
            </button>
          ))}
        </div>
      )}

      {p.modelId && (
        <Link
          href={`/models/view/?id=${p.modelId}`}
          className="bg-primary-soft text-primary flex items-center justify-between rounded-2xl px-4 py-3 text-sm font-medium"
        >
          <span>
            Part <b>{p.partName}</b> of <b>{p.modelName}</b>
          </span>
          <span>All parts →</span>
        </Link>
      )}

      <Card className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
        <Stat label="Date" value={formatDate(p.printedAt)} />
        <Stat label="Print time" value={formatDuration(p.printMinutes)} />
        <Stat label="Filament" value={formatGrams(totalG)} />
        <Stat
          label="Result"
          value={failed ? <Badge variant="danger">Failed</Badge> : <Badge variant="success">Success</Badge>}
        />
      </Card>

      <Card>
        <CardHeader title="Filament used" />
        <ul className="divide-y pt-2">
          {p.lines.map((l) => (
            <li key={l.id}>
              <Link
                href={`/spools/view/?id=${l.spoolId}`}
                className="hover:bg-muted/60 flex items-center gap-3 px-4 py-3"
              >
                <Swatch hex={l.colourHex} className="size-6" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{l.spoolName}</div>
                  <div className="text-muted-foreground text-xs">
                    <span className="font-mono">{l.spoolCode}</span> · {failed ? "used" : "model"} {l.modelG}{" "}
                    g · purge {l.purgeG} g{l.extraG ? ` · extra ${l.extraG} g` : ""}
                  </div>
                </div>
                <span className="tabular text-sm font-medium">{formatGrams(l.totalG)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardHeader title="Cost and price" />
        <dl className="tabular grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 p-4 text-sm">
          <dt className="text-muted-foreground">Filament</dt>
          <dd className="text-right">{money(p.filamentCost)}</dd>
          <dt className="text-muted-foreground">
            Electricity ({p.printerWatts} W @ {money(p.electricityRate)}/kWh)
          </dt>
          <dd className="text-right">{money(p.electricityCost)}</dd>
          <dt className="text-muted-foreground">Printer wear ({money(p.wearRate)}/h)</dt>
          <dd className="text-right">{money(p.wearCost)}</dd>
          <dt className="text-muted-foreground">
            Labour ({p.labourMinutes} min @ {money(p.labourRate)}/h)
          </dt>
          <dd className="text-right">{money(p.labourCost)}</dd>
          <dt className="text-muted-foreground">Failure buffer ({p.bufferPct}%)</dt>
          <dd className="text-right">{money(p.bufferCost)}</dd>
          <dt className="border-t pt-1.5 font-medium">Cost</dt>
          <dd className="border-t pt-1.5 text-right font-medium">{money(p.totalCost)}</dd>
          <dt className="text-muted-foreground">
            Selling price {p.priceOverridden ? "(set manually)" : failed ? "" : `(+${p.markupPct}%)`}
          </dt>
          <dd className="text-right">{money(p.sellingPrice)}</dd>
          <dt className="font-medium">{p.profit < 0 ? "Loss" : "Profit"}</dt>
          <dd className={`text-right font-semibold ${p.profit < 0 ? "text-danger" : "text-success"}`}>
            {money(p.profit)}
          </dd>
        </dl>
      </Card>

      {p.notes && (
        <Card className="p-4">
          <p className="text-sm whitespace-pre-wrap">{p.notes}</p>
        </Card>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" className="text-danger" onClick={() => setConfirm(true)}>
          <Trash2 /> Delete print
        </Button>
        <Link
          href={
            p.modelId ? `/prints/new/?model=${p.modelId}` : `/prints/new/?spool=${p.lines[0]?.spoolId ?? ""}`
          }
          className={buttonVariants({ variant: "ghost" })}
        >
          <Copy /> {p.modelId ? "Add another part" : "Log another"}
        </Link>
      </div>

      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Delete this print?"
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                await write(({ db }) => deletePrint(db, id, photos));
                toast("Print deleted — filament returned to its spools");
                router.replace("/prints/");
              }}
            >
              Delete
            </Button>
          </>
        }
      >
        The {formatGrams(totalG)} it used will be added back to{" "}
        {p.lines.length > 1 ? "its spools" : "the spool"}.
      </Dialog>

      <Dialog
        open={!!zoom}
        onClose={() => setZoom(null)}
        title={p.modelName}
        footer={<Button onClick={() => setZoom(null)}>Close</Button>}
      >
        {zoom && (
          <PhotoImg id={zoom} alt={p.modelName} className="max-h-[70vh] w-full rounded-lg object-contain" />
        )}
      </Dialog>
    </div>
  );
}

export default withSuspense(PrintDetailPage);
