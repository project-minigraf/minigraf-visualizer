import { useMemo, useState } from "react";
import type { ViewModel } from "../app/viewModel";
import { formatRange } from "../lib/format";
import { formatValue } from "../lib/graph";
import type { FactVersion } from "../lib/history";

interface Props {
  vm: ViewModel;
  onSelect(id: string): void;
}

type Scope = "visible" | "changed" | "all";

export function FactsTable({ vm, onSelect }: Props) {
  const { history, model } = vm;
  const [scope, setScope] = useState<Scope>("visible");
  const [filter, setFilter] = useState("");

  const rows = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const out: { f: FactVersion; state: string }[] = [];
    for (const f of history.facts.values()) {
      const now = vm.visible.has(f.key);
      const before = vm.previous.has(f.key);
      const state = now ? (before ? "visible" : "added") : before ? "removed" : "hidden";
      if (scope === "visible" && !now) continue;
      if (scope === "changed" && (state === "visible" || state === "hidden")) continue;
      if (needle) {
        const text = `${model.labelOf(f.e)} ${f.a} ${formatValue(f.v, model)}`.toLowerCase();
        if (!text.includes(needle)) continue;
      }
      out.push({ f, state });
    }
    return out.sort(
      (a, b) => model.labelOf(a.f.e).localeCompare(model.labelOf(b.f.e)) || a.f.a.localeCompare(b.f.a) || a.f.txAsserted - b.f.txAsserted,
    );
  }, [history, model, vm.visible, vm.previous, scope, filter]);

  return (
    <div className="facts-view">
      <div className="map-toolbar">
        <div className="segmented" role="radiogroup" aria-label="Which facts">
          {(
            [
              ["visible", "At cursor"],
              ["changed", "Changed by this tx"],
              ["all", "All versions"],
            ] as const
          ).map(([k, label]) => (
            <button key={k} role="radio" aria-checked={scope === k} className={scope === k ? "on" : ""} onClick={() => setScope(k)}>
              {label}
            </button>
          ))}
        </div>
        <input type="search" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter facts" />
        <span className="muted small grow">{rows.length} rows</span>
      </div>
      <div className="table-wrap">
        <table className="grid-table">
          <thead>
            <tr>
              <th>Entity</th>
              <th>Attribute</th>
              <th>Value</th>
              <th>Valid</th>
              <th>Recorded</th>
              <th>At cursor</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ f, state }) => (
              <tr key={f.key} className={`row-${state}`}>
                <td>
                  <button className="link mono" onClick={() => onSelect(f.e)}>
                    {model.labelOf(f.e)}
                  </button>
                </td>
                <td className="mono">{f.a}</td>
                <td className="mono">{formatValue(f.v, model)}</td>
                <td className="small">{formatRange(f.validFrom, f.validTo)}</td>
                <td className="small">
                  tx {f.txAsserted}
                  {f.txRetracted !== null ? ` → ${f.txRetracted}` : ""}
                </td>
                <td>
                  <span className={`chip ${state === "added" ? "ok" : state === "removed" ? "del" : state === "visible" ? "" : "future"}`}>
                    {state}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
