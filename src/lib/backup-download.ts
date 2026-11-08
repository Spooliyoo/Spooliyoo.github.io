"use client";

import type { AppDatabase } from "./db/browser";
import { exportBackup } from "./db/backup";
import { markBackedUp } from "./db/repo";
import { downloadBlob } from "./utils";

/** Exports everything (photos included) to a JSON file, downloads it, and records the backup time. */
export async function downloadBackupFile({ db, photos }: AppDatabase): Promise<void> {
  const backup = await exportBackup(db, photos);
  const stamp = new Date().toISOString().slice(0, 10);
  downloadBlob(
    new Blob([JSON.stringify(backup)], { type: "application/json" }),
    `spooliyoo-backup-${stamp}.json`,
  );
  await markBackedUp(db);
}
