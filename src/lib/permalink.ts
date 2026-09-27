// Shareable links. A link opens either a built-in sample or a Datalog script
// carried in the link itself, then sets the cursor, selection and view:
//
//   #sample=careers&tx=6&vt=2023-06-01T00:00:00Z&e=:alice&view=map
//   #data=<base64url script>&title=Retroactive%20correction&tx=3&view=map
//
// Everything after `#` stays in the browser; nothing is sent to a server.
// Edited or opened-file workspaces live only in the browser, so they get no link.

import { toMinigrafTime, type ValidAt } from "./datalog";
import { keywordToEntityId } from "./uuid5";

export type PermalinkView = "graph" | "map" | "facts";
const VIEWS: PermalinkView[] = ["graph", "map", "facts"];

/** What the link opens. */
export type LinkSource = { kind: "sample"; id: string } | { kind: "script"; script: string; title: string };

export interface Permalink {
  source: LinkSource;
  tx: number | null;
  validAt: ValidAt | null;
  /** Entity id. */
  entity: string | null;
  view: PermalinkView | null;
}

/** Base64url (RFC 4648 §5, no padding) of the UTF-8 bytes of `text`. */
export function encodeScript(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeScript(data: string): string | null {
  try {
    const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export function parsePermalink(hash: string): Permalink | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const sample = params.get("sample");
  const data = params.get("data");
  let source: LinkSource;
  if (sample) {
    source = { kind: "sample", id: sample };
  } else if (data) {
    const script = decodeScript(data);
    if (script === null) return null;
    source = { kind: "script", script, title: params.get("title") || "Linked example" };
  } else {
    return null;
  }

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
  const viewRaw = params.get("view");
  const view = VIEWS.find((v) => v === viewRaw) ?? null;
  return { source, tx, validAt, entity, view };
}

export function formatPermalink(
  source: LinkSource,
  tx: number,
  validAt: ValidAt,
  entityLabel: string | null,
  view: PermalinkView = "graph",
): string {
  const params = new URLSearchParams();
  if (source.kind === "sample") {
    params.set("sample", source.id);
  } else {
    params.set("data", encodeScript(source.script));
    params.set("title", source.title);
  }
  params.set("tx", String(tx));
  params.set("vt", validAt.kind === "at" ? toMinigrafTime(validAt.ms) : validAt.kind);
  if (entityLabel) params.set("e", entityLabel);
  if (view !== "graph") params.set("view", view);
  return `#${params.toString()}`;
}

/** True if the workspace origin is what the link asked for. */
export function sameSource(a: LinkSource | null, b: LinkSource | null): boolean {
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind === "sample" && b.kind === "sample") return a.id === b.id;
  if (a.kind === "script" && b.kind === "script") return a.script === b.script;
  return false;
}
