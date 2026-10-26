import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { parseTimestamp } from "./calc";
import { isStorageFullError, STORAGE_FULL_MESSAGE } from "./storage-errors";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(
  v: string | null | undefined,
  opts: Intl.DateTimeFormatOptions = { dateStyle: "medium" },
) {
  const d = parseTimestamp(v);
  return d ? new Intl.DateTimeFormat(undefined, opts).format(d) : "—";
}

/** Local "YYYY-MM-DDTHH:mm" for <input type="datetime-local">. */
export function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Local yyyy-mm-dd (from <input type="date">) → ISO instant at local midnight. */
export function localDateToIso(date: string, addDays = 0): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, (d ?? 1) + addDays).toISOString();
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** User-facing message for an error; storage-full errors get a plain-language explanation. */
export const errorMessage = (e: unknown) =>
  isStorageFullError(e) ? STORAGE_FULL_MESSAGE : e instanceof Error ? e.message : String(e);

/** Number input → number | NaN, treating blank as the fallback. */
export const num = (v: string, fallback = NaN) => (v.trim() === "" ? fallback : Number(v));
