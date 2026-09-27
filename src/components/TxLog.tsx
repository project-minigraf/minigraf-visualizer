import { useEffect, useRef } from "react";
import type { ViewModel } from "../app/viewModel";
import { formatDateTime, formatRange } from "../lib/format";
import { formatValue } from "../lib/graph";

interface Props {
  vm: ViewModel;
  onPick(asOf: number): void;
  onSelectEntity(id: string): void;
}

export function TxLog({ vm, onPick, onSelectEntity }: Props) {
  const { history, model, asOf } = vm;
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    // Scroll only the list, never the page (scrollIntoView would move the page on phones).
    const list = listRef.current;
    const el = list?.querySelector<HTMLElement>(`[data-tx="${asOf}"]`);
    if (!list || !el) return;
    const top = el.offsetTop;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (top + el.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top + el.offsetHeight - list.clientHeight;
  }, [asOf]);

  return (
    <aside className="panel txlog" aria-label="Transaction log">
      <header className="panel-head">
        <h2>Transactions</h2>
        <span className="muted small">{history.maxTx} total</span>
      </header>
      <ol className="tx-list" ref={listRef}>
        <li data-tx={0} className={`tx-item${asOf === 0 ? " current" : ""}`}>
          <button className="tx-head" onClick={() => onPick(0)}>
            <span className="tx-num">tx 0</span>
            <span className="muted small grow">empty database</span>
          </button>
        </li>
        {history.txs.map((t) => {
          const current = t.count === asOf;
          const future = t.count > asOf;
          return (
            <li key={t.count} data-tx={t.count} className={`tx-item${current ? " current" : ""}${future ? " future" : ""}`}>
              <button className="tx-head" onClick={() => onPick(t.count)} aria-current={current ? "step" : undefined}>
                <span className="tx-num">tx {t.count}</span>
                <span className="muted small grow">{t.wallMs ? formatDateTime(t.wallMs) : "retract"}</span>
                {t.asserted.length > 0 && <span className="badge add">+{t.asserted.length}</span>}
                {t.retracted.length > 0 && <span className="badge del">−{t.retracted.length}</span>}
                {t.asserted.length === 0 && t.retracted.length === 0 && <span className="badge">no-op</span>}
              </button>
              {current && (
                <ul className="tx-changes">
                  {[...t.retracted.map((k) => ["del", k] as const), ...t.asserted.map((k) => ["add", k] as const)].map(([kind, key]) => {
                    const f = history.facts.get(key);
                    if (!f) return null;
                    return (
                      <li key={kind + key} className={kind}>
                        <span className="sign">{kind === "add" ? "+" : "−"}</span>
                        <button className="link mono" onClick={() => onSelectEntity(f.e)}>
                          {model.labelOf(f.e)}
                        </button>{" "}
                        <span className="mono attr">{f.a}</span> <span className="mono">{formatValue(f.v, model)}</span>
                        <div className="muted small">valid {formatRange(f.validFrom, f.validTo)}</div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
