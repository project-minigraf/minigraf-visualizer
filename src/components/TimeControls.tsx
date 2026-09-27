import { useMemo } from "react";
import type { CursorState } from "../app/useCursor";
import { formatDate, formatDateTime, fromInputValue, toInputValue } from "../lib/format";
import type { History } from "../lib/history";
import { validTimeExtent } from "../lib/snapshot";

interface Props {
  history: History;
  cursor: CursorState;
  now: number;
}

const SLIDER_STEPS = 1000;

export function TimeControls({ history, cursor, now }: Props) {
  const { asOf, validAt, playing } = cursor;
  const tx = asOf > 0 ? history.txs[asOf - 1] : undefined;
  const [lo, hi] = useMemo(() => validTimeExtent(history, now), [history, now]);

  const boundaries = useMemo(() => {
    const s = new Set<number>();
    for (const f of history.facts.values()) {
      s.add(f.validFrom);
      if (f.validTo !== null) s.add(f.validTo);
    }
    return [...s].sort((a, b) => a - b);
  }, [history]);

  const validMs = validAt.kind === "at" ? validAt.ms : now;
  const toSlider = (ms: number) => Math.round(((ms - lo) / (hi - lo)) * SLIDER_STEPS);
  const fromSlider = (v: number) => {
    const ms = lo + (v / SLIDER_STEPS) * (hi - lo);
    // Snap to a fact boundary when close, so "the day it changed" is easy to hit.
    const tolerance = (hi - lo) / 120;
    let best = ms;
    let bestD = tolerance;
    for (const b of boundaries) {
      const d = Math.abs(b - ms);
      if (d < bestD) {
        best = b;
        bestD = d;
      }
    }
    return Math.round(best / 1000) * 1000;
  };

  const stepBoundary = (dir: 1 | -1) => {
    const list = dir > 0 ? boundaries : [...boundaries].reverse();
    const next = list.find((b) => (dir > 0 ? b > validMs : b < validMs));
    if (next !== undefined) cursor.setValidAt({ kind: "at", ms: next });
  };

  return (
    <div className="time-controls">
      <div className="axis-row">
        <div className="axis-name">
          <span className="axis-dot tx" />
          Transaction time
          <span className="muted small">what the database knew</span>
        </div>
        <div className="transport">
          <button className="icon-btn" onClick={() => cursor.setAsOf(0)} title="First (empty database)" aria-label="First transaction">
            ⏮
          </button>
          <button className="icon-btn" onClick={() => cursor.step(-1)} title="Previous transaction (←)" aria-label="Previous transaction">
            ◀
          </button>
          <button
            className="icon-btn play"
            onClick={cursor.togglePlay}
            title="Play through history (space)"
            aria-label={playing ? "Pause" : "Play"}
          >
            {playing ? "❚❚" : "▶"}
          </button>
          <button className="icon-btn" onClick={() => cursor.step(1)} title="Next transaction (→)" aria-label="Next transaction">
            ▶
          </button>
          <button className="icon-btn" onClick={() => cursor.setAsOf(history.maxTx)} title="Latest" aria-label="Latest transaction">
            ⏭
          </button>
        </div>
        <div className="slider-wrap">
          <input
            type="range"
            min={0}
            max={Math.max(1, history.maxTx)}
            step={1}
            value={asOf}
            disabled={history.maxTx === 0}
            onChange={(e) => cursor.setAsOf(Number(e.target.value))}
            aria-label="Transaction time"
          />
          <div className="ticks">
            {history.txs.map((t) => (
              <span
                key={t.count}
                className={`tick-mark${t.retracted.length > 0 ? " has-retract" : ""}${t.asserted.length > 0 ? " has-assert" : ""}`}
                style={{ left: `${(t.count / Math.max(1, history.maxTx)) * 100}%` }}
              />
            ))}
          </div>
        </div>
        <div className="readout">
          <strong>
            as of tx {asOf}
            <span className="muted"> / {history.maxTx}</span>
          </strong>
          <span className="muted small">
            {asOf === 0 ? "before the first transaction" : tx?.wallMs ? `recorded ${formatDateTime(tx.wallMs)} UTC` : "retraction"}
          </span>
        </div>
      </div>

      <div className="axis-row">
        <div className="axis-name">
          <span className="axis-dot valid" />
          Valid time
          <span className="muted small">what was true in the world</span>
        </div>
        <div className="segmented" role="radiogroup" aria-label="Valid time mode">
          {(["now", "at", "any"] as const).map((k) => (
            <button
              key={k}
              role="radio"
              aria-checked={validAt.kind === k}
              className={validAt.kind === k ? "on" : ""}
              onClick={() => cursor.setValidAt(k === "at" ? { kind: "at", ms: validMs } : { kind: k })}
            >
              {k === "now" ? "Now" : k === "at" ? "At date" : "Any"}
            </button>
          ))}
        </div>
        <div className="slider-wrap">
          <input
            type="range"
            min={0}
            max={SLIDER_STEPS}
            value={toSlider(validMs)}
            disabled={validAt.kind === "any"}
            onChange={(e) => cursor.setValidAt({ kind: "at", ms: fromSlider(Number(e.target.value)) })}
            aria-label="Valid time"
          />
          <div className="ticks">
            {boundaries.map((b) => (
              <span key={b} className="tick-mark boundary" style={{ left: `${((b - lo) / (hi - lo)) * 100}%` }} />
            ))}
            <span className="tick-mark now" style={{ left: `${((now - lo) / (hi - lo)) * 100}%` }} title="now" />
          </div>
          <div className="range-labels muted small">
            <span>{formatDate(lo).slice(0, 10)}</span>
            <span>{formatDate(hi).slice(0, 10)}</span>
          </div>
        </div>
        <div className="readout">
          {validAt.kind === "any" ? (
            <strong>any valid time</strong>
          ) : (
            <div className="date-edit">
              <button className="icon-btn small" onClick={() => stepBoundary(-1)} title="Previous change in valid time" aria-label="Previous valid-time boundary">
                ‹
              </button>
              <input
                type="datetime-local"
                value={toInputValue(validMs)}
                onChange={(e) => {
                  const ms = fromInputValue(e.target.value);
                  if (ms !== null) cursor.setValidAt({ kind: "at", ms });
                }}
                aria-label="Valid time (UTC)"
              />
              <button className="icon-btn small" onClick={() => stepBoundary(1)} title="Next change in valid time" aria-label="Next valid-time boundary">
                ›
              </button>
            </div>
          )}
          <span className="muted small">{validAt.kind === "now" ? "UTC, follows the clock" : validAt.kind === "at" ? "UTC" : "valid-time filter off"}</span>
        </div>
      </div>
    </div>
  );
}
