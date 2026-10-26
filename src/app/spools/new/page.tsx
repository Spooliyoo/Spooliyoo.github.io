"use client";

import { useLocalQuery } from "@/components/providers";
import { EMPTY_SPOOL, SpoolForm } from "@/components/spool-form";
import { BackButton, useSearchParam, withSuspense } from "@/components/shared";
import { PageHeader, Spinner } from "@/components/ui";
import { getSpool } from "@/lib/db/repo";
import type { SpoolInput } from "@/lib/validation";
import type { Material } from "@/lib/db/schema";

function NewSpoolPage() {
  const dup = useSearchParam("duplicate");
  const { data, isLoading } = useLocalQuery(["spool", dup], ({ db }) => getSpool(db, dup!), !!dup);
  if (dup && isLoading) return <Spinner />;
  const initial: SpoolInput = data
    ? {
        spoolCode: "",
        name: data.name,
        brand: data.brand,
        material: data.material as Material,
        colourName: data.colourName,
        colourHex: data.colourHex,
        diameterMm: data.diameterMm as 1.75 | 2.85,
        price: data.price,
        netWeightG: data.netWeightG,
        tareWeightG: data.tareWeightG,
        purchaseDate: data.purchaseDate,
        notes: data.notes,
      }
    : EMPTY_SPOOL;
  return (
    <>
      <PageHeader title={data ? "Duplicate spool" : "Add spool"} back={<BackButton fallback="/spools/" />} />
      <SpoolForm key={dup ?? "new"} initial={initial} codeTaken={!!data} />
    </>
  );
}

export default withSuspense(NewSpoolPage);
