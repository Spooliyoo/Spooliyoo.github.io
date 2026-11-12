"use client";

import * as React from "react";
import Link from "next/link";
import { History, RotateCcw, Trash2 } from "lucide-react";
import { useApp, useLocalQuery, useToast, useWrite } from "@/components/providers";
import { PrintRow } from "@/components/print-row";
import { Button, Card, CardHeader, Dialog, EmptyState, PageHeader, Spinner } from "@/components/ui";
import {
  listDeletedPrints,
  listPrints,
  purgePrint,
  restorePrint,
  RECENTLY_DELETED_DAYS,
  type DeletedPrint,
} from "@/lib/db/repo";
import { formatGrams } from "@/lib/calc";
import { errorMessage, formatDate } from "@/lib/utils";

const RECENT_COUNT = 5;

export default function HistoryPage() {
  const { data: recent, isLoading } = useLocalQuery(["prints", "recent"], ({ db }) =>
    listPrints(db, { limit: RECENT_COUNT }),
  );
  const { data: deleted } = useLocalQuery(["prints", "deleted"], ({ db }) => listDeletedPrints(db));
  const { photos } = useApp();
  const write = useWrite();
  const toast = useToast();
  const [purging, setPurging] = React.useState<DeletedPrint | null>(null);

  const [now] = React.useState(() => Date.now());
  const daysLeft = (deletedAt: string) =>
    Math.max(
      0,
      RECENTLY_DELETED_DAYS - Math.floor((now - new Date(deletedAt).getTime()) / 86_400_000),
    );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="History" />

      <Card>
        <CardHeader
          title={`Last ${RECENT_COUNT} prints`}
          action={
            <Link href="/prints/" className="text-primary text-xs">
              All prints
            </Link>
          }
        />
        {isLoading ? (
          <div className="p-5">
            <Spinner />
          </div>
        ) : !recent?.length ? (
          <EmptyState icon={<History />} title="No prints yet" />
        ) : (
          <div className="divide-y pt-2">
            {recent.map((p) => (
              <PrintRow key={p.id} print={p} />
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Recently deleted" />
        {!deleted?.length ? (
          <p className="text-muted-foreground px-5 py-4 text-sm">
            Nothing here. Deleted prints stay here for {RECENTLY_DELETED_DAYS} days so you can restore them.
          </p>
        ) : (
          <ul className="divide-y pt-2">
            {deleted.map((d) => (
              <li key={d.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{d.modelName}</div>
                  <div className="text-muted-foreground text-xs">
                    Printed {formatDate(d.printedAt)} · {formatGrams(d.totalG)}
                    {d.partCount ? ` · ${d.partCount} parts` : ""} · deleted {formatDate(d.deletedAt)} ·{" "}
                    {daysLeft(d.deletedAt)} days left
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    try {
                      await write(({ db }) => restorePrint(db, d.id));
                      toast("Print restored");
                    } catch (e) {
                      toast(errorMessage(e), "danger");
                    }
                  }}
                >
                  <RotateCcw /> Restore
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="text-danger"
                  aria-label={`Delete ${d.modelName} forever`}
                  onClick={() => setPurging(d)}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Dialog
        open={!!purging}
        onClose={() => setPurging(null)}
        title="Delete forever?"
        footer={
          <>
            <Button variant="outline" onClick={() => setPurging(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                if (!purging) return;
                await write(({ db }) => purgePrint(db, purging.id, photos));
                setPurging(null);
                toast("Deleted forever");
              }}
            >
              Delete forever
            </Button>
          </>
        }
      >
        <b>{purging?.modelName}</b> and its photos will be removed permanently. This can&apos;t be undone.
      </Dialog>
    </div>
  );
}
