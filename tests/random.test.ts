import { describe, expect, it } from "vitest";
import { query, runScript } from "../src/lib/engine";
import { extendHistory, extractHistory, type History } from "../src/lib/history";
import { removalKind, visibleFacts } from "../src/lib/snapshot";
import { openMemory } from "./wasm";

function summary(h: History) {
  return {
    maxTx: h.maxTx,
    facts: [...h.facts.values()].map((f) => [f.key, f.txAsserted, f.txRetracted]).sort(),
    txs: h.txs.map((t) => [t.count, [...t.asserted].sort(), [...t.retracted].sort()]),
  };
}

// Small deterministic PRNG so failures can be replayed.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function randomScript(seed: number, steps: number): string {
  const r = rng(seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const entities = [":e0", ":e1", ":e2", ":e3", ":e4"];
  const attrs = [":p/a", ":p/b", ":ref"];
  const written: string[] = [];
  const lines: string[] = [];
  for (let i = 0; i < steps; i++) {
    const roll = r();
    if (roll < 0.3 && written.length > 0) {
      lines.push(`(retract [${pick(written)}])`);
    } else if (roll < 0.35) {
      lines.push(`(retract [[:nobody :p/a 1]])`);
    } else if (roll < 0.45 && written.length > 0) {
      lines.push(`(transact [${pick(written)}])`);
    } else {
      // One value per (entity, attribute) per call, to stay clear of minigraf#371.
      const used = new Set<string>();
      const facts: string[] = [];
      const n = 1 + Math.floor(r() * 3);
      for (let j = 0; j < n; j++) {
        const e = pick(entities);
        const a = pick(attrs);
        if (used.has(e + a)) continue;
        used.add(e + a);
        const v = a === ":ref" ? pick(entities) : String(Math.floor(r() * 4));
        const fact = `[${e} ${a} ${v}]`;
        facts.push(fact);
        written.push(fact);
      }
      const year = 2020 + Math.floor(r() * 5);
      const vt = r() < 0.5 ? `{:valid-from "${year}-01-01"${r() < 0.5 ? ` :valid-to "${year + 1}-06-01"` : ""}} ` : "";
      lines.push(`(transact ${vt}[${facts.join(" ")}])`);
    }
  }
  return lines.join("\n");
}

describe("randomized workloads", () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])("seed %i: the rebuilt history matches the engine at every transaction", async (seed) => {
    const db = openMemory();
    await runScript(db, randomScript(seed, 40));
    const h = await extractHistory(db, openMemory);
    expect(h.maxTx).toBe(40);
    const now = Date.now();
    for (let asOf = 0; asOf <= h.maxTx; asOf++) {
      for (const [clause, validAt] of [
        [":any-valid-time", { kind: "any" }],
        ['"2022-03-01T00:00:00Z"', { kind: "at", ms: Date.UTC(2022, 2, 1) }],
      ] as const) {
        const vt = clause.startsWith(":") ? clause : `:valid-at ${clause}`;
        const engine = await query(db, `(query [:find ?e ?a ?v :as-of ${asOf} ${vt} :where [?e ?a ?v]])`);
        // Compare as bags: the engine returns one row per visible version.
        const expected = engine.results.map((r) => JSON.stringify(r)).sort();
        const actual = visibleFacts(h, { asOf, validAt }, now)
          .map((f) => JSON.stringify([f.e, f.a, f.v]))
          .sort();
        expect(actual, `seed ${seed}, as-of ${asOf}, ${clause}`).toEqual(expected);
      }
    }
  });

  it.each([11, 12, 13])("seed %i: extending after each write equals a full rebuild", async (seed) => {
    const lines = randomScript(seed, 30).split("\n");
    const db = openMemory();
    let h = await extractHistory(db, openMemory);
    for (let i = 0; i < lines.length; i += 4) {
      await runScript(db, lines.slice(i, i + 4).join("\n"));
      h = await extendHistory(db, openMemory, h);
    }
    const full = await extractHistory(db, openMemory);
    expect(summary(h)).toEqual(summary(full));
    expect(h.txs.map((t) => t.wallMs)).toEqual(full.txs.map((t) => t.wallMs));
  });

  it("extending does not change the previous history", async () => {
    const db = openMemory();
    await runScript(db, "(transact [[:a :p/a 1]])");
    const before = await extractHistory(db, openMemory);
    const snapshot = JSON.stringify(summary(before));
    await runScript(db, "(retract [[:a :p/a 1]])");
    const after = await extendHistory(db, openMemory, before);
    expect(JSON.stringify(summary(before))).toBe(snapshot);
    expect([...after.facts.values()][0].txRetracted).toBe(2);
  });
});

describe("removal kinds", () => {
  it("tells a retraction from a same-window replacement", async () => {
    const db = openMemory();
    await runScript(
      db,
      `(transact {:valid-from "2022-01-01"} [[:a :p/a 1]])
       (transact {:valid-from "2022-01-01"} [[:a :p/a 1]])
       (retract [[:a :p/a 1]])`,
    );
    const h = await extractHistory(db, openMemory);
    const [first, second] = [...h.facts.values()].sort((x, y) => x.txAsserted - y.txAsserted);
    expect([first.txRetracted, removalKind(h, first)]).toEqual([2, "replaced"]);
    expect([second.txRetracted, removalKind(h, second)]).toEqual([3, "retracted"]);
  });
});
