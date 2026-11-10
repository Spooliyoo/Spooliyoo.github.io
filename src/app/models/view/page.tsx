"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useLocalQuery, useMoney, useToast, useWrite } from "@/components/providers";
import { BackButton, useSearchParam, withSuspense } from "@/components/shared";
import { PrintRow } from "@/components/print-row";
import {
  Button,
  Card,
  CardHeader,
  Dialog,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Spinner,
  Stat,
  buttonVariants,
} from "@/components/ui";
import { deleteModel, getModel, renameModel } from "@/lib/db/repo";
import { formatDuration, formatGrams } from "@/lib/calc";
import { errorMessage } from "@/lib/utils";

function ModelPage() {
  const id = useSearchParam("id");
  const router = useRouter();
  const write = useWrite();
  const toast = useToast();
  const money = useMoney();
  const { data: m, isLoading } = useLocalQuery(["model", id], ({ db }) => getModel(db, id!), !!id);
  const [renaming, setRenaming] = React.useState(false);
  const [name, setName] = React.useState("");

  if (isLoading) return <Spinner />;
  if (!m || !id) return <EmptyState title="Model not found" />;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={m.name}
        back={<BackButton fallback="/prints/" />}
        actions={
          <Link href={`/prints/new/?model=${id}`} className={buttonVariants({ size: "sm" })}>
            <Plus /> Add part
          </Link>
        }
      />

      <Card className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
        <Stat
          label="Parts"
          value={m.parts.length}
          sub={m.totals.failed ? `${m.totals.failed} failed` : undefined}
        />
        <Stat label="Filament" value={formatGrams(m.totals.grams)} />
        <Stat label="Print time" value={formatDuration(m.totals.minutes)} />
        <Stat label="Total cost" value={money(m.totals.cost)} />
        <Stat label="Total price" value={money(m.totals.price)} />
        <Stat
          label={m.totals.profit < 0 ? "Loss" : "Profit"}
          value={
            <span className={m.totals.profit < 0 ? "text-danger" : "text-success"}>
              {money(m.totals.profit)}
            </span>
          }
        />
      </Card>

      <Card>
        <CardHeader title="Parts" />
        {m.parts.length === 0 ? (
          <p className="text-muted-foreground px-5 py-4 text-sm">No parts logged yet.</p>
        ) : (
          <div className="divide-y pt-2">
            {m.parts.map((p) => (
              <PrintRow key={p.id} print={p} />
            ))}
          </div>
        )}
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="ghost"
          onClick={() => {
            setName(m.name);
            setRenaming(true);
          }}
        >
          <Pencil /> Rename model
        </Button>
        {m.parts.length === 0 && (
          <Button
            variant="ghost"
            className="text-danger"
            onClick={async () => {
              try {
                await write(({ db }) => deleteModel(db, id));
                toast("Model deleted");
                router.replace("/prints/");
              } catch (e) {
                toast(errorMessage(e), "danger");
              }
            }}
          >
            <Trash2 /> Delete model
          </Button>
        )}
      </div>

      <Dialog
        open={renaming}
        onClose={() => setRenaming(false)}
        title="Rename model"
        footer={
          <>
            <Button variant="outline" onClick={() => setRenaming(false)}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                try {
                  await write(({ db }) => renameModel(db, id, name));
                  setRenaming(false);
                  toast("Model renamed");
                } catch (e) {
                  toast(errorMessage(e), "danger");
                }
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <Field label="Model name" htmlFor="model-name">
          <Input id="model-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
      </Dialog>
    </div>
  );
}

export default withSuspense(ModelPage);
