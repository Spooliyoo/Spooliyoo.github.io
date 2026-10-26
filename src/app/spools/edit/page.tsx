"use client";

import { useLocalQuery } from "@/components/providers";
import { SpoolForm } from "@/components/spool-form";
import { BackButton, useSearchParam, withSuspense } from "@/components/shared";
import { EmptyState, PageHeader, Spinner } from "@/components/ui";
import { getSpool } from "@/lib/db/repo";
import type { Material } from "@/lib/db/schema";

function EditSpoolPage() {
  const id = useSearchParam("id");
  const { data, isLoading } = useLocalQuery(["spool", id], ({ db }) => getSpool(db, id!), !!id);
  if (isLoading) return <Spinner />;
  if (!data || !id) return <EmptyState title="Spool not found" />;
  return (
    <>
      <PageHeader title={`Edit ${data.name}`} back={<BackButton fallback="/spools/" />} />
      <SpoolForm
        key={data.updatedAt}
        spoolId={id}
        initial={{
          spoolCode: data.spoolCode,
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
        }}
      />
    </>
  );
}

export default withSuspense(EditSpoolPage);
