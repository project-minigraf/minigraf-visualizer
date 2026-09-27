import { useCallback, useEffect, useRef, useState } from "react";
import { formKind, pinQuery, splitForms, type ValidAt } from "../lib/datalog";
import { DatalogError, runForm, runScript, type CommandResult, type MinigrafDb } from "../lib/engine";
import { aliasesFromSource } from "../lib/graph";
import { emptyHistory, extendHistory, extractHistory, type History } from "../lib/history";
import { loadWorkspace, saveWorkspace, type SavedWorkspace } from "../lib/persist";
import { loadEngine, openInMemory } from "../lib/wasm";
import { sampleById, SAMPLES } from "../samples";

export type Status = { kind: "booting" } | { kind: "ready" } | { kind: "error"; message: string };

export interface Progress {
  done: number;
  total: number;
}

export interface RunOutcome {
  results: CommandResult[];
  wrote: boolean;
  error: DatalogError | null;
}

export interface Workspace {
  status: Status;
  history: History;
  aliases: Map<string, string>;
  source: string;
  sampleId: string | null;
  progress: Progress | null;
  /** Bumps each time the history is rebuilt. */
  revision: number;
  /** Bumps when a different dataset is loaded (not on edits). */
  generation: number;
  loadSample(id: string): Promise<void>;
  importGraph(bytes: Uint8Array, name: string): Promise<void>;
  exportGraph(): Uint8Array | null;
  clear(): Promise<void>;
  run(src: string, pin: { asOf: number; validAt: ValidAt } | null): Promise<RunOutcome>;
}

const DEFAULT_SAMPLE = SAMPLES[0].id;

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** `initialSample` (from a shared link) wins over the saved workspace. */
export function useWorkspace(initialSample: string | null = null): Workspace {
  const dbRef = useRef<MinigrafDb | null>(null);
  const rulesRef = useRef<string[]>([]);
  // All database work goes through this chain so operations never overlap.
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const [status, setStatus] = useState<Status>({ kind: "booting" });
  const [history, setHistory] = useState<History>(emptyHistory);
  const [aliases, setAliases] = useState<Map<string, string>>(new Map());
  const [source, setSource] = useState("");
  const [sampleId, setSampleId] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [revision, setRevision] = useState(0);
  const [generation, setGeneration] = useState(0);
  const metaRef = useRef({ aliases, source, sampleId });
  metaRef.current = { aliases, source, sampleId };

  const enqueue = useCallback(<T,>(job: () => Promise<T>): Promise<T> => {
    const next = queue.current.then(job, job);
    queue.current = next.catch(() => undefined);
    return next;
  }, []);

  const historyRef = useRef<History>(history);

  /** Read the history from scratch, or (`incremental`) only the new transactions. */
  const rebuild = useCallback(async (incremental = false) => {
    const db = dbRef.current;
    if (!db) return;
    setProgress({ done: 0, total: 0 });
    try {
      const options = {
        onProgress: (done: number, total: number) => {
          if (total > 20) setProgress({ done, total });
        },
      };
      const h = incremental
        ? await extendHistory(db, openInMemory, historyRef.current, options)
        : await extractHistory(db, openInMemory, options);
      historyRef.current = h;
      setHistory(h);
      setRevision((r) => r + 1);
    } finally {
      setProgress(null);
    }
  }, []);

  const persist = useCallback(async (meta: { aliases: Map<string, string>; source: string; sampleId: string | null }) => {
    const db = dbRef.current;
    if (!db) return;
    await saveWorkspace({
      graph: db.exportGraph(),
      aliases: [...meta.aliases],
      source: meta.source,
      sampleId: meta.sampleId,
      rules: rulesRef.current,
    });
  }, []);

  /** Swap in a new database and rebuild everything from it. */
  const replace = useCallback(
    async (db: MinigrafDb, meta: { aliases: Map<string, string>; source: string; sampleId: string | null }, rules: string[]) => {
      dbRef.current?.free();
      dbRef.current = db;
      rulesRef.current = rules;
      setAliases(meta.aliases);
      setSource(meta.source);
      setSampleId(meta.sampleId);
      setGeneration((g) => g + 1);
      await rebuild();
      await persist(meta);
    },
    [rebuild, persist],
  );

  const buildSample = useCallback(
    async (id: string) => {
      const sample = sampleById(id);
      if (!sample) throw new Error(`Unknown sample ${id}`);
      const db = openInMemory();
      await runScript(db, sample.script);
      const rules = splitForms(sample.script).filter((f) => formKind(f) === "rule");
      await replace(db, { aliases: aliasesFromSource(sample.script), source: sample.title, sampleId: id }, rules);
    },
    [replace],
  );

  /** Reopen a saved workspace. Returns false if it cannot be read. */
  const restore = useCallback(
    async (saved: SavedWorkspace): Promise<boolean> => {
      const db = openInMemory();
      try {
        await db.importGraph(saved.graph);
      } catch {
        db.free();
        return false;
      }
      for (const rule of saved.rules ?? []) await runForm(db, rule).catch(() => undefined);
      dbRef.current = db;
      rulesRef.current = saved.rules ?? [];
      setAliases(new Map(saved.aliases));
      setSource(saved.source);
      setSampleId(saved.sampleId);
      await rebuild();
      return true;
    },
    [rebuild],
  );

  // Boot: load the engine, then restore the saved workspace or load a sample.
  useEffect(() => {
    let cancelled = false;
    enqueue(async () => {
      try {
        await loadEngine();
        if (cancelled) return;
        const saved = await loadWorkspace();
        // A shared link opens its sample, but never silently replaces the user's own edits.
        const openLink =
          initialSample !== null &&
          sampleById(initialSample) !== undefined &&
          (!saved || saved.sampleId !== null || confirm("Open the shared sample? It replaces your current workspace."));
        if (openLink && initialSample) {
          await buildSample(initialSample);
        } else if (!saved || !(await restore(saved))) {
          await buildSample(DEFAULT_SAMPLE);
        }
        setStatus({ kind: "ready" });
      } catch (e) {
        setStatus({ kind: "error", message: message(e) });
      }
    });
    return () => {
      cancelled = true;
    };
    // Boot runs once; initialSample is only read on the first render.
  }, [enqueue, restore, buildSample]);

  const loadSample = useCallback((id: string) => enqueue(() => buildSample(id)), [enqueue, buildSample]);

  const importGraph = useCallback(
    (bytes: Uint8Array, name: string) =>
      enqueue(async () => {
        const db = openInMemory();
        try {
          await db.importGraph(bytes);
        } catch (e) {
          db.free();
          throw new Error(
            `Could not open ${name}: ${message(e)}. The file must be a checkpointed Minigraf .graph file (no pending .wal sidecar).`,
          );
        }
        await replace(db, { aliases: new Map(), source: name, sampleId: null }, []);
      }),
    [enqueue, replace],
  );

  const exportGraph = useCallback(() => dbRef.current?.exportGraph() ?? null, []);

  const clear = useCallback(
    () => enqueue(() => replace(openInMemory(), { aliases: new Map(), source: "Empty database", sampleId: null }, [])),
    [enqueue, replace],
  );

  const run = useCallback(
    (src: string, pin: { asOf: number; validAt: ValidAt } | null) =>
      enqueue(async (): Promise<RunOutcome> => {
        const db = dbRef.current;
        if (!db) throw new Error("Database is not ready");
        const results: CommandResult[] = [];
        let wrote = false;
        let error: DatalogError | null = null;
        let forms: string[] = [];
        try {
          forms = splitForms(src);
        } catch (e) {
          error = new DatalogError(message(e), src, 0);
        }
        for (let i = 0; i < forms.length && !error; i++) {
          const form = pin ? pinQuery(forms[i], pin.asOf, pin.validAt) : forms[i];
          try {
            const r = await runForm(db, form);
            results.push(r);
            if (r.kind === "transact" || r.kind === "retract") wrote = true;
            if (r.kind === "rule") rulesRef.current = [...rulesRef.current, form];
          } catch (e) {
            error = new DatalogError(message(e), form, i);
          }
        }
        const meta = { ...metaRef.current };
        if (wrote) {
          meta.aliases = aliasesFromSource(src, new Map(meta.aliases));
          meta.sampleId = null;
          if (!meta.source.endsWith("(edited)")) meta.source = `${meta.source || "Workspace"} (edited)`;
          setAliases(meta.aliases);
          setSampleId(null);
          setSource(meta.source);
          await rebuild(true);
        }
        if (wrote || results.some((r) => r.kind === "rule")) await persist(meta);
        return { results, wrote, error };
      }),
    [enqueue, rebuild, persist],
  );

  return {
    status,
    history,
    aliases,
    source,
    sampleId,
    progress,
    revision,
    generation,
    loadSample,
    importGraph,
    exportGraph,
    clear,
    run,
  };
}
