"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/ui";

/** Old multi-part model pages now live inside each print; send old links to the Prints list. */
export default function OldModelPage() {
  const router = useRouter();
  React.useEffect(() => {
    router.replace("/prints/");
  }, [router]);
  return <Spinner />;
}
