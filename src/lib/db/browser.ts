"use client";

import type { PGlite } from "@electric-sql/pglite";
import { createDb, type DB } from "./client";
import { IdbPhotoStore, type PhotoStore } from "./photo-store";

export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
export const asset = (p: string) => `${BASE_PATH}${p}`;

export interface AppDatabase {
  db: DB;
  pg: PGlite;
  photos: PhotoStore;
}

export class OtherTabError extends Error {
  constructor() {
    super(
      "Filament Tracker is already open in another tab or window. Close it there, then reload this page.",
    );
  }
}

let instance: Promise<AppDatabase> | null = null;

/** Only one tab may own the database at a time (IndexedDB-backed Postgres is single-writer). */
function acquireTabLock(): Promise<void> {
  if (typeof navigator === "undefined" || !("locks" in navigator)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    navigator.locks.request("filament-tracker-db", { ifAvailable: true }, (lock) => {
      if (!lock) {
        reject(new OtherTabError());
        return;
      }
      resolve();
      return new Promise<void>(() => {}); // hold the lock for the life of the tab
    });
  });
}

async function open(): Promise<AppDatabase> {
  await acquireTabLock();
  const { PGlite } = await import("@electric-sql/pglite");
  // The bundler emits PGlite's WASM + filesystem bundle as hashed static files; the service worker precaches them.
  const pg = await PGlite.create({ dataDir: "idb://filament-tracker" });
  const db = await createDb(pg);
  return { db, pg, photos: new IdbPhotoStore() };
}

export function getDatabase(): Promise<AppDatabase> {
  if (!instance) {
    instance = open().catch((e) => {
      instance = null;
      throw e;
    });
  }
  return instance;
}
