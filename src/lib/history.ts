// Rebuild the full bi-temporal history of a Minigraf database using only the
// public Datalog API.
//
// Minigraf does not expose its append-only fact log directly, but it gives us
// enough to rebuild it:
//
//   * `:as-of N` shows the database as it was after transaction N.
//   * `:any-valid-time` turns off the valid-time filter.
//   * The pseudo-attributes `:db/tx-count`, `:db/tx-id`, `:db/valid-from` and
//     `:db/valid-to` bind the metadata of the fact matched by the pattern
//     before them.
//
// So we ask for every fact version (entity, attribute, value, tx, valid range)
// as of each transaction in turn and diff neighbouring snapshots. A version
// that appears at N was asserted by transaction N. A version that disappears
// at N was retracted by transaction N.
//
// To learn the last transaction number we copy the database into a scratch
// in-memory instance, write one probe fact there and read its tx-count.

import type { MinigrafDb, OpenInMemory, Scalar } from "./engine";
import { query } from "./engine";

/** Minigraf stores "valid forever" as i64::MAX. JSON turns it into ~9.22e18. */
export const FOREVER_THRESHOLD = 9e18;

export interface FactVersion {
  /** Stable id: entity, attribute, value, tx and valid range. */
  key: string;
  e: string;
  a: string;
  v: Scalar;
  validFrom: number;
  /** `null` means open-ended (valid forever). */
  validTo: number | null;
  txAsserted: number;
  /** Transaction that retracted this version, or `null` if still current. */
  txRetracted: number | null;
  /** Wall-clock time (Unix ms) of the asserting transaction. */
  txIdMs: number;
}

export interface TxInfo {
  count: number;
  /** Wall-clock time of the transaction, when known. Retraction-only transactions do not expose it. */
  wallMs: number | null;
  asserted: string[];
  retracted: string[];
}

export interface History {
  maxTx: number;
  /** `txs[i]` describes transaction `i + 1`. */
  txs: TxInfo[];
  facts: Map<string, FactVersion>;
  /** Every id that appears in entity position in any version. */
  entities: Set<string>;
  /** Every attribute ever used. */
  attributes: string[];
}

export interface ExtractOptions {
  /** Called after each transaction is read. */
  onProgress?: (done: number, total: number) => void;
  /** Stop after this many transactions. Defaults to 5000. */
  maxTransactions?: number;
}

const SNAPSHOT_QUERY = (asOf: number) =>
  `(query [:find ?e ?a ?v ?tx ?tid ?vf ?vt :as-of ${asOf} :any-valid-time ` +
  `:where [?e ?a ?v] [?e :db/tx-count ?tx] [?e :db/tx-id ?tid] [?e :db/valid-from ?vf] [?e :db/valid-to ?vt]])`;

const PROBE_ATTR = ":minigraf-visualizer/probe";

/** Number of the last transaction in `db` (0 for an empty database). */
export async function lastTxCount(db: MinigrafDb, openInMemory: OpenInMemory): Promise<number> {
  const bytes = db.exportGraph();
  const scratch = openInMemory();
  try {
    await scratch.importGraph(bytes);
    await scratch.execute(`(transact [[:minigraf-visualizer-probe ${PROBE_ATTR} true]])`);
    const r = await query(scratch, `(query [:find ?tx :any-valid-time :where [?e ${PROBE_ATTR} ?v] [?e :db/tx-count ?tx]])`);
    const tx = Number(r.results[0]?.[0] ?? 1);
    return Math.max(0, tx - 1);
  } finally {
    scratch.free();
  }
}

function versionKey(e: string, a: string, v: Scalar, tx: number, vf: number, vt: number | null): string {
  return JSON.stringify([e, a, v, tx, vf, vt]);
}

const yieldToEventLoop = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export async function extractHistory(
  db: MinigrafDb,
  openInMemory: OpenInMemory,
  options: ExtractOptions = {},
): Promise<History> {
  const limit = options.maxTransactions ?? 5000;
  const maxTx = Math.min(await lastTxCount(db, openInMemory), limit);
  const facts = new Map<string, FactVersion>();
  const txs: TxInfo[] = [];
  const entities = new Set<string>();
  const attributes = new Set<string>();
  let previous = new Set<string>();
  let lastYield = Date.now();

  for (let t = 1; t <= maxTx; t++) {
    const r = await query(db, SNAPSHOT_QUERY(t));
    const current = new Set<string>();
    const info: TxInfo = { count: t, wallMs: null, asserted: [], retracted: [] };

    for (const row of r.results) {
      const [e, a, v, tx, tid, vf, vt] = row as [string, string, Scalar, number, number, number, number];
      const validTo = vt >= FOREVER_THRESHOLD ? null : vt;
      const key = versionKey(e, a, v, tx, vf, validTo);
      current.add(key);
      if (!previous.has(key) && !facts.has(key)) {
        facts.set(key, { key, e, a, v, validFrom: vf, validTo, txAsserted: tx, txRetracted: null, txIdMs: tid });
        info.asserted.push(key);
        info.wallMs = tid;
        entities.add(e);
        attributes.add(a);
      }
    }
    for (const key of previous) {
      if (!current.has(key)) {
        const f = facts.get(key);
        if (f && f.txRetracted === null) f.txRetracted = t;
        info.retracted.push(key);
      }
    }
    txs.push(info);
    previous = current;
    options.onProgress?.(t, maxTx);
    if (Date.now() - lastYield > 30) {
      await yieldToEventLoop();
      lastYield = Date.now();
    }
  }

  return { maxTx, txs, facts, entities, attributes: [...attributes].sort() };
}

export function emptyHistory(): History {
  return { maxTx: 0, txs: [], facts: new Map(), entities: new Set(), attributes: [] };
}
