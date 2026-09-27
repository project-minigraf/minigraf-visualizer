import { useCallback, useEffect, useRef, useState } from "react";
import { useCursor, useNow } from "./app/useCursor";
import { useWorkspace } from "./app/useWorkspace";
import { useViewModel } from "./app/viewModel";
import { BitemporalMap } from "./components/BitemporalMap";
import { FactsTable } from "./components/FactsTable";
import { GraphView } from "./components/GraphView";
import { Inspector } from "./components/Inspector";
import { QueryConsole } from "./components/QueryConsole";
import { TimeControls } from "./components/TimeControls";
import { TxLog } from "./components/TxLog";
import type { ValidAt } from "./lib/datalog";
import { formatPermalink, parsePermalink } from "./lib/permalink";
import { sampleById, SAMPLES } from "./samples";

type View = "graph" | "map" | "facts";
type Side = "inspect" | "query";

function useTheme(): [string, () => void] {
  const [theme, setTheme] = useState<string>(() => {
    try {
      return localStorage.getItem("mgv:theme") ?? "system";
    } catch {
      return "system";
    }
  });
  useEffect(() => {
    if (theme === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("mgv:theme", theme);
    } catch {
      // Storage can be blocked; the theme still applies for this visit.
    }
  }, [theme]);
  const cycle = () => setTheme((t) => (t === "system" ? "dark" : t === "dark" ? "light" : "system"));
  return [theme, cycle];
}

export default function App() {
  const pendingLink = useRef(parsePermalink(window.location.hash));
  const ws = useWorkspace(pendingLink.current?.sample ?? null);
  const now = useNow(ws.revision);
  const cursor = useCursor(ws.history.maxTx, ws.revision);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<View>("graph");
  const [side, setSide] = useState<Side>("inspect");
  const [keywordNodes, setKeywordNodes] = useState(true);
  const [showGhosts, setShowGhosts] = useState(false);
  const [notice, setNotice] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const [theme, cycleTheme] = useTheme();
  const fileRef = useRef<HTMLInputElement>(null);

  const vm = useViewModel(ws.history, ws.aliases, keywordNodes, cursor.asOf, cursor.validAt, now);
  const sample = ws.sampleId ? sampleById(ws.sampleId) : undefined;

  // Drop the selection when the data no longer has that node.
  useEffect(() => {
    if (selected && !vm.model.nodes.has(selected)) setSelected(null);
  }, [selected, vm.model]);

  // Apply a shared link once its sample has loaded.
  useEffect(() => {
    const link = pendingLink.current;
    if (!link) return;
    if (ws.sampleId !== link.sample || ws.history.maxTx === 0) {
      // The link was declined or its sample is unknown: forget it.
      if (ws.status.kind === "ready") pendingLink.current = null;
      return;
    }
    pendingLink.current = null;
    cursor.setBoth(link.tx ?? ws.history.maxTx, link.validAt ?? cursor.validAt);
    if (link.entity && vm.model.nodes.has(link.entity)) setSelected(link.entity);
    // Runs when a new history arrives; the cursor and model are read, not tracked.
  }, [ws.revision, ws.status.kind]);

  // Keep the address bar in step with the view while a sample is unedited.
  useEffect(() => {
    if (ws.status.kind !== "ready" || pendingLink.current) return;
    const hash = ws.sampleId
      ? formatPermalink(ws.sampleId, cursor.asOf, cursor.validAt, selected ? vm.model.labelOf(selected) : null)
      : "";
    if (hash !== window.location.hash) {
      history.replaceState(null, "", `${window.location.pathname}${window.location.search}${hash}`);
    }
  }, [ws.status.kind, ws.sampleId, cursor.asOf, cursor.validAt, selected, vm.model]);

  const setCursor = useCallback((asOf: number, validAt: ValidAt) => cursor.setBoth(asOf, validAt), [cursor]);

  // Keyboard: arrows step transactions, space plays.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.key === "ArrowLeft") {
        cursor.step(-1);
        e.preventDefault();
      } else if (e.key === "ArrowRight") {
        cursor.step(1);
        e.preventDefault();
      } else if (e.key === " ") {
        cursor.togglePlay();
        e.preventDefault();
      } else if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cursor]);

  const guard = async (job: () => Promise<void>) => {
    setNotice(null);
    try {
      await job();
    } catch (e) {
      setNotice({ kind: "error", text: e instanceof Error ? e.message : String(e) });
    }
  };

  const onImport = async (file: File) => {
    await guard(async () => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      await ws.importGraph(bytes, file.name);
      setSelected(null);
      setNotice({ kind: "info", text: `Opened ${file.name}.` });
    });
  };

  const onExport = () => {
    const bytes = ws.exportGraph();
    if (!bytes) return;
    const blob = new Blob([bytes.slice().buffer], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(ws.sampleId ?? "workspace").replace(/[^a-z0-9-]+/gi, "-")}.graph`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  if (ws.status.kind === "error") {
    return (
      <div className="boot error-screen">
        <h1>Could not start Minigraf</h1>
        <p>{ws.status.message}</p>
        <p className="muted">This app needs a browser with WebAssembly support.</p>
      </div>
    );
  }

  const booting = ws.status.kind === "booting";

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true">
            <circle cx="9" cy="10" r="4" className="brand-a" />
            <circle cx="23" cy="9" r="3.2" className="brand-b" />
            <circle cx="17" cy="23" r="4.6" className="brand-c" />
            <path d="M12.5 12.3 15 19M20.6 11.4 18.6 18.6M13 10h6.8" className="brand-l" />
          </svg>
          <div>
            <h1>Minigraf Visualizer</h1>
            <span className="muted small">{booting ? "Loading engine…" : ws.source}</span>
          </div>
        </div>

        <div className="topbar-actions">
          <label className="select-label">
            <span className="sr-only">Load a sample</span>
            <select
              value=""
              onChange={(e) => {
                const id = e.target.value;
                if (!id) return;
                void guard(async () => {
                  await ws.loadSample(id);
                  setSelected(null);
                });
              }}
              disabled={booting}
            >
              <option value="">Load sample…</option>
              {SAMPLES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          </label>
          <button className="btn" onClick={() => fileRef.current?.click()} disabled={booting} title="Open a checkpointed .graph file">
            Open .graph
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".graph,application/octet-stream"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void onImport(f);
            }}
          />
          <button className="btn" onClick={onExport} disabled={booting} title="Download this database as a .graph file">
            Save .graph
          </button>
          <button
            className="btn ghost"
            disabled={booting}
            onClick={() => {
              if (confirm("Start from an empty database? The current workspace will be replaced.")) {
                void guard(async () => {
                  await ws.clear();
                  setSelected(null);
                  setSide("query");
                });
              }
            }}
          >
            New
          </button>
          <button className="btn ghost" onClick={cycleTheme} title="Theme" aria-label={`Theme: ${theme}`}>
            {theme === "dark" ? "☾" : theme === "light" ? "☀" : "◐"}
          </button>
          <a className="btn ghost" href="https://github.com/project-minigraf/minigraf" target="_blank" rel="noreferrer">
            Minigraf ↗
          </a>
        </div>
      </header>

      {notice && (
        <div className={`notice ${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>
          <span>{notice.text}</span>
          <button className="link" onClick={() => setNotice(null)} aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}
      {ws.progress && ws.progress.total > 0 && (
        <div className="progress" role="progressbar" aria-valuenow={ws.progress.done} aria-valuemax={ws.progress.total}>
          Reading history… tx {ws.progress.done} of {ws.progress.total}
          <span style={{ width: `${(ws.progress.done / ws.progress.total) * 100}%` }} />
        </div>
      )}

      <main className="workspace">
        <TxLog vm={vm} onPick={cursor.setAsOf} onSelectEntity={(id) => setSelected(id)} />

        <section className="center panel" aria-label="Views">
          <div className="tabs" role="tablist">
            {(
              [
                ["graph", "Graph"],
                ["map", "Bitemporal map"],
                ["facts", "Facts"],
              ] as const
            ).map(([k, label]) => (
              <button key={k} role="tab" aria-selected={view === k} className={view === k ? "on" : ""} onClick={() => setView(k)}>
                {label}
              </button>
            ))}
            <span className="grow" />
            {view === "graph" && (
              <>
                <label className="check small">
                  <input type="checkbox" checked={keywordNodes} onChange={(e) => setKeywordNodes(e.target.checked)} />
                  Keyword values as nodes
                </label>
                <label className="check small">
                  <input type="checkbox" checked={showGhosts} onChange={(e) => setShowGhosts(e.target.checked)} />
                  Show hidden nodes
                </label>
              </>
            )}
          </div>
          <div className="view-body">
            {booting ? (
              <div className="boot">Loading the Minigraf WebAssembly engine…</div>
            ) : ws.history.maxTx === 0 ? (
              <div className="empty">
                <h2>Empty database</h2>
                <p>
                  Write some facts in the query console, open a <code>.graph</code> file, or load a sample.
                </p>
              </div>
            ) : view === "graph" ? (
              <GraphView vm={vm} selected={selected} onSelect={setSelected} showGhosts={showGhosts} />
            ) : view === "map" ? (
              <BitemporalMap vm={vm} selected={selected} onSelect={setSelected} onCursor={setCursor} />
            ) : (
              <FactsTable vm={vm} onSelect={setSelected} />
            )}
          </div>
        </section>

        <aside className="side panel" aria-label="Details">
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={side === "inspect"} className={side === "inspect" ? "on" : ""} onClick={() => setSide("inspect")}>
              Inspector
            </button>
            <button role="tab" aria-selected={side === "query"} className={side === "query" ? "on" : ""} onClick={() => setSide("query")}>
              Query
            </button>
          </div>
          <div className="side-body">
            {side === "inspect" ? (
              <Inspector
                vm={vm}
                selected={selected}
                onSelect={setSelected}
                onCursor={setCursor}
                onShowMap={() => setView("map")}
                sample={sample}
                source={ws.source}
              />
            ) : (
              <QueryConsole
                key={ws.generation}
                vm={vm}
                examples={sample?.queries ?? []}
                run={(src, pinned) => ws.run(src, pinned ? { asOf: cursor.asOf, validAt: cursor.validAt } : null)}
                onSelect={(id) => {
                  setSelected(id);
                  setSide("inspect");
                }}
              />
            )}
          </div>
        </aside>
      </main>

      <footer className="controls panel">
        <TimeControls history={ws.history} cursor={cursor} now={now} />
      </footer>
    </div>
  );
}
