"use client";

import { useSettings } from "@/components/providers";
import { PrintForm } from "@/components/print-form";
import { BackButton, useSearchParam, withSuspense } from "@/components/shared";
import { PageHeader, Spinner } from "@/components/ui";

function NewPrintPage() {
  const settings = useSettings();
  const spool = useSearchParam("spool");
  return (
    <>
      <PageHeader title="Log print" back={<BackButton />} />
      {settings ? <PrintForm key={spool ?? ""} settings={settings} presetSpoolId={spool} /> : <Spinner />}
    </>
  );
}

export default withSuspense(NewPrintPage);
