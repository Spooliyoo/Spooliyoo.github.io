"use client";

import * as React from "react";
import Link from "next/link";
import { HardDrive } from "lucide-react";
import { Alert } from "./ui";
import { formatBytes, storageLevel, type StorageLevel } from "@/lib/storage-errors";

/** Dashboard banner shown when the app is running out of the space the browser allows it. */
export function StorageWarning() {
  const [state, setState] = React.useState<{ level: StorageLevel; free: number } | null>(null);

  React.useEffect(() => {
    let alive = true;
    navigator.storage
      ?.estimate?.()
      .then(({ usage, quota }) => {
        if (alive) setState({ level: storageLevel(usage, quota), free: (quota ?? 0) - (usage ?? 0) });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  if (!state || state.level === "ok") return null;
  const critical = state.level === "critical";
  return (
    <Alert variant={critical ? "danger" : "warning"}>
      <HardDrive />
      <span>
        <b>{critical ? "Storage almost full." : "Storage is getting low."}</b> About {formatBytes(state.free)}{" "}
        left for this app. {critical ? "New prints and photos may not save. " : ""}
        Free up space on your device or remove photos from older prints, and{" "}
        <Link href="/settings/#backup" className="font-medium underline">
          export a backup
        </Link>
        .
      </span>
    </Alert>
  );
}
