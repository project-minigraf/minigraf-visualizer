// Keep the workspace across page reloads. We store the portable `.graph` bytes
// (from `exportGraph()`) plus a little metadata in one IndexedDB record. The
// live database is always an in-memory `BrowserDb` restored with
// `importGraph()`, so replacing a workspace never leaves stale pages behind.

export interface SavedWorkspace {
  graph: Uint8Array;
  /** Entity id -> keyword name, learned from scripts the app ran. */
  aliases: [string, string][];
  /** Where the data came from, for the header. */
  source: string;
  sampleId: string | null;
  /** Set when the workspace came from a link that carried its own script. */
  script?: { text: string; title: string };
  /** `(rule ...)` forms. Rules live in memory only, so we replay them on load. */
  rules: string[];
}

const DB_NAME = "minigraf-visualizer";
const STORE = "workspace";
const KEY = "current";

function openStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openStore();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function loadWorkspace(): Promise<SavedWorkspace | null> {
  if (typeof indexedDB === "undefined") return null;
  try {
    const v = await withStore<SavedWorkspace | undefined>("readonly", (s) => s.get(KEY));
    return v ?? null;
  } catch {
    return null;
  }
}

export async function saveWorkspace(ws: SavedWorkspace): Promise<boolean> {
  if (typeof indexedDB === "undefined") return false;
  try {
    await withStore("readwrite", (s) => s.put(ws, KEY));
    return true;
  } catch {
    return false;
  }
}
