import { describe, expect, it } from "vitest";
import { pinQuery } from "../src/lib/datalog";
import { query, runScript } from "../src/lib/engine";
import { decodeScript, encodeScript, formatPermalink, parsePermalink, sameSource } from "../src/lib/permalink";
import { uuidV5Oid } from "../src/lib/uuid5";
import { SAMPLES } from "../src/samples";
import { openMemory } from "./wasm";

describe.each(SAMPLES)("sample $id queries", (sample) => {
  it("every example query runs, both plain and pinned to tx 1", async () => {
    const db = openMemory();
    await runScript(db, sample.script);
    expect(sample.queries.length).toBeGreaterThan(0);
    for (const q of sample.queries) {
      const latest = await query(db, q);
      expect(latest.variables.length).toBeGreaterThan(0);
      await query(db, pinQuery(q, 1, { kind: "any" }));
    }
    // The first example should return something at the latest transaction.
    expect((await query(db, sample.queries[0])).results.length).toBeGreaterThan(0);
  });
});

describe("permalinks", () => {
  const careers = { kind: "sample" as const, id: "careers" };

  it("round-trips sample, cursor, entity and view", () => {
    const hash = formatPermalink(careers, 6, { kind: "at", ms: Date.UTC(2023, 5, 1) }, ":alice");
    expect(hash).toBe("#sample=careers&tx=6&vt=2023-06-01T00%3A00%3A00Z&e=%3Aalice");
    expect(parsePermalink(hash)).toEqual({
      source: careers,
      tx: 6,
      validAt: { kind: "at", ms: Date.UTC(2023, 5, 1) },
      entity: uuidV5Oid(":alice"),
      view: null,
    });
    expect(formatPermalink(careers, 6, { kind: "any" }, null, "map")).toBe("#sample=careers&tx=6&vt=any&view=map");
    expect(parsePermalink("#sample=careers&view=map")?.view).toBe("map");
    expect(parsePermalink("#sample=careers&view=bogus")?.view).toBeNull();
    // Hand-written links in docs use short dates and bare keywords.
    expect(parsePermalink("#sample=careers&vt=2021-07-01&e=:alice")).toMatchObject({
      validAt: { kind: "at", ms: Date.UTC(2021, 6, 1) },
      entity: uuidV5Oid(":alice"),
    });
  });

  it("round-trips a script carried in the link, including non-ASCII text", () => {
    const script = '(transact [[:café :name "Zoë ☕"]])\n; comment (with parens)';
    const source = { kind: "script" as const, script, title: "Recipe 4 — correction" };
    const hash = formatPermalink(source, 1, { kind: "now" }, null, "map");
    expect(hash).not.toMatch(/[+/=]data/);
    expect(encodeScript(script)).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeScript(encodeScript(script))).toBe(script);
    expect(parsePermalink(hash)).toEqual({ source, tx: 1, validAt: { kind: "now" }, entity: null, view: "map" });
  });

  it("ignores hashes without a source and bad values", () => {
    expect(parsePermalink("")).toBeNull();
    expect(parsePermalink("#tx=3")).toBeNull();
    expect(parsePermalink("#data=%%%")).toBeNull();
    expect(parsePermalink("#sample=x&tx=-1&vt=nope")).toEqual({
      source: { kind: "sample", id: "x" },
      tx: null,
      validAt: null,
      entity: null,
      view: null,
    });
    expect(parsePermalink("#sample=x&vt=any")?.validAt).toEqual({ kind: "any" });
  });

  it("matches a workspace to the link that opened it", () => {
    expect(sameSource(careers, { kind: "sample", id: "careers" })).toBe(true);
    expect(sameSource(careers, { kind: "sample", id: "catalog" })).toBe(false);
    expect(sameSource({ kind: "script", script: "a", title: "x" }, { kind: "script", script: "a", title: "y" })).toBe(true);
    expect(sameSource(null, careers)).toBe(false);
  });
});
