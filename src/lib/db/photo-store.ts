/** Stores compressed photo blobs in their own IndexedDB database, keyed by photo id. */
export interface PhotoStore {
  put(id: string, blob: Blob): Promise<void>;
  get(id: string): Promise<Blob | undefined>;
  delete(id: string): Promise<void>;
  clear(): Promise<void>;
  keys(): Promise<string[]>;
}

export class MemoryPhotoStore implements PhotoStore {
  private map = new Map<string, Blob>();
  async put(id: string, blob: Blob) {
    this.map.set(id, blob);
  }
  async get(id: string) {
    return this.map.get(id);
  }
  async delete(id: string) {
    this.map.delete(id);
  }
  async clear() {
    this.map.clear();
  }
  async keys() {
    return [...this.map.keys()];
  }
}

const DB_NAME = "filament-tracker-photos";
const STORE = "photos";

export class IdbPhotoStore implements PhotoStore {
  private dbp: Promise<IDBDatabase>;
  constructor() {
    this.dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  private async run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.dbp;
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
  async put(id: string, blob: Blob) {
    await this.run("readwrite", (s) => s.put(blob, id));
  }
  async get(id: string) {
    return (await this.run<Blob | undefined>("readonly", (s) => s.get(id))) ?? undefined;
  }
  async delete(id: string) {
    await this.run("readwrite", (s) => s.delete(id));
  }
  async clear() {
    await this.run("readwrite", (s) => s.clear());
  }
  async keys() {
    return (await this.run("readonly", (s) => s.getAllKeys())).map(String);
  }
}
