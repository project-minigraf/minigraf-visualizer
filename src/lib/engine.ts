// The subset of `BrowserDb` from `@minigraf/browser` that the visualizer uses.
// Keeping it as an interface lets the tests drive the real WASM engine from
// Node (via `initSync`) and lets the app swap databases without caring where
// they came from.

import { formKind, splitForms } from "./datalog";

export interface MinigrafDb {
  execute(datalog: string): Promise<string>;
  exportGraph(): Uint8Array;
  importGraph(data: Uint8Array): Promise<void>;
  checkpoint(): Promise<void>;
  free(): void;
}

/** Opens a fresh, empty in-memory database. */
export type OpenInMemory = () => MinigrafDb;

export type Scalar = string | number | boolean | null;

export interface QueryResult {
  variables: string[];
  results: Scalar[][];
}

export type CommandResult =
  | { kind: "query"; form: string; result: QueryResult }
  | { kind: "transact"; form: string; txId: number }
  | { kind: "retract"; form: string; txId: number }
  | { kind: "rule"; form: string };

function errorText(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

export class DatalogError extends Error {
  constructor(
    message: string,
    readonly form: string,
    readonly index: number,
  ) {
    super(message);
    this.name = "DatalogError";
  }
}

/** Run a single form and decode the JSON reply. */
export async function runForm(db: MinigrafDb, form: string): Promise<CommandResult> {
  let raw: string;
  try {
    raw = await db.execute(form);
  } catch (e) {
    throw new DatalogError(errorText(e), form, 0);
  }
  const parsed = JSON.parse(raw) as {
    variables?: string[];
    results?: Scalar[][];
    transacted?: number;
    retracted?: number;
    ok?: boolean;
    error?: string;
  };
  if (parsed.error) throw new DatalogError(parsed.error, form, 0);
  if (Array.isArray(parsed.results)) {
    return { kind: "query", form, result: { variables: parsed.variables ?? [], results: parsed.results } };
  }
  if (typeof parsed.transacted === "number") return { kind: "transact", form, txId: parsed.transacted };
  if (typeof parsed.retracted === "number") return { kind: "retract", form, txId: parsed.retracted };
  return { kind: "rule", form };
}

/** Run every form in a script, in order. Stops at the first error. */
export async function runScript(db: MinigrafDb, src: string): Promise<CommandResult[]> {
  const forms = splitForms(src);
  const out: CommandResult[] = [];
  for (let i = 0; i < forms.length; i++) {
    try {
      out.push(await runForm(db, forms[i]));
    } catch (e) {
      const msg = e instanceof DatalogError ? e.message : errorText(e);
      throw new DatalogError(msg, forms[i], i);
    }
  }
  return out;
}

export async function query(db: MinigrafDb, q: string): Promise<QueryResult> {
  const r = await runForm(db, q);
  if (r.kind !== "query") throw new Error(`Expected a query, got ${r.kind}`);
  return r.result;
}

/** True if the script changes data (so the history must be rebuilt). */
export function scriptWrites(src: string): boolean {
  return splitForms(src).some((f) => {
    const k = formKind(f);
    return k === "transact" || k === "retract";
  });
}
