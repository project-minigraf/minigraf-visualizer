import { describe, expect, it } from "vitest";
import { toMinigrafTime, type ValidAt } from "../src/lib/datalog";
import { query, runScript } from "../src/lib/engine";
import { aliasesFromSource, buildGraph, collectAliases } from "../src/lib/graph";
import { extractHistory, lastTxCount } from "../src/lib/history";
import { visibleFacts } from "../src/lib/snapshot";
import { SAMPLES } from "../src/samples";
import { openMemory } from "./wasm";

const key = (e: unknown, a: unknown, v: unknown) => JSON.stringify([e, a, v]);

describe("history extraction", () => {
  it("returns an empty history for an empty database", async () => {
    const db = openMemory();
    const h = await extractHistory(db, openMemory);
    expect(h.maxTx).toBe(0);
    expect(h.facts.size).toBe(0);
  });

  it("records assertions and retractions per transaction", async () => {
    const db = openMemory();
    await runScript(
      db,
      `(transact [[:a :name "A"]])
       (transact [[:b :name "B"] [:a :knows :b]])
       (retract [[:a :knows :b]])
       (retract [[:b :name "B"]])`,
    );
    expect(await lastTxCount(db, openMemory)).toBe(4);
    const h = await extractHistory(db, openMemory);
    expect(h.maxTx).toBe(4);
    expect(h.txs.map((t) => [t.asserted.length, t.retracted.length])).toEqual([
      [1, 0],
      [2, 0],
      [0, 1],
      [0, 1],
    ]);
    const knows = [...h.facts.values()].find((f) => f.a === ":knows");
    expect(knows?.txAsserted).toBe(2);
    expect(knows?.txRetracted).toBe(3);
    expect(knows?.v).toBe(":b");
  });

  it("keeps explicit valid-time ranges and open-ended facts", async () => {
    const db = openMemory();
    await runScript(
      db,
      `(transact {:valid-from "2020-01-01" :valid-to "2023-06-01"} [[:alice :works-at :techcorp]])
       (transact {:valid-from "2023-06-01"} [[:alice :works-at :startupco]])`,
    );
    const h = await extractHistory(db, openMemory);
    const byValue = new Map([...h.facts.values()].map((f) => [f.v, f]));
    expect(byValue.get(":techcorp")?.validFrom).toBe(Date.UTC(2020, 0, 1));
    expect(byValue.get(":techcorp")?.validTo).toBe(Date.UTC(2023, 5, 1));
    expect(byValue.get(":startupco")?.validTo).toBeNull();
  });

  it("survives an export/import round trip", async () => {
    const db = openMemory();
    await runScript(db, SAMPLES[0].script);
    const before = await extractHistory(db, openMemory);
    const copy = openMemory();
    await copy.importGraph(db.exportGraph());
    const after = await extractHistory(copy, openMemory);
    expect(after.maxTx).toBe(before.maxTx);
    expect([...after.facts.keys()].sort()).toEqual([...before.facts.keys()].sort());
  });
});

describe.each(SAMPLES)("sample $id", (sample) => {
  it("loads, and in-memory time travel matches the engine", async () => {
    const db = openMemory();
    await runScript(db, sample.script);
    const h = await extractHistory(db, openMemory);
    expect(h.maxTx).toBeGreaterThan(3);

    const dates = new Set<number>();
    for (const f of h.facts.values()) {
      dates.add(f.validFrom);
      dates.add(f.validFrom - 1000);
      if (f.validTo !== null) {
        dates.add(f.validTo);
        dates.add(f.validTo - 1000);
      }
    }
    // Minigraf's :valid-at takes whole seconds; keep points that survive rounding.
    const points: ValidAt[] = [
      { kind: "any" },
      { kind: "now" },
      ...[...dates].filter((ms) => ms % 1000 === 0).map((ms) => ({ kind: "at" as const, ms })),
    ];

    const now = Date.now();
    for (let asOf = 0; asOf <= h.maxTx; asOf++) {
      for (const validAt of points) {
        const clause =
          validAt.kind === "any" ? ":any-valid-time" : validAt.kind === "at" ? `:valid-at "${toMinigrafTime(validAt.ms)}"` : "";
        const engine = await query(db, `(query [:find ?e ?a ?v :as-of ${asOf} ${clause} :where [?e ?a ?v]])`);
        const expected = new Set(engine.results.map(([e, a, v]) => key(e, a, v)));
        const actual = new Set(visibleFacts(h, { asOf, validAt }, now).map((f) => key(f.e, f.a, f.v)));
        expect([...actual].sort(), `as-of ${asOf}, ${JSON.stringify(validAt)}`).toEqual([...expected].sort());
      }
    }
  });

  it("builds a connected graph with readable labels", async () => {
    const db = openMemory();
    await runScript(db, sample.script);
    const h = await extractHistory(db, openMemory);
    const g = buildGraph(h, collectAliases(h, aliasesFromSource(sample.script)), { keywordNodes: true });
    expect(g.edges.length).toBeGreaterThan(0);
    for (const n of g.nodes.values()) expect(n.label.startsWith("#")).toBe(false);
  });
});
