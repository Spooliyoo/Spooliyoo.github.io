/** Detects "device/browser storage is full" errors, however deeply the browser or PGlite wrapped them. */

export const STORAGE_FULL_TITLE = "Storage is full";
export const STORAGE_FULL_MESSAGE =
  "Your device is out of storage space, so nothing was saved. Free up space on the device, or remove photos from some older prints, then try again.";

const PATTERN = /quota|QuotaExceeded|ENOSPC|no space left|disk is full|storage is full/i;

export function isStorageFullError(e: unknown, depth = 0): boolean {
  if (e == null || depth > 5) return false;
  if (typeof e === "string") return PATTERN.test(e);
  if (typeof e !== "object") return false;
  const err = e as {
    name?: unknown;
    message?: unknown;
    code?: unknown;
    errno?: unknown;
    cause?: unknown;
    error?: unknown;
  };
  if (err.name === "QuotaExceededError") return true;
  // Legacy DOMException code for QUOTA_EXCEEDED_ERR; Emscripten's ENOSPC errno (used by PGlite's file system).
  if (typeof DOMException !== "undefined" && e instanceof DOMException && err.code === 22) return true;
  if (err.errno === 28 || err.code === "ENOSPC") return true;
  if (typeof err.message === "string" && PATTERN.test(err.message)) return true;
  return isStorageFullError(err.cause, depth + 1) || isStorageFullError(err.error, depth + 1);
}
