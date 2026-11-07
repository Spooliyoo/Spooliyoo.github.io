"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, Disc3, Plus, Printer, CloudOff } from "lucide-react";
import { useLocalQuery, useMoney } from "@/components/providers";
import { getDashboard } from "@/lib/db/repo";
import {
  Alert,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  Spinner,
  Stat,
  buttonVariants,
} from "@/components/ui";
import { LocalDataNotice, SpoolRow } from "@/components/shared";
import { PrintRow } from "@/components/print-row";
import { StorageWarning } from "@/components/storage-warning";
import { formatGrams } from "@/lib/calc";
import { parseTimestamp } from "@/lib/calc";

const BACKUP_REMINDER_DAYS = 30;

export default function DashboardPage() {
  const { data: d, isLoading } = useLocalQuery(["dashboard"], ({ db }) => getDashboard(db));
  const money = useMoney();
  const [now] = React.useState(() => Date.now());

  if (isLoading || !d) return <Spinner />;

  const lastBackup = parseTimestamp(d.settings.lastBackupAt);
  const needsBackup =
    (d.activeCount > 0 || d.recent.length > 0) &&
    (!lastBackup || now - lastBackup.getTime() > BACKUP_REMINDER_DAYS * 86_400_000);
  const monthName = new Intl.DateTimeFormat(undefined, { month: "long" }).format(new Date());

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Dashboard"
        actions={
          <>
            <Link href="/spools/new/" className={buttonVariants({ variant: "outline", size: "sm" })}>
              <Plus /> Add spool
            </Link>
            <Link href="/prints/new/" className={buttonVariants({ size: "sm" })}>
              <Printer /> Log print
            </Link>
          </>
        }
      />

      <StorageWarning />

      {needsBackup && (
        <Alert variant="info">
          <CloudOff />
          <span>
            {lastBackup
              ? `No backup in over ${BACKUP_REMINDER_DAYS} days.`
              : "You haven't made a backup yet."}{" "}
            <Link href="/settings/#backup" className="text-primary font-medium underline">
              Back up now
            </Link>
          </span>
        </Alert>
      )}

      <Card className="grid grid-cols-3 gap-4 p-4">
        <Stat label="Active spools" value={d.activeCount} />
        <Stat label="Filament in stock" value={formatGrams(d.totalStockG)} />
        <Stat label="Stock value" value={money(d.stockValue)} />
      </Card>

      <Card>
        <CardHeader title={`This month · ${monthName}`} />
        <div className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
          <Stat label="Filament used" value={formatGrams(d.month.grams)} sub={`${d.month.prints} prints`} />
          <Stat label="Cost" value={money(d.month.cost)} />
          <Stat label="Revenue" value={money(d.month.revenue)} />
          <Stat
            label="Profit"
            value={
              <span className={d.month.profit < 0 ? "text-danger" : undefined}>{money(d.month.profit)}</span>
            }
          />
        </div>
      </Card>

      {d.activeCount === 0 ? (
        <Card>
          <EmptyState icon={<Disc3 />} title="Add your first spool">
            <p>Give it any unique ID — the code on the box, a label you write, anything.</p>
            <Link href="/spools/new/" className={buttonVariants({ className: "mt-4" })}>
              <Plus /> Add spool
            </Link>
          </EmptyState>
        </Card>
      ) : (
        <Card>
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                {d.lowStock.length > 0 && <AlertTriangle className="text-warning size-4" />}
                Low stock
              </span>
            }
            action={
              <Link href="/spools/" className="text-primary text-xs">
                All spools
              </Link>
            }
          />
          {d.lowStock.length === 0 ? (
            <p className="text-muted-foreground px-4 py-4 text-sm">
              All spools are above {formatGrams(d.settings.lowStockG)}.
            </p>
          ) : (
            <div className="divide-y pt-2">
              {d.lowStock.map((s) => (
                <SpoolRow key={s.id} spool={s} />
              ))}
            </div>
          )}
        </Card>
      )}

      <Card>
        <CardHeader
          title="Recent prints"
          action={
            <Link href="/prints/" className="text-primary text-xs">
              History
            </Link>
          }
        />
        {d.recent.length === 0 ? (
          <p className="text-muted-foreground px-4 py-4 text-sm">No prints logged yet.</p>
        ) : (
          <div className="divide-y pt-2">
            {d.recent.map((p) => (
              <PrintRow key={p.id} print={p} />
            ))}
          </div>
        )}
      </Card>

      <LocalDataNotice className="px-1" />
    </div>
  );
}
