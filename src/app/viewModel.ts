import { useMemo } from "react";
import type { ValidAt } from "../lib/datalog";
import { buildGraph, collectAliases, type GraphModel } from "../lib/graph";
import type { FactVersion, History } from "../lib/history";
import { isVisible } from "../lib/snapshot";

/** How an item relates to the transaction under the cursor. */
export type ItemState = "visible" | "added" | "removed" | "hidden";

export interface ViewModel {
  history: History;
  model: GraphModel;
  asOf: number;
  validAt: ValidAt;
  now: number;
  /** Keys of fact versions visible at the cursor. */
  visible: Set<string>;
  /** Keys visible one transaction earlier, at the same valid time. */
  previous: Set<string>;
  nodeState: Map<string, ItemState>;
  edgeState: Map<string, ItemState>;
  /** Visible facts grouped by entity. */
  factsByEntity: Map<string, FactVersion[]>;
}

function stateOf(now: boolean, before: boolean): ItemState {
  if (now) return before ? "visible" : "added";
  return before ? "removed" : "hidden";
}

export function useViewModel(
  history: History,
  aliases: Map<string, string>,
  keywordNodes: boolean,
  asOf: number,
  validAt: ValidAt,
  now: number,
): ViewModel {
  const model = useMemo(
    () => buildGraph(history, collectAliases(history, aliases), { keywordNodes }),
    [history, aliases, keywordNodes],
  );

  return useMemo(() => {
    const visible = new Set<string>();
    const previous = new Set<string>();
    const nodesNow = new Set<string>();
    const nodesBefore = new Set<string>();
    const factsByEntity = new Map<string, FactVersion[]>();

    for (const f of history.facts.values()) {
      const target = model.refTarget(f.v);
      if (isVisible(f, { asOf, validAt }, now)) {
        visible.add(f.key);
        nodesNow.add(f.e);
        if (target) nodesNow.add(target);
        const list = factsByEntity.get(f.e);
        if (list) list.push(f);
        else factsByEntity.set(f.e, [f]);
      }
      if (asOf > 0 && isVisible(f, { asOf: asOf - 1, validAt }, now)) {
        previous.add(f.key);
        nodesBefore.add(f.e);
        if (target) nodesBefore.add(target);
      }
    }

    const nodeState = new Map<string, ItemState>();
    for (const id of model.nodes.keys()) nodeState.set(id, stateOf(nodesNow.has(id), nodesBefore.has(id)));
    const edgeState = new Map<string, ItemState>();
    for (const e of model.edges) edgeState.set(e.key, stateOf(visible.has(e.key), previous.has(e.key)));

    return { history, model, asOf, validAt, now, visible, previous, nodeState, edgeState, factsByEntity };
  }, [history, model, asOf, validAt, now]);
}
