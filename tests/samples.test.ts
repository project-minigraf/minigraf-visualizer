import { describe, expect, it } from "vitest";
import { pinQuery } from "../src/lib/datalog";
import { query, runScript } from "../src/lib/engine";
import { formatPermalink, parsePermalink } from "../src/lib/permalink";
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
  it("round-trips sample, cursor and entity", () => {
    const hash = formatPermalink("careers", 6, { kind: "at", ms: Date.UTC(2023, 5, 1) }, ":alice");
    expect(hash).toBe("#sample=careers&tx=6&vt=2023-06-01T00%3A00%3A00Z&e=%3Aalice");
    expect(parsePermalink(hash)).toEqual({
      sample: "careers",
      tx: 6,
      validAt: { kind: "at", ms: Date.UTC(2023, 5, 1) },
      entity: uuidV5Oid(":alice"),
    });
  });

  it("ignores hashes without a sample and bad values", () => {
    expect(parsePermalink("")).toBeNull();
    expect(parsePermalink("#tx=3")).toBeNull();
    expect(parsePermalink("#sample=x&tx=-1&vt=nope")).toEqual({ sample: "x", tx: null, validAt: null, entity: null });
    expect(parsePermalink("#sample=x&vt=any")?.validAt).toEqual({ kind: "any" });
  });
});
