"use client";

import { useSettings } from "@/components/providers";
import { PrintForm } from "@/components/print-form";
import { BackButton, useSearchParam, withSuspense } from "@/components/shared";
import { PageHeader, Spinner } from "@/components/ui";

function NewPrintPage() {
  const settings = useSettings();
  const spool = useSearchParam("spool");
  const model = useSearchParam("model");
  return (
    <>
      <PageHeader title={model ? "Add part" : "Log print"} back={<BackButton />} />
      {settings ? (
        <PrintForm
          key={`${spool ?? ""}-${model ?? ""}`}
          settings={settings}
          presetSpoolId={spool}
          presetModelId={model}
        />
      ) : (
        <Spinner />
      )}
    </>
  );
}

export default withSuspense(NewPrintPage);
