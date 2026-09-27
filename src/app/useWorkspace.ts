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

/** Where an unedited workspace came from. Links can reopen it. */
export type Origin = { kind: "sample"; id: string } | { kind: "script"; script: string; title: string } | null;

/** What a shared link asks the app to open. */
export type LinkRequest = { kind: "sample"; id: string } | { kind: "script"; script: string; title: string };

type Meta = { aliases: Map<string, string>; source: string; origin: Origin };

export interface Workspace {
  status: Status;
  history: History;
  aliases: Map<string, string>;
  source: string;
  sampleId: string | null;
  origin: Origin;
  /** Set when a shared link's script failed to run. */
  linkError: string | null;
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

/** A shared link (`initial`) wins over the saved workspace. */
export function useWorkspace(initial: LinkRequest | null = null): Workspace {
  const dbRef = useRef<MinigrafDb | null>(null);
  const rulesRef = useRef<string[]>([]);
  // All database work goes through this chain so operations never overlap.
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const [status, setStatus] = useState<Status>({ kind: "booting" });
  const [history, setHistory] = useState<History>(emptyHistory);
  const [aliases, setAliases] = useState<Map<string, string>>(new Map());
  const [source, setSource] = useState("");
  const [origin, setOrigin] = useState<Origin>(null);
  const sampleId = origin?.kind === "sample" ? origin.id : null;
  const [progress, setProgress] = useState<Progress | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [generation, setGeneration] = useState(0);
  const metaRef = useRef<Meta>({ aliases, source, origin });
  metaRef.current = { aliases, source, origin };

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

  const persist = useCallback(async (meta: Meta) => {
    const db = dbRef.current;
    if (!db) return;
    await saveWorkspace({
      graph: db.exportGraph(),
      aliases: [...meta.aliases],
      source: meta.source,
      sampleId: meta.origin?.kind === "sample" ? meta.origin.id : null,
      script: meta.origin?.kind === "script" ? { text: meta.origin.script, title: meta.origin.title } : undefined,
      rules: rulesRef.current,
    });
  }, []);

  /** Swap in a new database and rebuild everything from it. */
  const replace = useCallback(
    async (db: MinigrafDb, meta: Meta, rules: string[]) => {
      dbRef.current?.free();
      dbRef.current = db;
      rulesRef.current = rules;
      setAliases(meta.aliases);
      setSource(meta.source);
      setOrigin(meta.origin);
      setGeneration((g) => g + 1);
      await rebuild();
      await persist(meta);
    },
    [rebuild, persist],
  );

  /** Run a Datalog script in a fresh database and make it the workspace. */
  const buildScript = useCallback(
    async (script: string, title: string, origin: Origin) => {
      const db = openInMemory();
      try {
        await runScript(db, script);
      } catch (e) {
        db.free();
        throw e;
      }
      const rules = splitForms(script).filter((f) => formKind(f) === "rule");
      await replace(db, { aliases: aliasesFromSource(script), source: title, origin }, rules);
    },
    [replace],
  );

  const buildSample = useCallback(
    async (id: string) => {
      const sample = sampleById(id);
      if (!sample) throw new Error(`Unknown sample ${id}`);
      await buildScript(sample.script, sample.title, { kind: "sample", id });
    },
    [buildScript],
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
      setOrigin(
        saved.sampleId
          ? { kind: "sample", id: saved.sampleId }
          : saved.script
            ? { kind: "script", script: saved.script.text, title: saved.script.title }
            : null,
      );
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
        const usable = initial !== null && (initial.kind === "script" || sampleById(initial.id) !== undefined);
        const savedIsOwnWork = saved !== null && !saved.sampleId && !saved.script;
        const openLink =
          usable && (!savedIsOwnWork || confirm("Open the shared link? It replaces your current workspace."));
        if (openLink && initial?.kind === "sample") {
          await buildSample(initial.id);
        } else if (openLink && initial?.kind === "script") {
          try {
            await buildScript(initial.script, initial.title, initial);
          } catch (e) {
            // A broken link should not leave the user with nothing to look at.
            setLinkError(`The link's Datalog did not run: ${message(e)}`);
            if (!saved || !(await restore(saved))) await buildSample(DEFAULT_SAMPLE);
          }
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
    // Boot runs once; `initial` is only read on the first render.
  }, [enqueue, restore, buildSample, buildScript]);

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
        await replace(db, { aliases: new Map(), source: name, origin: null }, []);
      }),
    [enqueue, replace],
  );

  const exportGraph = useCallback(() => dbRef.current?.exportGraph() ?? null, []);

  const clear = useCallback(
    () => enqueue(() => replace(openInMemory(), { aliases: new Map(), source: "Empty database", origin: null }, [])),
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
          meta.origin = null;
          if (!meta.source.endsWith("(edited)")) meta.source = `${meta.source || "Workspace"} (edited)`;
          setAliases(meta.aliases);
          setOrigin(null);
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
    origin,
    linkError,
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
