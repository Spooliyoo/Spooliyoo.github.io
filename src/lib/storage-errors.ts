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

// ---------- Low-space warning ----------

/** Warn once the app has used this share of what the browser allows it. */
export const STORAGE_WARN_RATIO = 0.8;
/** …or when less than this much room is left, whatever the ratio. */
export const STORAGE_WARN_MIN_FREE = 200 * 1024 * 1024;

export type StorageLevel = "ok" | "low" | "critical";

/** Classifies the browser's storage estimate. `critical` = under 5% or 25 MB left. */
export function storageLevel(usage?: number, quota?: number): StorageLevel {
  if (usage == null || quota == null || quota <= 0) return "ok";
  const free = quota - usage;
  if (usage / quota >= 0.95 || free < 25 * 1024 * 1024) return "critical";
  if (usage / quota >= STORAGE_WARN_RATIO || free < STORAGE_WARN_MIN_FREE) return "low";
  return "ok";
}

export const formatBytes = (b: number) =>
  b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : `${Math.max(0, b / 1024 ** 2).toFixed(0)} MB`;
