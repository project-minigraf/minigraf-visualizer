import { useState } from "react";
import type { RunOutcome } from "../app/useWorkspace";
import type { ViewModel } from "../app/viewModel";
import { describeValidAt } from "../lib/format";
import { formatValue } from "../lib/graph";
import type { CommandResult } from "../lib/engine";

interface Props {
  vm: ViewModel;
  examples: string[];
  run(src: string, pinned: boolean): Promise<RunOutcome>;
  onSelect(id: string): void;
}

const GENERIC_EXAMPLES = [
  "(query [:find ?a (count ?e) :where [?e ?a ?v]])",
  "(query [:find ?e ?a ?v :where [?e ?a ?v]])",
  '(transact [[:dave :person/name "Dave"] [:dave :works-at :techcorp]])',
];

export function QueryConsole({ vm, examples, run, onSelect }: Props) {
  const [src, setSrc] = useState(examples[0] ?? GENERIC_EXAMPLES[0]);
  const [pinned, setPinned] = useState(true);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<RunOutcome | null>(null);
  const [crash, setCrash] = useState<string | null>(null);

  const submit = async () => {
    if (busy || !src.trim()) return;
    setBusy(true);
    setCrash(null);
    try {
      setOutcome(await run(src, pinned));
    } catch (e) {
      setCrash(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const all = [...examples, ...GENERIC_EXAMPLES];

  return (
    <div className="console">
      <label className="console-label" htmlFor="datalog-input">
        Datalog
      </label>
      <textarea
        id="datalog-input"
        className="mono"
        value={src}
        spellCheck={false}
        rows={6}
        onChange={(e) => setSrc(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void submit();
          }
        }}
      />
      <div className="console-actions">
        <label className="check" title="Add :as-of and :valid-at from the time cursor to queries that do not set them">
          <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
          Run at the time cursor
          <span className="muted small">
            (tx {vm.asOf}, {describeValidAt(vm.validAt, vm.now)})
          </span>
        </label>
        <button className="btn primary" onClick={() => void submit()} disabled={busy}>
          {busy ? "Running…" : "Run"} <kbd>Ctrl</kbd>+<kbd>Enter</kbd>
        </button>
      </div>
      <details className="examples">
        <summary>Examples</summary>
        <ul>
          {all.map((q) => (
            <li key={q}>
              <button className="link mono" onClick={() => setSrc(q)}>
                {q}
              </button>
            </li>
          ))}
        </ul>
      </details>
      <p className="muted small">
        Writes (<code>transact</code>, <code>retract</code>) change the workspace, and the history is rebuilt. Rules
        are kept for the session.
      </p>

      {crash && <div className="error">{crash}</div>}
      {outcome && (
        <div className="results">
          {outcome.results.map((r, i) => (
            <Result key={i} r={r} vm={vm} onSelect={onSelect} />
          ))}
          {outcome.error && (
            <div className="error">
              <div>{outcome.error.message}</div>
              <pre className="mono small">{outcome.error.form}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Result({ r, vm, onSelect }: { r: CommandResult; vm: ViewModel; onSelect(id: string): void }) {
  if (r.kind === "transact" || r.kind === "retract") {
    return (
      <div className="result-note ok">
        {r.kind === "transact" ? "Transacted" : "Retracted"} (tx-id {r.txId}). The cursor moved to the new transaction.
      </div>
    );
  }
  if (r.kind === "rule") return <div className="result-note ok">Rule registered.</div>;
  const { variables, results } = r.result;
  return (
    <div className="result">
      <details className="ran">
        <summary className="muted small">
          {results.length} row{results.length === 1 ? "" : "s"}
        </summary>
        <pre className="mono small">{r.form}</pre>
      </details>
      <div className="table-wrap">
        <table className="grid-table">
          <thead>
            <tr>
              {variables.map((v) => (
                <th key={v} className="mono">
                  {v}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {results.slice(0, 500).map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => {
                  const target = vm.model.refTarget(cell);
                  return (
                    <td key={j} className="mono">
                      {target ? (
                        <button className="link mono" onClick={() => onSelect(target)} title={String(cell)}>
                          {vm.model.labelOf(target)}
                        </button>
                      ) : typeof cell === "string" && vm.history.entities.has(cell) ? (
                        <button className="link mono" onClick={() => onSelect(cell)} title={cell}>
                          {vm.model.labelOf(cell)}
                        </button>
                      ) : (
                        formatValue(cell)
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {results.length > 500 && <div className="muted small">Showing the first 500 rows.</div>}
    </div>
  );
}
