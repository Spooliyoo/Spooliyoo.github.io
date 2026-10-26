/// <reference lib="webworker" />
import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  // Wait for the user to press "Reload" in the update banner instead of swapping versions mid-session.
  skipWaiting: false,
  clientsClaim: true,
  navigationPreload: false,
  runtimeCaching: defaultCache,
  precacheOptions: { cleanupOutdatedCaches: true, ignoreURLParametersMatching: [/.*/] },
});

serwist.addEventListeners();
