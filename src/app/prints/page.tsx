"use client";

import * as React from "react";
import Link from "next/link";
import { Box, Plus, Search, SlidersHorizontal } from "lucide-react";
import { useLocalQuery } from "@/components/providers";
import { listPrints, listSpools, type PrintFilters } from "@/lib/db/repo";
import { MATERIALS } from "@/lib/db/schema";
import { PrintRow } from "@/components/print-row";
import {
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
  buttonVariants,
} from "@/components/ui";
import { localDateToIso } from "@/lib/utils";

export default function PrintsPage() {
  const [q, setQ] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [spoolId, setSpoolId] = React.useState("");
  const [material, setMaterial] = React.useState("");
  const [status, setStatus] = React.useState<"" | "success" | "failed">("");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [showFilters, setShowFilters] = React.useState(false);

  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 200);
    return () => clearTimeout(t);
  }, [q]);

  const filters: PrintFilters = {
    search: debounced,
    spoolId,
    material,
    status,
    from: from ? localDateToIso(from) : undefined,
    to: to ? localDateToIso(to, 1) : undefined,
  };
  const { data, isLoading } = useLocalQuery(["prints", filters], ({ db }) => listPrints(db, filters));
  const { data: spools } = useLocalQuery(["spools", "all"], ({ db }) =>
    listSpools(db, { includeArchived: true }),
  );
  const active = [spoolId, material, status, from, to].filter(Boolean).length;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Prints"
        actions={
          <Link href="/prints/new/" className={buttonVariants({ size: "sm" })}>
            <Plus /> Log print
          </Link>
        }
      />
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            aria-label="Search by model name"
            placeholder="Search model name"
            className="pl-9"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Button variant="outline" aria-expanded={showFilters} onClick={() => setShowFilters((s) => !s)}>
          <SlidersHorizontal /> Filters{active ? ` (${active})` : ""}
        </Button>
      </div>
      {showFilters && (
        <Card className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3">
          <Field label="Spool" htmlFor="f-spool">
            <Select id="f-spool" value={spoolId} onChange={(e) => setSpoolId(e.target.value)}>
              <option value="">Any</option>
              {spools?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.spoolCode} — {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Material" htmlFor="f-mat">
            <Select id="f-mat" value={material} onChange={(e) => setMaterial(e.target.value)}>
              <option value="">Any</option>
              {MATERIALS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </Select>
          </Field>
          <Field label="Result" htmlFor="f-status">
            <Select id="f-status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
              <option value="">Any</option>
              <option value="success">Success</option>
              <option value="failed">Failed</option>
            </Select>
          </Field>
          <Field label="From" htmlFor="f-from">
            <Input id="f-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To" htmlFor="f-to">
            <Input id="f-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <div className="flex items-end">
            <Button
              variant="ghost"
              onClick={() => {
                setSpoolId("");
                setMaterial("");
                setStatus("");
                setFrom("");
                setTo("");
              }}
            >
              Clear filters
            </Button>
          </div>
        </Card>
      )}
      {isLoading ? (
        <Spinner />
      ) : !data?.length ? (
        <Card>
          <EmptyState icon={<Box />} title={debounced || active ? "No prints match" : "No prints yet"} />
        </Card>
      ) : (
        <Card className="divide-y overflow-hidden">
          {data.map((p) => (
            <PrintRow key={p.id} print={p} />
          ))}
        </Card>
      )}
    </div>
  );
}
