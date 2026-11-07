"use client";

import * as React from "react";
import { RefreshCw, Share, SquarePlus, Download } from "lucide-react";
import { BASE_PATH } from "@/lib/db/browser";
import { Button, Dialog } from "./ui";

// ---------- Install prompt (FR-PW-2/3) ----------

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    notify();
  });
}

const isStandalone = () =>
  typeof window !== "undefined" &&
  (window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true);

export type Platform = "ios" | "mac-safari" | "firefox-desktop" | "firefox-android" | "chromium" | "other";

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent;
  const ios =
    /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (ios) return "ios";
  if (/Firefox\//.test(ua)) return /Android/.test(ua) ? "firefox-android" : "firefox-desktop";
  if (/Chrome\/|Chromium\/|Edg\//.test(ua)) return "chromium";
  if (/Macintosh/.test(ua) && /Safari\//.test(ua)) return "mac-safari";
  return "other";
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  const mq = window.matchMedia("(display-mode: standalone)");
  mq.addEventListener("change", cb);
  return () => {
    listeners.delete(cb);
    mq.removeEventListener("change", cb);
  };
};
// Snapshot "<mounted><installed><canPrompt>" — a string so React can compare it cheaply.
const snapshot = () => `1${+isStandalone()}${+(!isStandalone() && !!deferredPrompt)}`;
const serverSnapshot = () => "000";

export function useInstall() {
  const s = React.useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  return {
    mounted: s[0] === "1",
    installed: s[1] === "1",
    canPrompt: s[2] === "1",
    prompt: async () => {
      if (!deferredPrompt) return;
      await deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      notify();
    },
  };
}

const icon = (C: typeof Share) => <C className="inline size-4 align-text-bottom" />;

function InstallSteps({ platform }: { platform: Platform }) {
  switch (platform) {
    case "ios":
      return (
        <ol className="flex list-decimal flex-col gap-3 pl-5">
          <li>
            Open this page in <b>Safari</b>.
          </li>
          <li>
            Tap the <b>Share</b> button {icon(Share)}.
          </li>
          <li>
            Choose <b>Add to Home Screen</b> {icon(SquarePlus)}, then <b>Add</b>.
          </li>
        </ol>
      );
    case "mac-safari":
      return (
        <ol className="flex list-decimal flex-col gap-3 pl-5">
          <li>
            In the menu bar, choose <b>File → Add to Dock…</b>
          </li>
          <li>
            Click <b>Add</b>. The app opens in its own window from your Dock.
          </li>
        </ol>
      );
    case "firefox-desktop":
      return (
        <p>
          Firefox on computers can&apos;t install web apps. Open this page in <b>Chrome</b>, <b>Edge</b> or{" "}
          <b>Safari</b> (Mac) to install it — or keep using it here as a website.
        </p>
      );
    case "firefox-android":
      return (
        <ol className="flex list-decimal flex-col gap-3 pl-5">
          <li>
            Tap the <b>⋮</b> menu.
          </li>
          <li>
            Choose <b>Install</b> or <b>Add to Home screen</b>.
          </li>
        </ol>
      );
    default:
      return (
        <ol className="flex list-decimal flex-col gap-3 pl-5">
          <li>
            Open the browser menu (<b>⋮</b> or <b>…</b>).
          </li>
          <li>
            Choose <b>Install app</b>, <b>Add to Home screen</b>, or{" "}
            <b>Cast, save and share → Install page as app</b>.
          </li>
          <li>
            If you don&apos;t see it yet, wait a few seconds for the page to finish loading, then try again.
          </li>
        </ol>
      );
  }
}

/** Shown wherever the app isn't installed yet. Uses the browser's own prompt when available, otherwise a guide. */
export function InstallButton({ className, size }: { className?: string; size?: "sm" | "default" }) {
  const { mounted, installed, canPrompt, prompt } = useInstall();
  const [guide, setGuide] = React.useState<Platform | null>(null);
  if (!mounted || installed) return null;
  return (
    <>
      <Button
        variant="outline"
        size={size}
        className={className}
        onClick={() => (canPrompt ? prompt() : setGuide(detectPlatform()))}
      >
        <Download /> Install app
      </Button>
      <Dialog
        open={!!guide}
        onClose={() => setGuide(null)}
        title="Install Filament Tracker"
        footer={<Button onClick={() => setGuide(null)}>Got it</Button>}
      >
        {guide && <InstallSteps platform={guide} />}
        <p className="text-muted-foreground mt-4 text-xs">
          Installing gives the app its own icon, works offline, and helps protect your data from being
          cleared.
        </p>
      </Dialog>
    </>
  );
}

// ---------- Service worker + update prompt (FR-PW-1/5) ----------

export function ServiceWorker() {
  const [waiting, setWaiting] = React.useState<null | (() => void)>(null);

  React.useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    let cancelled = false;
    (async () => {
      const { Serwist } = await import("@serwist/window");
      const sw = new Serwist(`${BASE_PATH}/sw.js`, { scope: `${BASE_PATH}/`, type: "classic" });
      sw.addEventListener("waiting", () => {
        if (cancelled) return;
        setWaiting(() => () => {
          sw.addEventListener("controlling", () => window.location.reload());
          sw.messageSkipWaiting();
        });
      });
      await sw.register();
      // Check for a new version whenever the app comes back to the foreground.
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") sw.update();
      });
    })().catch(console.error);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!waiting) return null;
  return (
    <div className="fixed inset-x-0 top-0 z-50 flex justify-center p-3">
      <div className="bg-foreground text-background flex items-center gap-3 rounded-lg px-4 py-2 text-sm shadow-lg">
        <span>Update available</span>
        <Button size="sm" onClick={waiting}>
          <RefreshCw /> Reload
        </Button>
      </div>
    </div>
  );
}

// ---------- Persistent storage (FR-PW-4) ----------

export interface StorageStatus {
  supported: boolean;
  persisted: boolean;
  usage?: number;
  quota?: number;
}

export async function requestPersistence(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}

export async function storageStatus(): Promise<StorageStatus> {
  if (!navigator.storage) return { supported: false, persisted: false };
  const [persisted, est] = await Promise.all([
    navigator.storage.persisted?.() ?? Promise.resolve(false),
    navigator.storage.estimate?.() ?? Promise.resolve({} as StorageEstimate),
  ]);
  return { supported: true, persisted, usage: est.usage, quota: est.quota };
}

export function PersistOnFirstUse() {
  React.useEffect(() => {
    requestPersistence().catch(() => {});
  }, []);
  return null;
}
