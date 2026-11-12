"use client";

import * as React from "react";
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { getDatabase, OtherTabError, type AppDatabase } from "@/lib/db/browser";
import { getSettings, purgeExpiredDeleted } from "@/lib/db/repo";
import type { Settings } from "@/lib/db/schema";
import { formatMoney } from "@/lib/calc";
import { Alert, Button, Spinner } from "./ui";
import { errorMessage } from "@/lib/utils";
import { BackupNudge } from "./backup-nudge";
import { isStorageFullError, STORAGE_FULL_MESSAGE, STORAGE_FULL_TITLE } from "@/lib/storage-errors";
import { AlertTriangle, X } from "lucide-react";

const DbContext = React.createContext<AppDatabase | null>(null);

export function useApp(): AppDatabase {
  const v = React.useContext(DbContext);
  if (!v) throw new Error("useApp must be used inside <Providers>");
  return v;
}

/** Runs a query against the local database with caching; refreshes after any write via useWrite(). */
export function useLocalQuery<T>(
  key: readonly unknown[],
  fn: (app: AppDatabase) => Promise<T>,
  enabled = true,
) {
  const app = useApp();
  return useQuery({ queryKey: key, queryFn: () => fn(app), enabled });
}

// ---------- Storage full ----------

const StorageFullContext = React.createContext<(full: boolean) => void>(() => {});

/** Below this much free quota we refuse to start a write, so it can't fail halfway. */
const MIN_FREE_BYTES = 5 * 1024 * 1024;

export class StorageFullError extends Error {
  name = "QuotaExceededError";
  constructor() {
    super(STORAGE_FULL_MESSAGE);
  }
}

async function assertSpace() {
  try {
    const { usage, quota } = (await navigator.storage?.estimate?.()) ?? {};
    if (usage != null && quota != null && quota - usage < MIN_FREE_BYTES) throw new StorageFullError();
  } catch (e) {
    if (e instanceof StorageFullError) throw e;
    // estimate() unsupported or failed: don't block the save
  }
}

export function useWrite() {
  const app = useApp();
  const qc = useQueryClient();
  const setFull = React.useContext(StorageFullContext);
  return React.useCallback(
    async <T,>(fn: (app: AppDatabase) => Promise<T>): Promise<T> => {
      try {
        await assertSpace();
        const r = await fn(app);
        await qc.invalidateQueries();
        return r;
      } catch (e) {
        if (isStorageFullError(e)) setFull(true);
        throw e;
      }
    },
    [app, qc, setFull],
  );
}

function StorageFullBanner({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-x-0 top-0 z-50 flex justify-center p-3">
      <div
        role="alert"
        className="bg-danger flex max-w-lg items-start gap-3 rounded-lg px-4 py-3 text-sm text-white shadow-lg"
      >
        <AlertTriangle className="mt-0.5 size-5 shrink-0" />
        <div className="flex-1">
          <p className="font-semibold">{STORAGE_FULL_TITLE}</p>
          <p className="mt-0.5">{STORAGE_FULL_MESSAGE}</p>
          <p className="mt-1 opacity-90">Export a backup as soon as you have space again.</p>
        </div>
        <button aria-label="Dismiss" onClick={onClose} className="opacity-80 hover:opacity-100">
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}

export function useSettings(): Settings | undefined {
  return useLocalQuery(["settings"], ({ db }) => getSettings(db)).data;
}

export function useMoney() {
  const s = useSettings();
  return React.useCallback((v: number) => formatMoney(v, s?.currency ?? "INR"), [s?.currency]);
}

// ---------- Toasts ----------

type Toast = { id: number; message: string; tone: "default" | "danger" };
const ToastContext = React.createContext<(message: string, tone?: Toast["tone"]) => void>(() => {});
export const useToast = () => React.useContext(ToastContext);

function ToastHost({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const push = React.useCallback((message: string, tone: Toast["tone"] = "default") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(10rem+env(safe-area-inset-bottom))] z-50 flex flex-col items-center gap-2 px-4 md:bottom-24"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={
              "pointer-events-auto flex max-w-sm items-center gap-2 rounded-lg px-4 py-2 text-sm shadow-lg " +
              (t.tone === "danger" ? "bg-danger text-white" : "bg-foreground text-background")
            }
          >
            <span className="flex-1">{t.message}</span>
            <button
              aria-label="Dismiss"
              onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}
              className="opacity-70 hover:opacity-100"
            >
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// ---------- Theme ----------

function ThemeSync() {
  const s = useSettings();
  const theme = s?.theme ?? "light";
  React.useEffect(() => {
    try {
      localStorage.setItem("ft-theme", theme);
    } catch {}
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () =>
      document.documentElement.classList.toggle(
        "dark",
        theme === "dark" || (theme === "system" && mq.matches),
      );
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);
  return null;
}

// ---------- Root ----------

export function Providers({ children }: { children: React.ReactNode }) {
  const [qc] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: Infinity, refetchOnWindowFocus: false, retry: false, networkMode: "always" },
          mutations: { networkMode: "always" },
        },
      }),
  );
  const [app, setApp] = React.useState<AppDatabase | null>(null);
  const [error, setError] = React.useState<unknown>(null);
  const [attempt, setAttempt] = React.useState(0);
  const [storageFull, setStorageFull] = React.useState(false);

  // Catch storage-full errors from writes that don't handle errors themselves.
  React.useEffect(() => {
    const onRejection = (e: PromiseRejectionEvent) => {
      if (isStorageFullError(e.reason)) {
        e.preventDefault();
        setStorageFull(true);
      }
    };
    window.addEventListener("unhandledrejection", onRejection);
    return () => window.removeEventListener("unhandledrejection", onRejection);
  }, []);

  React.useEffect(() => {
    let alive = true;
    getDatabase().then(
      (a) => {
        // Remove prints that have been in Recently deleted for longer than the keep period.
        purgeExpiredDeleted(a.db, a.photos).catch(() => {});
        if (alive) setApp(a);
      },
      (e) => alive && setError(e),
    );
    return () => {
      alive = false;
    };
  }, [attempt]);

  if (error) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-md flex-col justify-center gap-4 p-6">
        <Alert variant="danger">
          <AlertTriangle />
          <div>
            <p className="font-medium">
              {error instanceof OtherTabError ? "Already open elsewhere" : "Couldn't open your data"}
            </p>
            <p className="mt-1">{errorMessage(error)}</p>
          </div>
        </Alert>
        <Button
          onClick={() => {
            setError(null);
            setAttempt((n) => n + 1);
          }}
        >
          Try again
        </Button>
      </div>
    );
  }

  if (!app) {
    return (
      <div className="text-muted-foreground flex min-h-[60vh] flex-col items-center justify-center gap-3 text-sm">
        <Spinner className="size-8" />
        <p>Opening your filament data…</p>
      </div>
    );
  }

  return (
    <QueryClientProvider client={qc}>
      <DbContext.Provider value={app}>
        <StorageFullContext.Provider value={setStorageFull}>
          <ToastHost>
            <ThemeSync />
            <BackupNudge />
            {storageFull && <StorageFullBanner onClose={() => setStorageFull(false)} />}
            {children}
          </ToastHost>
        </StorageFullContext.Provider>
      </DbContext.Provider>
    </QueryClientProvider>
  );
}
