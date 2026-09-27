import { useMemo } from "react";
import type { ViewModel } from "../app/viewModel";
import type { ValidAt } from "../lib/datalog";
import { formatRange } from "../lib/format";
import { formatValue, isEdgeFact } from "../lib/graph";
import type { FactVersion } from "../lib/history";
import { recordedAsOf, removalKind } from "../lib/snapshot";
import type { Sample } from "../samples";

interface Props {
  vm: ViewModel;
  selected: string | null;
  onSelect(id: string | null): void;
  onCursor(asOf: number, validAt: ValidAt): void;
  onShowMap(): void;
  sample: Sample | undefined;
  source: string;
}

type Status = { label: string; cls: string };

function statusOf(f: FactVersion, vm: ViewModel): Status {
  if (vm.visible.has(f.key)) return { label: "visible", cls: "ok" };
  if (f.txAsserted > vm.asOf) return { label: `recorded at tx ${f.txAsserted}`, cls: "future" };
  if (!recordedAsOf(f, vm.asOf)) return { label: `${removalKind(vm.history, f)} at tx ${f.txRetracted}`, cls: "del" };
  return { label: "not valid at cursor", cls: "warn" };
}

export function Inspector({ vm, selected, onSelect, onCursor, onShowMap, sample, source }: Props) {
  const { history, model } = vm;

  const versions = useMemo(() => {
    if (!selected) return [];
    return [...history.facts.values()]
      .filter((f) => f.e === selected)
      .sort((a, b) => a.a.localeCompare(b.a) || a.txAsserted - b.txAsserted || a.validFrom - b.validFrom);
  }, [history, selected]);

  const incoming = useMemo(() => {
    if (!selected) return [];
    return [...history.facts.values()].filter((f) => vm.visible.has(f.key) && model.refTarget(f.v) === selected);
  }, [history, model, selected, vm.visible]);

  if (!selected) {
    const entities = [...model.nodes.values()].filter((n) => !n.stub).length;
    return (
      <div className="inspector overview">
        <h2>{source || "Workspace"}</h2>
        {sample && <p>{sample.summary}</p>}
        <dl className="stats">
          <div>
            <dt>Transactions</dt>
            <dd>{history.maxTx}</dd>
          </div>
          <div>
            <dt>Fact versions</dt>
            <dd>{history.facts.size}</dd>
          </div>
          <div>
            <dt>Entities</dt>
            <dd>{entities}</dd>
          </div>
          <div>
            <dt>Attributes</dt>
            <dd>{history.attributes.length}</dd>
          </div>
        </dl>
        {sample && (
          <p className="hint">
            <strong>Try this:</strong> {sample.hint}
          </p>
        )}
        <h3>Reading the picture</h3>
        <ul className="explain">
          <li>
            <strong>Transaction time</strong> is when a fact was written to the database. Minigraf numbers writes 1, 2, 3… and
            you query the past with <code>:as-of N</code>. Retracting never deletes: an old fact is still there as of earlier
            transactions.
          </li>
          <li>
            <strong>Valid time</strong> is when a fact was true in the real world. Each fact has a range{" "}
            <code>[valid-from, valid-to)</code> that you query with <code>:valid-at</code>. Leave it out to ask about now.
          </li>
          <li>
            The graph shows what a query at the cursor sees. Green marks what the current transaction added. Red marks what it
            removed.
          </li>
          <li>
            In the <strong>bitemporal map</strong> each fact version is a box: valid time across, transaction time up. A box
            that stops below the top was retracted.
          </li>
        </ul>
        <p className="muted small">Select a node or a fact to see its full history.</p>
      </div>
    );
  }

  const node = model.nodes.get(selected);
  const current = versions.filter((f) => vm.visible.has(f.key));
  const byAttr = new Map<string, FactVersion[]>();
  for (const f of versions) {
    const list = byAttr.get(f.a);
    if (list) list.push(f);
    else byAttr.set(f.a, [f]);
  }

  const ref = (f: FactVersion) => {
    const target = model.refTarget(f.v);
    if (!target) return <span className="mono">{formatValue(f.v, model)}</span>;
    return (
      <button className="link mono" onClick={() => onSelect(target)}>
        {model.labelOf(target)}
      </button>
    );
  };

  return (
    <div className="inspector">
      <div className="inspector-head">
        <div>
          <h2 className="mono">{node?.label ?? selected}</h2>
          <div className="muted small mono selectable">{selected}</div>
        </div>
        <button className="btn small" onClick={() => onSelect(null)} aria-label="Close inspector">
          ✕
        </button>
      </div>
      {node?.stub && (
        <p className="muted small">
          This keyword is used as a value but never as an entity, so it has no attributes of its own.
        </p>
      )}

      <section>
        <h3>At the cursor</h3>
        {current.length === 0 && incoming.length === 0 ? (
          <p className="muted small">Nothing about this entity is visible at the cursor.</p>
        ) : (
          <table className="kv wide">
            <tbody>
              {current.map((f) => (
                <tr key={f.key} className={vm.previous.has(f.key) ? "" : "row-added"}>
                  <td className="mono attr">{f.a}</td>
                  <td>{ref(f)}</td>
                </tr>
              ))}
              {incoming.map((f) => (
                <tr key={`in-${f.key}`}>
                  <td className="mono attr">
                    ← {f.a}
                  </td>
                  <td>
                    <button className="link mono" onClick={() => onSelect(f.e)}>
                      {model.labelOf(f.e)}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <div className="section-head">
          <h3>Full history</h3>
          <button className="btn small" onClick={onShowMap}>
            Show on map
          </button>
        </div>
        {versions.length === 0 && <p className="muted small">No facts recorded for this entity.</p>}
        {[...byAttr].map(([attr, list]) => (
          <div key={attr} className="attr-history">
            <div className="mono attr">
              {attr} {isEdgeFact(model, list[0]) ? <span className="muted small">(ref)</span> : null}
            </div>
            <ol>
              {list.map((f) => {
                const s = statusOf(f, vm);
                return (
                  <li key={f.key}>
                    <button
                      className="version"
                      title="Move the cursor to where this version became visible"
                      onClick={() => onCursor(f.txAsserted, { kind: "at", ms: f.validFrom })}
                    >
                      <span className={`value mono${s.cls === "del" ? " struck" : ""}`}>{formatValue(f.v, model)}</span>
                      <span className="muted small">
                        valid {formatRange(f.validFrom, f.validTo)} · tx {f.txAsserted}
                        {f.txRetracted !== null ? ` → ${removalKind(history, f)} tx ${f.txRetracted}` : ""}
                      </span>
                      <span className={`chip ${s.cls}`}>{s.label}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
      </section>
    </div>
  );
}
