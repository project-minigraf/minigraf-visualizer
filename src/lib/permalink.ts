// Shareable links for the built-in samples:
//   #sample=careers&tx=6&vt=2023-06-01T00:00:00Z&e=:alice
// Custom workspaces live only in the browser, so they get no link.

import { toMinigrafTime, type ValidAt } from "./datalog";
import { keywordToEntityId } from "./uuid5";

export interface Permalink {
  sample: string;
  tx: number | null;
  validAt: ValidAt | null;
  /** Entity id. */
  entity: string | null;
}

export function parsePermalink(hash: string): Permalink | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const sample = params.get("sample");
  if (!sample) return null;
  const txRaw = params.get("tx");
  const tx = txRaw !== null && /^\d+$/.test(txRaw) ? Number(txRaw) : null;
  const vt = params.get("vt");
  let validAt: ValidAt | null = null;
  if (vt === "now") validAt = { kind: "now" };
  else if (vt === "any") validAt = { kind: "any" };
  else if (vt) {
    const ms = Date.parse(vt);
    if (!Number.isNaN(ms)) validAt = { kind: "at", ms };
  }
  const e = params.get("e");
  const entity = e ? (e.startsWith(":") ? keywordToEntityId(e) : e.toLowerCase()) : null;
  return { sample, tx, validAt, entity };
}

export function formatPermalink(sample: string, tx: number, validAt: ValidAt, entityLabel: string | null): string {
  const params = new URLSearchParams();
  params.set("sample", sample);
  params.set("tx", String(tx));
  params.set("vt", validAt.kind === "at" ? toMinigrafTime(validAt.ms) : validAt.kind);
  if (entityLabel) params.set("e", entityLabel);
  return `#${params.toString()}`;
}
