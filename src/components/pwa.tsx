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

const isIos = () =>
  typeof navigator !== "undefined" &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  const mq = window.matchMedia("(display-mode: standalone)");
  mq.addEventListener("change", cb);
  return () => {
    listeners.delete(cb);
    mq.removeEventListener("change", cb);
  };
};
// Snapshot encodes [installed, canPrompt, ios] as a string so React can compare it cheaply.
const snapshot = () => {
  const installed = isStandalone();
  return `${+installed}${+(!installed && !!deferredPrompt)}${+(!installed && isIos())}`;
};
const serverSnapshot = () => "000";

export function useInstall() {
  const s = React.useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  return {
    installed: s[0] === "1",
    canPrompt: s[1] === "1",
    ios: s[2] === "1",
    prompt: async () => {
      if (!deferredPrompt) return;
      await deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      notify();
    },
  };
}

export function InstallButton({ className }: { className?: string }) {
  const { canPrompt, ios, prompt } = useInstall();
  const [guide, setGuide] = React.useState(false);
  if (!canPrompt && !ios) return null;
  return (
    <>
      <Button variant="outline" className={className} onClick={() => (canPrompt ? prompt() : setGuide(true))}>
        <Download /> Install app
      </Button>
      <Dialog
        open={guide}
        onClose={() => setGuide(false)}
        title="Install on iPhone or iPad"
        footer={<Button onClick={() => setGuide(false)}>Got it</Button>}
      >
        <ol className="flex list-decimal flex-col gap-3 pl-5">
          <li>
            Open this page in <b>Safari</b>.
          </li>
          <li>
            Tap the <b>Share</b> button <Share className="inline size-4 align-text-bottom" />.
          </li>
          <li>
            Choose <b>Add to Home Screen</b> <SquarePlus className="inline size-4 align-text-bottom" />, then{" "}
            <b>Add</b>.
          </li>
        </ol>
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
