// Pure, in-memory time travel over an extracted History. These functions mirror
// Minigraf's own filters so the UI can scrub instantly without a query per
// frame. The test suite checks them against the real engine.

import type { ValidAt } from "./datalog";
import type { FactVersion, History } from "./history";

export interface Cursor {
  /** Transaction-time cursor: show the database as of this transaction. */
  asOf: number;
  /** Valid-time cursor. */
  validAt: ValidAt;
}

/** Recorded in the database as of transaction `asOf` (transaction-time filter). */
export function recordedAsOf(f: FactVersion, asOf: number): boolean {
  return f.txAsserted <= asOf && (f.txRetracted === null || f.txRetracted > asOf);
}

/** True in the real world at `ms` (valid-time filter: `valid_from <= t < valid_to`). */
export function validAtMs(f: FactVersion, ms: number): boolean {
  return f.validFrom <= ms && (f.validTo === null || ms < f.validTo);
}

export function isVisible(f: FactVersion, cursor: Cursor, nowMs: number): boolean {
  if (!recordedAsOf(f, cursor.asOf)) return false;
  switch (cursor.validAt.kind) {
    case "any":
      return true;
    case "now":
      return validAtMs(f, nowMs);
    case "at":
      return validAtMs(f, cursor.validAt.ms);
  }
}

export function visibleFacts(history: History, cursor: Cursor, nowMs: number): FactVersion[] {
  const out: FactVersion[] = [];
  for (const f of history.facts.values()) if (isVisible(f, cursor, nowMs)) out.push(f);
  return out;
}

/** How a fact version relates to the transaction under the cursor. */
export type ChangeState = "added" | "removed" | "same";

/**
 * `added` if transaction `asOf` asserted the version, `removed` if it
 * retracted it, else `same`.
 */
export function changeAt(f: FactVersion, asOf: number): ChangeState {
  if (f.txAsserted === asOf) return "added";
  if (f.txRetracted === asOf) return "removed";
  return "same";
}

/** Earliest and latest interesting valid-time instants in the history (finite bounds only). */
export function validTimeExtent(history: History, nowMs: number): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const f of history.facts.values()) {
    lo = Math.min(lo, f.validFrom);
    hi = Math.max(hi, f.validFrom);
    if (f.validTo !== null) hi = Math.max(hi, f.validTo);
  }
  lo = Math.min(lo, nowMs);
  hi = Math.max(hi, nowMs);
  if (!Number.isFinite(lo)) return [nowMs - 365 * 864e5, nowMs + 30 * 864e5];
  const pad = Math.max((hi - lo) * 0.06, 864e5);
  return [lo - pad, hi + pad];
}

/**
 * Why a version stopped being visible: a `retract`, or a newer `transact` of
 * the same fact with the same valid-time window (Minigraf keeps the newest).
 */
export function removalKind(history: History, f: FactVersion): "retracted" | "replaced" | null {
  if (f.txRetracted === null) return null;
  const tx = history.txs[f.txRetracted - 1];
  const replaced = tx?.asserted.some((key) => {
    const g = history.facts.get(key);
    return g !== undefined && g.e === f.e && g.a === f.a && g.v === f.v && g.validFrom === f.validFrom && g.validTo === f.validTo;
  });
  return replaced ? "replaced" : "retracted";
}
