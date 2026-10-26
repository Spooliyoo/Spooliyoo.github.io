"use client";

import { useLocalQuery, useSettings } from "@/components/providers";
import { PrintForm } from "@/components/print-form";
import { BackButton, useSearchParam, withSuspense } from "@/components/shared";
import { EmptyState, PageHeader, Spinner } from "@/components/ui";
import { getPrint } from "@/lib/db/repo";

function EditPrintPage() {
  const id = useSearchParam("id");
  const settings = useSettings();
  const { data, isLoading } = useLocalQuery(["print", id], ({ db }) => getPrint(db, id!), !!id);
  if (isLoading || !settings) return <Spinner />;
  if (!data) return <EmptyState title="Print not found" />;
  return (
    <>
      <PageHeader title={`Edit ${data.modelName}`} back={<BackButton fallback="/prints/" />} />
      <PrintForm key={data.updatedAt} settings={settings} existing={data} />
    </>
  );
}

export default withSuspense(EditPrintPage);
