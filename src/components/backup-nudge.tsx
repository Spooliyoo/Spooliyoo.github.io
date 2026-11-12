"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { CloudUpload, Download } from "lucide-react";
import { useLocalQuery, useToast, useWrite } from "./providers";
import { Button, Dialog } from "./ui";
import { changesSinceBackup } from "@/lib/db/repo";
import { downloadBackupFile } from "@/lib/backup-download";
import { errorMessage, formatDate } from "@/lib/utils";

/** Pop up a reminder once this many changes haven't been backed up… */
const FIRST_REMINDER_AT = 5;
/** …and again after this many more if the user chose "Later". */
const SNOOZE_STEP = 10;
const SNOOZE_KEY = "ft-backup-snooze-until";

function readSnooze(): number {
  try {
    return Number(localStorage.getItem(SNOOZE_KEY) ?? 0) || 0;
  } catch {
    return 0;
  }
}
function writeSnooze(v: number) {
  try {
    localStorage.setItem(SNOOZE_KEY, String(v));
  } catch {}
}

/**
 * Keeps a "Back up" button on screen whenever there are changes that aren't in a backup file yet,
 * and pops up a reminder after a few changes.
 */
export function BackupNudge() {
  const { data } = useLocalQuery(["backup-status"], ({ db }) => changesSinceBackup(db));
  const write = useWrite();
  const toast = useToast();
  const path = usePathname() ?? "/";
  const [busy, setBusy] = React.useState(false);
  const [dismissedAt, setDismissedAt] = React.useState<number | null>(null);

  const changes = data?.changes ?? 0;
  const onForm = /\/(new|edit)\/?$/.test(path); // don't interrupt while filling in a form
  const snoozeUntil = Math.max(readSnooze(), FIRST_REMINDER_AT);
  const showPopup = !onForm && changes >= snoozeUntil && dismissedAt !== changes;

  const backup = async () => {
    setBusy(true);
    try {
      await write((app) => downloadBackupFile(app));
      writeSnooze(0);
      toast("Backup downloaded — keep the file somewhere safe");
    } catch (e) {
      toast(errorMessage(e), "danger");
    } finally {
      setBusy(false);
    }
  };

  if (changes === 0) return null;

  return (
    <>
      {/* Always-visible button while there are un-backed-up changes */}
      {!onForm && (
        <button
          onClick={backup}
          disabled={busy}
          className="bg-primary text-primary-foreground fixed right-4 bottom-[calc(6.5rem+env(safe-area-inset-bottom))] z-30 flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium shadow-lg hover:opacity-90 disabled:opacity-60 md:right-8 md:bottom-10"
          aria-label={`Back up now — ${changes} unsaved ${changes === 1 ? "change" : "changes"}`}
        >
          <CloudUpload className="size-4" />
          {busy ? "Saving…" : "Back up"}
          <span className="bg-accent text-accent-foreground rounded-full px-1.5 text-xs font-semibold">
            {changes}
          </span>
        </button>
      )}

      <Dialog
        open={showPopup}
        onClose={() => {
          writeSnooze(changes + SNOOZE_STEP);
          setDismissedAt(changes);
        }}
        title="Save a backup?"
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => {
                writeSnooze(changes + SNOOZE_STEP);
                setDismissedAt(changes);
              }}
            >
              Later
            </Button>
            <Button
              disabled={busy}
              onClick={async () => {
                await backup();
                setDismissedAt(changes);
              }}
            >
              <Download /> Download backup
            </Button>
          </>
        }
      >
        <p>
          You have <b>{changes}</b> {changes === 1 ? "change" : "changes"} that{" "}
          {data?.lastBackupAt
            ? `aren't in your last backup (${formatDate(data.lastBackupAt)})`
            : "have never been backed up"}
          .
        </p>
        <p className="text-muted-foreground mt-2">
          Your data lives only in this browser. A backup file lets you restore everything — on this device or
          a new one — from Settings → Import backup.
        </p>
      </Dialog>
    </>
  );
}
