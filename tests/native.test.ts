import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractHistory } from "../src/lib/history";
import { openMemory } from "./wasm";

describe("native .graph files", () => {
  it("opens a file written by the native Minigraf REPL and rebuilds its history", async () => {
    const bytes = new Uint8Array(readFileSync(new URL("./fixtures/native-v2.0.2.graph", import.meta.url)));
    const db = openMemory();
    await db.importGraph(bytes);
    const h = await extractHistory(db, openMemory);

    expect(h.maxTx).toBe(4);
    expect(h.txs.map((t) => [t.asserted.length, t.retracted.length])).toEqual([
      [1, 0],
      [1, 0],
      [1, 0],
      [0, 1],
    ]);
    const byValue = new Map([...h.facts.values()].map((f) => [f.v, f]));
    expect(byValue.get(":techcorp")).toMatchObject({
      txAsserted: 1,
      txRetracted: null,
      validFrom: Date.UTC(2020, 0, 1),
      validTo: Date.UTC(2023, 5, 1),
    });
    expect(byValue.get(":startupco")).toMatchObject({ txAsserted: 2, txRetracted: 4, validTo: null });
    expect(byValue.get("Alice")).toMatchObject({ txAsserted: 3, txRetracted: null });
  });
});
