// Turn a History into a graph: entities become nodes and facts whose value
// points at another entity become edges. The node and edge sets cover the
// whole history, so the layout stays still while the user scrubs through time.

import type { Scalar } from "./engine";
import type { FactVersion, History } from "./history";
import { entityKeywords } from "./datalog";
import { isUuid, keywordToEntityId } from "./uuid5";

export interface GraphNode {
  id: string;
  label: string;
  /** Named by a keyword value but never used as an entity (for example `:techcorp`). */
  stub: boolean;
}

export interface GraphEdge {
  /** Key of the fact version that forms this edge. */
  key: string;
  source: string;
  target: string;
  attr: string;
}

export interface GraphModel {
  nodes: Map<string, GraphNode>;
  edges: GraphEdge[];
  labelOf: (id: string) => string;
  refTarget: (v: Scalar) => string | null;
}

export interface GraphOptions {
  /** Show keyword values that never appear as an entity as their own nodes. */
  keywordNodes: boolean;
}

const KEYWORD_RE = /^:[^\s"]+$/;

export function isKeyword(v: Scalar): v is string {
  return typeof v === "string" && KEYWORD_RE.test(v);
}

const NAME_ATTR_RE = /(^:|\/)(name|title|label)$/;

/** Map entity id -> keyword, learned from keyword values in the data plus any known aliases. */
export function collectAliases(history: History, known: Map<string, string> = new Map()): Map<string, string> {
  const aliases = new Map<string, string>();
  for (const [id, kw] of known) if (history.entities.has(id)) aliases.set(id, kw);
  for (const f of history.facts.values()) {
    if (isKeyword(f.v)) {
      const id = keywordToEntityId(f.v);
      if (!aliases.has(id)) aliases.set(id, f.v);
    }
  }
  return aliases;
}

/**
 * Keyword names for entities written by a script. Minigraf stores only the
 * UUID of `:alice`, so the app remembers the keywords it has seen in the
 * scripts it ran.
 */
export function aliasesFromSource(src: string, into: Map<string, string> = new Map()): Map<string, string> {
  for (const kw of entityKeywords(src)) into.set(keywordToEntityId(kw), kw);
  return into;
}

export function shortId(id: string): string {
  return `#${id.slice(0, 6)}`;
}

export function buildGraph(history: History, aliases: Map<string, string>, options: GraphOptions): GraphModel {
  // Latest name-like attribute per entity, used when no keyword alias is known.
  const names = new Map<string, { tx: number; value: string }>();
  for (const f of history.facts.values()) {
    if (typeof f.v === "string" && !isKeyword(f.v) && NAME_ATTR_RE.test(f.a)) {
      const prev = names.get(f.e);
      if (!prev || f.txAsserted >= prev.tx) names.set(f.e, { tx: f.txAsserted, value: f.v });
    }
  }

  const labelOf = (id: string): string => aliases.get(id) ?? names.get(id)?.value ?? shortId(id);

  const refTarget = (v: Scalar): string | null => {
    if (typeof v !== "string") return null;
    if (isUuid(v)) {
      const id = v.toLowerCase();
      return history.entities.has(id) ? id : null;
    }
    if (isKeyword(v)) {
      const id = keywordToEntityId(v);
      if (history.entities.has(id) || options.keywordNodes) return id;
    }
    return null;
  };

  const nodes = new Map<string, GraphNode>();
  for (const id of history.entities) nodes.set(id, { id, label: labelOf(id), stub: false });

  const edges: GraphEdge[] = [];
  for (const f of history.facts.values()) {
    const target = refTarget(f.v);
    if (target === null) continue;
    if (!nodes.has(target)) nodes.set(target, { id: target, label: labelOf(target), stub: true });
    edges.push({ key: f.key, source: f.e, target, attr: f.a });
  }

  return { nodes, edges, labelOf, refTarget };
}

/** Is this fact version drawn as an edge (rather than a node property)? */
export function isEdgeFact(model: GraphModel, f: FactVersion): boolean {
  return model.refTarget(f.v) !== null;
}

/** Human-readable rendering of a value. Entity refs use their label. */
export function formatValue(v: Scalar, model?: GraphModel): string {
  if (v === null) return "nil";
  if (typeof v === "string") {
    const target = model?.refTarget(v);
    if (target && model) return model.labelOf(target);
    if (isKeyword(v)) return v;
    return JSON.stringify(v);
  }
  return String(v);
}

// Categorical palette, readable on both the light and dark backgrounds.
const PALETTE = [
  "#4f8cff",
  "#f2994a",
  "#27ae60",
  "#eb5757",
  "#9b51e0",
  "#00a8a8",
  "#d4a017",
  "#e0559b",
  "#6f7cf0",
  "#8a9a3a",
];

export function attributeColor(attribute: string, attributes: string[]): string {
  const idx = attributes.indexOf(attribute);
  if (idx >= 0) return PALETTE[idx % PALETTE.length];
  let h = 0;
  for (const ch of attribute) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}

/**
 * A rough "type" for each node: the most common attribute namespace on the
 * entity (`:person/name` -> `person`). Stub nodes are `value`.
 */
export function nodeKinds(history: History, model: GraphModel): Map<string, string> {
  const counts = new Map<string, Map<string, number>>();
  for (const f of history.facts.values()) {
    const slash = f.a.indexOf("/");
    const ns = slash > 1 ? f.a.slice(1, slash) : "entity";
    let m = counts.get(f.e);
    if (!m) counts.set(f.e, (m = new Map()));
    // Un-namespaced attributes (`:works-at`) only decide the kind when nothing else does.
    m.set(ns, (m.get(ns) ?? 0) + (ns === "entity" ? 0.01 : 1));
  }
  const kinds = new Map<string, string>();
  for (const n of model.nodes.values()) {
    const m = counts.get(n.id);
    if (!m || n.stub) {
      kinds.set(n.id, "value");
      continue;
    }
    let best = "entity";
    let bestCount = -1;
    for (const [ns, c] of m) {
      if (c > bestCount || (c === bestCount && ns < best)) {
        best = ns;
        bestCount = c;
      }
    }
    kinds.set(n.id, best);
  }
  return kinds;
}

const KIND_PALETTE = ["#7c9cff", "#f2994a", "#3ecf8e", "#c678dd", "#56c7d6", "#e5c07b", "#ff7eb6", "#a3be8c"];

export function kindColor(kind: string, kinds: string[]): string {
  if (kind === "value") return "var(--muted)";
  const idx = kinds.indexOf(kind);
  return KIND_PALETTE[(idx >= 0 ? idx : 0) % KIND_PALETTE.length];
}
