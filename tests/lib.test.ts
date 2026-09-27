import { describe, expect, it } from "vitest";
import { entityKeywords, pinQuery, splitForms, toMinigrafTime } from "../src/lib/datalog";
import { keywordToEntityId, uuidV5Oid } from "../src/lib/uuid5";

describe("uuid v5 keyword ids", () => {
  it("matches the ids Minigraf assigns to keyword entities", () => {
    // Values observed from the real engine.
    expect(uuidV5Oid(":alice")).toBe("e340ebba-e050-5d3b-8c2e-5388ce184a79");
    expect(uuidV5Oid(":bob")).toBe("2340101d-cda1-5ebe-a64b-0d27506374ef");
    expect(uuidV5Oid(":carol")).toBe("bb8e4db4-5f3b-579f-accb-f19c3f3c3031");
  });

  it("treats a UUID keyword as that UUID", () => {
    expect(keywordToEntityId(":550E8400-e29b-41d4-a716-446655440000")).toBe("550e8400-e29b-41d4-a716-446655440000");
  });
});

describe("splitForms", () => {
  it("splits top-level forms and skips comments", () => {
    const src = `; comment (with parens)
# demo-style comment (also parens)
(transact [[:a :name "x (y)"]])
  # indented comment
(query [:find ?n :where [?e :name ?n]]) ; trailing`;
    expect(splitForms(src)).toEqual([
      `(transact [[:a :name "x (y)"]])`,
      `(query [:find ?n :where [?e :name ?n]])`,
    ]);
  });

  it("keeps #uuid literals and escaped quotes", () => {
    const src = `(transact [[:a :ref #uuid "550e8400-e29b-41d4-a716-446655440000"] [:a :s "say \\"hi\\")"]])`;
    expect(splitForms(src)).toEqual([src]);
  });

  it("rejects an unclosed form", () => {
    expect(() => splitForms("(query [:find ?x")).toThrow(/Unbalanced/);
  });
});

describe("pinQuery", () => {
  it("adds as-of and valid-at to a query", () => {
    const q = "(query [:find ?n :where [?e :name ?n]])";
    expect(pinQuery(q, 3, { kind: "at", ms: Date.UTC(2024, 0, 15) })).toBe(
      '(query [:as-of 3 :valid-at "2024-01-15T00:00:00Z" :find ?n :where [?e :name ?n]])',
    );
    expect(pinQuery(q, 2, { kind: "any" })).toBe("(query [:as-of 2 :any-valid-time :find ?n :where [?e :name ?n]])");
    expect(pinQuery(q, null, { kind: "now" })).toBe(q);
  });

  it("keeps clauses the author wrote", () => {
    const q = "(query [:find ?n :as-of 1 :any-valid-time :where [?e :name ?n]])";
    expect(pinQuery(q, 5, { kind: "at", ms: 0 })).toBe(q);
  });

  it("leaves writes alone", () => {
    const t = "(transact [[:a :b 1]])";
    expect(pinQuery(t, 1, { kind: "any" })).toBe(t);
  });
});

describe("helpers", () => {
  it("formats timestamps as Minigraf accepts them", () => {
    expect(toMinigrafTime(Date.UTC(2023, 5, 1, 12, 30, 15, 999))).toBe("2023-06-01T12:30:15Z");
  });

  it("finds entity keywords in fact vectors", () => {
    expect(entityKeywords('(transact [[:alice :name "A"] [:bob :friend :alice]])')).toEqual([":alice", ":bob"]);
  });
});
