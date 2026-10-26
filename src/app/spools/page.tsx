"use client";

import * as React from "react";
import Link from "next/link";
import { Disc3, Plus, Search } from "lucide-react";
import { useLocalQuery, useSettings } from "@/components/providers";
import { listSpools } from "@/lib/db/repo";
import { MATERIALS } from "@/lib/db/schema";
import { Card, EmptyState, Input, PageHeader, Select, Spinner, buttonVariants } from "@/components/ui";
import { SpoolRow } from "@/components/shared";

type Sort = "added" | "name" | "remaining-asc" | "remaining-desc" | "recent";
type Status = "active" | "low" | "archived" | "all";

export default function SpoolsPage() {
  const { data, isLoading } = useLocalQuery(["spools", "all"], ({ db }) =>
    listSpools(db, { includeArchived: true }),
  );
  const settings = useSettings();
  const [q, setQ] = React.useState("");
  const [material, setMaterial] = React.useState("");
  const [status, setStatus] = React.useState<Status>("active");
  const [sort, setSort] = React.useState<Sort>("added");

  const low = settings?.lowStockG ?? 100;
  const items = React.useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = (data ?? []).filter((s) => {
      if (status === "archived" ? s.status !== "archived" : status !== "all" && s.status !== "active")
        return false;
      if (status === "low" && s.remainingG >= low) return false;
      if (material && s.material !== material) return false;
      if (term && ![s.name, s.spoolCode, s.brand, s.colourName].some((f) => f.toLowerCase().includes(term)))
        return false;
      return true;
    });
    const by: Record<Sort, (a: (typeof list)[number], b: (typeof list)[number]) => number> = {
      added: (a, b) => b.createdAt.localeCompare(a.createdAt),
      name: (a, b) => a.name.localeCompare(b.name),
      "remaining-asc": (a, b) => a.remainingG - b.remainingG,
      "remaining-desc": (a, b) => b.remainingG - a.remainingG,
      recent: (a, b) => (b.lastUsedAt ?? "").localeCompare(a.lastUsedAt ?? ""),
    };
    return list.sort(by[sort]);
  }, [data, q, material, status, sort, low]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Spools"
        actions={
          <Link href="/spools/new/" className={buttonVariants({ size: "sm" })}>
            <Plus /> Add spool
          </Link>
        }
      />
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            aria-label="Search spools"
            placeholder="Search name, ID, brand, colour"
            className="pl-9"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-3 gap-2 sm:flex">
          <Select aria-label="Material" value={material} onChange={(e) => setMaterial(e.target.value)}>
            <option value="">All materials</option>
            {MATERIALS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </Select>
          <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as Status)}>
            <option value="active">Active</option>
            <option value="low">Low stock</option>
            <option value="archived">Archived</option>
            <option value="all">All</option>
          </Select>
          <Select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="added">Newest</option>
            <option value="name">Name</option>
            <option value="remaining-asc">Least left</option>
            <option value="remaining-desc">Most left</option>
            <option value="recent">Recently used</option>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <Spinner />
      ) : items.length === 0 ? (
        <Card>
          <EmptyState icon={<Disc3 />} title={data?.length ? "No spools match" : "No spools yet"}>
            {!data?.length && (
              <Link href="/spools/new/" className={buttonVariants({ className: "mt-2" })}>
                <Plus /> Add spool
              </Link>
            )}
          </EmptyState>
        </Card>
      ) : (
        <Card className="divide-y overflow-hidden">
          {items.map((s) => (
            <SpoolRow key={s.id} spool={s} />
          ))}
        </Card>
      )}
    </div>
  );
}
