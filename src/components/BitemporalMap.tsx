import { scaleUtc } from "d3-scale";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ViewModel } from "../app/viewModel";
import type { ValidAt } from "../lib/datalog";
import { formatDate, formatRange } from "../lib/format";
import { attributeColor, formatValue } from "../lib/graph";
import type { FactVersion } from "../lib/history";
import { validTimeExtent } from "../lib/snapshot";
import { tooltipPosition } from "./tooltip";

interface Props {
  vm: ViewModel;
  selected: string | null;
  onSelect(id: string | null): void;
  onCursor(asOf: number, validAt: ValidAt): void;
}

const M = { top: 18, right: 22, bottom: 34, left: 64 };
const SNAP_PX = 7;

export function BitemporalMap({ vm, selected, onSelect, onCursor }: Props) {
  const { history, model, asOf, validAt, now } = vm;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 480 });
  const [attrFilter, setAttrFilter] = useState<string>("");
  const [scope, setScope] = useState<"selected" | "all">("selected");
  const [hover, setHover] = useState<{ x: number; y: number; facts: FactVersion[]; ms: number; tx: number } | null>(null);
  const dragging = useRef(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ w: Math.max(320, width), h: Math.max(240, height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const focus = scope === "selected" ? selected : null;
  const facts = useMemo(() => {
    const out: FactVersion[] = [];
    for (const f of history.facts.values()) {
      if (focus && f.e !== focus && model.refTarget(f.v) !== focus) continue;
      if (attrFilter && f.a !== attrFilter) continue;
      out.push(f);
    }
    return out.sort((a, b) => a.txAsserted - b.txAsserted || a.validFrom - b.validFrom);
  }, [history, model, focus, attrFilter]);

  const [lo, hi] = useMemo(() => {
    if (facts.length === 0) return validTimeExtent(history, now);
    let l = now;
    let h = now;
    for (const f of facts) {
      l = Math.min(l, f.validFrom);
      h = Math.max(h, f.validTo ?? f.validFrom);
    }
    const pad = Math.max((h - l) * 0.06, 864e5);
    return [l - pad, h + pad];
  }, [facts, history, now]);

  const plotW = size.w - M.left - M.right;
  const plotH = size.h - M.top - M.bottom;
  const x = useMemo(() => scaleUtc().domain([lo, hi]).range([0, plotW]), [lo, hi, plotW]);
  const bands = history.maxTx + 1;
  const y = (t: number) => plotH - (t / bands) * plotH;
  const yInv = (py: number) => ((plotH - py) / plotH) * bands;

  // Valid-time boundaries to snap the crosshair to.
  const boundaries = useMemo(() => {
    const s = new Set<number>([now]);
    for (const f of facts) {
      s.add(f.validFrom);
      if (f.validTo !== null) s.add(f.validTo);
    }
    return [...s].sort((a, b) => a - b);
  }, [facts, now]);

  // Identical rectangles are nudged apart so they stay distinguishable.
  const insets = useMemo(() => {
    const seen = new Map<string, number>();
    const out = new Map<string, number>();
    for (const f of facts) {
      const k = `${f.txAsserted}|${f.txRetracted}|${f.validFrom}|${f.validTo}`;
      const n = seen.get(k) ?? 0;
      seen.set(k, n + 1);
      out.set(f.key, Math.min(n, 6) * 3);
    }
    return out;
  }, [facts]);

  // Greedy label placement: skip a label that would overlap one already placed.
  const labelled = useMemo(() => {
    const placed: { x0: number; x1: number; y: number }[] = [];
    const out = new Set<string>();
    const ordered = [...facts].sort((a, b) => Number(vm.visible.has(b.key)) - Number(vm.visible.has(a.key)));
    for (const f of ordered) {
      const x0 = Math.max(0, x(f.validFrom));
      const x1 = f.validTo === null ? plotW : Math.min(plotW, x(f.validTo));
      const yTop = y(f.txRetracted ?? bands);
      const yBase = y(f.txAsserted);
      if (x1 - x0 < 70 || yBase - yTop < 16 || (insets.get(f.key) ?? 0) > 0) continue;
      const clash = placed.some((p) => Math.abs(p.y - yBase) < 13 && p.x0 < x1 && x0 < p.x1);
      if (clash) continue;
      placed.push({ x0, x1, y: yBase });
      out.add(f.key);
    }
    return out;
  }, [facts, vm.visible, x, plotW, plotH, bands, insets]);

  const localPoint = (ev: React.PointerEvent) => {
    const rect = (ev.currentTarget as Element).getBoundingClientRect();
    return { px: ev.clientX - rect.left - M.left, py: ev.clientY - rect.top - M.top };
  };

  const snapMs = (px: number) => {
    let ms = x.invert(Math.max(0, Math.min(plotW, px))).getTime();
    let best: number | null = null;
    for (const b of boundaries) {
      const d = Math.abs(x(b) - px);
      if (d <= SNAP_PX && (best === null || d < Math.abs(x(best) - px))) best = b;
    }
    if (best !== null) ms = best;
    return Math.round(ms / 1000) * 1000;
  };

  const txAt = (py: number) => Math.max(0, Math.min(history.maxTx, Math.floor(yInv(Math.max(0, Math.min(plotH, py))))));

  const applyPointer = (ev: React.PointerEvent) => {
    const { px, py } = localPoint(ev);
    onCursor(txAt(py), { kind: "at", ms: snapMs(px) });
  };

  const hitTest = (px: number, py: number) => {
    const ms = x.invert(px).getTime();
    const t = yInv(py);
    return facts.filter(
      (f) => f.validFrom <= ms && (f.validTo === null || ms < f.validTo) && f.txAsserted <= t && (f.txRetracted ?? bands) > t,
    );
  };

  const xTicks = x.ticks(Math.max(2, Math.floor(plotW / 110)));
  const tickFormat = x.tickFormat();
  const yStep = Math.max(1, Math.ceil(bands / Math.max(1, Math.floor(plotH / 22))));
  const cursorY = y(asOf + 0.5);
  const cursorX = validAt.kind === "at" ? x(validAt.ms) : validAt.kind === "now" ? x(now) : null;

  const focusLabel = focus ? model.labelOf(focus) : null;
  const entityOptions = useMemo(
    () => [...model.nodes.values()].filter((n) => !n.stub).sort((a, b) => a.label.localeCompare(b.label)),
    [model],
  );

  return (
    <div className="map-view">
      <div className="map-toolbar">
        <label>
          Entity{" "}
          <select
            value={focus ?? ""}
            onChange={(e) => {
              const v = e.target.value || null;
              setScope(v ? "selected" : "all");
              onSelect(v);
            }}
          >
            <option value="">All entities</option>
            {entityOptions.map((n) => (
              <option key={n.id} value={n.id}>
                {n.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Attribute{" "}
          <select value={attrFilter} onChange={(e) => setAttrFilter(e.target.value)}>
            <option value="">All attributes</option>
            {history.attributes.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        {selected && scope === "all" && (
          <button className="btn small" onClick={() => setScope("selected")}>
            Focus {model.labelOf(selected)}
          </button>
        )}
        <span className="muted small grow">
          {facts.length} fact version{facts.length === 1 ? "" : "s"}
          {focusLabel ? ` touching ${focusLabel}` : ""}. Drag in the plot to move both cursors. A version is visible where its
          box covers the crosshair.
        </span>
      </div>
      <div className="map-canvas" ref={wrapRef}>
        <svg
          width={size.w}
          height={size.h}
          role="img"
          aria-label="Bitemporal map: valid time across, transaction time up"
          onPointerDown={(ev) => {
            const { px, py } = localPoint(ev);
            if (px < 0 || py < 0 || px > plotW || py > plotH) return;
            (ev.currentTarget as Element).setPointerCapture(ev.pointerId);
            dragging.current = true;
            applyPointer(ev);
          }}
          onPointerMove={(ev) => {
            const { px, py } = localPoint(ev);
            if (dragging.current) applyPointer(ev);
            if (px >= 0 && py >= 0 && px <= plotW && py <= plotH) {
              setHover({ x: ev.clientX, y: ev.clientY, facts: hitTest(px, py), ms: x.invert(px).getTime(), tx: txAt(py) });
            } else setHover(null);
          }}
          onPointerUp={(ev) => {
            if (!dragging.current) return;
            dragging.current = false;
            const { px, py } = localPoint(ev);
            const hit = hitTest(px, py);
            if (hit.length === 1 && !focus) onSelect(hit[0].e);
          }}
          onPointerLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id="fade-right" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0.75" stopColor="white" stopOpacity="1" />
              <stop offset="1" stopColor="white" stopOpacity="0.15" />
            </linearGradient>
            <mask id="open-ended" maskContentUnits="objectBoundingBox">
              <rect width="1" height="1" fill="url(#fade-right)" />
            </mask>
            <clipPath id="plot-clip">
              <rect width={plotW} height={plotH} />
            </clipPath>
          </defs>
          <g transform={`translate(${M.left},${M.top})`}>
            {/* grid */}
            {xTicks.map((t) => (
              <line key={t.getTime()} x1={x(t)} x2={x(t)} y1={0} y2={plotH} className="grid" />
            ))}
            {Array.from({ length: bands + 1 }, (_, t) =>
              t % yStep === 0 ? <line key={t} x1={0} x2={plotW} y1={y(t)} y2={y(t)} className="grid faint" /> : null,
            )}

            <g clipPath="url(#plot-clip)">
              {facts.map((f) => {
                const x0 = x(f.validFrom);
                const x1 = f.validTo === null ? plotW + 40 : x(f.validTo);
                const y0 = y(f.txRetracted ?? bands);
                const y1 = y(f.txAsserted);
                const inset = insets.get(f.key) ?? 0;
                const color = attributeColor(f.a, history.attributes);
                const visible = vm.visible.has(f.key);
                const mine = selected !== null && (f.e === selected || model.refTarget(f.v) === selected);
                const w = Math.max(1.5, x1 - x0);
                const h = Math.max(1.5, y1 - y0 - inset);
                const label = `${focus ? "" : `${model.labelOf(f.e)} `}${f.a} ${formatValue(f.v, model)}`;
                return (
                  <g
                    key={f.key}
                    className={`fact-rect${focus ? " focused" : ""}${visible ? " visible" : ""}${f.txRetracted !== null ? " retracted" : ""}${mine && !focus ? " mine" : ""}`}
                  >
                    <rect
                      x={x0}
                      y={y0 + inset}
                      width={w}
                      height={h}
                      fill={color}
                      stroke={color}
                      mask={f.validTo === null ? "url(#open-ended)" : undefined}
                    />
                    {labelled.has(f.key) && (
                      <text x={Math.max(x0, 0) + 5} y={y1 - 5} className="rect-label">
                        {label.length > w / 6.5 ? `${label.slice(0, Math.max(3, Math.floor(w / 6.5) - 1))}…` : label}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>

            {/* now marker */}
            {now >= lo && now <= hi && (
              <g className="now-marker">
                <line x1={x(now)} x2={x(now)} y1={0} y2={plotH} />
                <text x={x(now) + 4} y={10}>
                  now
                </text>
              </g>
            )}

            {/* crosshair */}
            <g className="crosshair">
              {validAt.kind === "any" && <rect x={0} y={cursorY - 1} width={plotW} height={2} className="any-band" />}
              <line x1={0} x2={plotW} y1={cursorY} y2={cursorY} />
              {cursorX !== null && <line x1={cursorX} x2={cursorX} y1={0} y2={plotH} />}
              {cursorX !== null && <circle cx={cursorX} cy={cursorY} r={5} />}
            </g>

            {/* axes */}
            <line x1={0} x2={plotW} y1={plotH} y2={plotH} className="axis" />
            <line x1={0} x2={0} y1={0} y2={plotH} className="axis" />
            {xTicks.map((t) => (
              <text key={t.getTime()} x={x(t)} y={plotH + 18} className="tick" textAnchor="middle">
                {tickFormat(t)}
              </text>
            ))}
            {Array.from({ length: bands }, (_, t) =>
              t % yStep === 0 ? (
                <text key={t} x={-8} y={y(t + 0.5) + 4} className={`tick${t === asOf ? " current" : ""}`} textAnchor="end">
                  tx {t}
                </text>
              ) : null,
            )}
            <text x={plotW} y={plotH + 31} className="axis-title" textAnchor="end">
              valid time →
            </text>
            <text transform={`translate(${-52},${0}) rotate(-90)`} className="axis-title" textAnchor="end">
              transaction time →
            </text>
          </g>
        </svg>
        {hover && (
          <div className="tooltip" style={tooltipPosition(hover.x, hover.y)}>
            <div className="tooltip-title">
              tx {hover.tx} · {formatDate(hover.ms)}
            </div>
            {hover.facts.length === 0 ? (
              <div className="muted small">Nothing recorded here</div>
            ) : (
              <table className="kv">
                <tbody>
                  {hover.facts.slice(0, 10).map((f) => (
                    <tr key={f.key}>
                      <td className="mono">{model.labelOf(f.e)}</td>
                      <td className="mono">{f.a}</td>
                      <td className="mono">{formatValue(f.v, model)}</td>
                      <td className="muted small">
                        {formatRange(f.validFrom, f.validTo)} · tx {f.txAsserted}
                        {f.txRetracted !== null ? `–${f.txRetracted}` : "+"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {hover.facts.length > 10 && <div className="muted small">+{hover.facts.length - 10} more</div>}
          </div>
        )}
      </div>
    </div>
  );
}
