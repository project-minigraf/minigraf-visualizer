import { select } from "d3-selection";
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from "d3-zoom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ItemState, ViewModel } from "../app/viewModel";
import { attributeColor, formatValue, isEdgeFact, kindColor, nodeKinds } from "../lib/graph";
import { bounds, layoutGraph, type Point } from "../lib/layout";
import { tooltipPosition } from "./tooltip";

interface Props {
  vm: ViewModel;
  selected: string | null;
  onSelect(id: string | null): void;
  showGhosts: boolean;
}

interface Hover {
  id: string;
  x: number;
  y: number;
}

const BASE_R = 15;

function isShown(s: ItemState | undefined, ghosts: boolean): boolean {
  return s !== undefined && (s !== "hidden" || ghosts);
}

export function GraphView({ vm, selected, onSelect, showGhosts }: Props) {
  const { model, history } = vm;
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const positionsRef = useRef<Map<string, Point>>(new Map());
  const [transform, setTransform] = useState<ZoomTransform>(zoomIdentity);
  const [dragged, setDragged] = useState<Map<string, Point>>(new Map());
  const [hover, setHover] = useState<Hover | null>(null);

  const layout = useMemo(() => {
    const next = layoutGraph([...model.nodes.keys()], model.edges, positionsRef.current);
    positionsRef.current = next;
    return next;
  }, [model]);

  useEffect(() => setDragged(new Map()), [layout]);

  const pos = useCallback((id: string): Point => dragged.get(id) ?? layout.get(id) ?? { x: 0, y: 0 }, [dragged, layout]);

  const kinds = useMemo(() => nodeKinds(history, model), [history, model]);
  const kindList = useMemo(() => [...new Set(kinds.values())].filter((k) => k !== "value").sort(), [kinds]);

  const degree = useMemo(() => {
    const d = new Map<string, number>();
    for (const e of model.edges) {
      d.set(e.source, (d.get(e.source) ?? 0) + 1);
      d.set(e.target, (d.get(e.target) ?? 0) + 1);
    }
    return d;
  }, [model]);
  const radius = useCallback((id: string) => BASE_R + Math.min(10, (degree.get(id) ?? 0) * 1.2), [degree]);

  // Pan and zoom. Dragging a node is handled separately, so the zoom
  // behaviour ignores events that start on a node.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const z = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.15, 4])
      .filter((ev: Event) => {
        const t = ev.target as Element | null;
        return !t?.closest?.(".g-node") && !(ev as MouseEvent).button;
      })
      .on("zoom", (ev: { transform: ZoomTransform }) => setTransform(ev.transform));
    zoomRef.current = z;
    select(svg).call(z).on("dblclick.zoom", null);
    return () => {
      select(svg).on(".zoom", null);
    };
  }, []);

  const fit = useCallback(() => {
    const svg = svgRef.current;
    const z = zoomRef.current;
    const b = bounds(layout.values());
    if (!svg || !z || !b) return;
    const { width, height } = svg.getBoundingClientRect();
    if (width === 0 || height === 0) return;
    // Labels hang below and beside nodes, so leave extra room on those sides.
    const padX = 110;
    const padY = 60;
    const k = Math.min(1.4, (width - padX * 2) / Math.max(1, b.maxX - b.minX), (height - padY * 2) / Math.max(1, b.maxY - b.minY));
    const t = zoomIdentity
      .translate(width / 2, height / 2)
      .scale(Math.max(0.15, k))
      .translate(-(b.minX + b.maxX) / 2, -(b.minY + b.maxY) / 2 - 8);
    select(svg).call(z.transform, t);
  }, [layout]);

  useEffect(() => {
    fit();
  }, [fit]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const ro = new ResizeObserver(() => fit());
    ro.observe(svg);
    return () => ro.disconnect();
  }, [fit]);

  // Node dragging.
  const dragRef = useRef<{ id: string; dx: number; dy: number; moved: boolean } | null>(null);
  const toGraph = (clientX: number, clientY: number): Point => {
    const rect = svgRef.current?.getBoundingClientRect();
    const [x, y] = transform.invert([clientX - (rect?.left ?? 0), clientY - (rect?.top ?? 0)]);
    return { x, y };
  };
  const onNodeDown = (id: string) => (ev: React.PointerEvent) => {
    ev.stopPropagation();
    (ev.currentTarget as Element).setPointerCapture(ev.pointerId);
    const p = toGraph(ev.clientX, ev.clientY);
    const at = pos(id);
    dragRef.current = { id, dx: at.x - p.x, dy: at.y - p.y, moved: false };
  };
  const onNodeMove = (ev: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const p = toGraph(ev.clientX, ev.clientY);
    d.moved = true;
    setHover(null);
    setDragged((m) => new Map(m).set(d.id, { x: p.x + d.dx, y: p.y + d.dy }));
  };
  const onNodeUp = (id: string) => () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (d && !d.moved) onSelect(id === selected ? null : id);
  };

  const shown = (s: ItemState | undefined) => isShown(s, showGhosts);

  // Parallel edges between the same two nodes get different curvature.
  const edgeGeometry = useMemo(() => {
    const groups = new Map<string, string[]>();
    for (const e of model.edges) {
      if (!isShown(vm.edgeState.get(e.key), showGhosts)) continue;
      const k = e.source < e.target ? `${e.source}|${e.target}` : `${e.target}|${e.source}`;
      const g = groups.get(k);
      if (g) g.push(e.key);
      else groups.set(k, [e.key]);
    }
    const bend = new Map<string, number>();
    for (const keys of groups.values()) {
      keys.forEach((key, i) => bend.set(key, (i - (keys.length - 1) / 2) * 26));
    }
    return bend;
  }, [model, vm.edgeState, showGhosts]);

  const selectedNeighbours = useMemo(() => {
    const s = new Set<string>();
    if (!selected) return s;
    for (const e of model.edges) {
      if (!vm.visible.has(e.key)) continue;
      if (e.source === selected) s.add(e.target);
      if (e.target === selected) s.add(e.source);
    }
    return s;
  }, [selected, model, vm.visible]);

  const hoverFacts = hover
    ? (vm.factsByEntity.get(hover.id) ?? []).filter((f) => !isEdgeFact(model, f)).sort((a, b) => a.a.localeCompare(b.a))
    : [];

  const visibleCount = [...vm.nodeState.values()].filter((s) => s === "visible" || s === "added").length;

  return (
    <div className="graph-view">
      <svg
        ref={svgRef}
        className="graph-svg"
        role="img"
        aria-label="Entity graph at the time cursor"
        onClick={(ev) => {
          if (ev.target === svgRef.current) onSelect(null);
        }}
      >
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="context-stroke" />
          </marker>
        </defs>
        <g transform={transform.toString()}>
          {model.edges.map((e) => {
            const state = vm.edgeState.get(e.key);
            if (!shown(state)) return null;
            const a = pos(e.source);
            const b = pos(e.target);
            const bendBy = edgeGeometry.get(e.key) ?? 0;
            const mx = (a.x + b.x) / 2;
            const my = (a.y + b.y) / 2;
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const len = Math.hypot(dx, dy) || 1;
            const nx = -dy / len;
            const ny = dx / len;
            const flip = e.source < e.target ? 1 : -1;
            const cx = mx + nx * bendBy * flip;
            const cy = my + ny * bendBy * flip;
            // Stop the curve at the target node's edge so the arrow is visible.
            const tx = b.x - cx;
            const ty = b.y - cy;
            const tl = Math.hypot(tx, ty) || 1;
            const r = radius(e.target) + 3;
            const ex = b.x - (tx / tl) * r;
            const ey = b.y - (ty / tl) * r;
            const color = attributeColor(e.attr, history.attributes);
            const emphasised = selected !== null && (e.source === selected || e.target === selected);
            const showLabel = state === "added" || state === "removed" || emphasised;
            return (
              <g key={e.key} className={`g-edge s-${state}${emphasised ? " emph" : ""}`}>
                <path d={`M${a.x},${a.y} Q${cx},${cy} ${ex},${ey}`} stroke={color} markerEnd="url(#arrow)" />
                {showLabel && (
                  <text x={(a.x + 2 * cx + b.x) / 4} y={(a.y + 2 * cy + b.y) / 4 - 4} className="edge-label">
                    {e.attr}
                  </text>
                )}
              </g>
            );
          })}
          {[...model.nodes.values()].map((n) => {
            const state = vm.nodeState.get(n.id);
            if (!shown(state)) return null;
            const p = pos(n.id);
            const r = radius(n.id);
            const kind = kinds.get(n.id) ?? "entity";
            const dim = selected !== null && selected !== n.id && !selectedNeighbours.has(n.id);
            return (
              <g
                key={n.id}
                className={`g-node s-${state}${n.stub ? " stub" : ""}${selected === n.id ? " selected" : ""}${dim ? " dim" : ""}`}
                transform={`translate(${p.x},${p.y})`}
                onPointerDown={onNodeDown(n.id)}
                onPointerMove={onNodeMove}
                onPointerUp={onNodeUp(n.id)}
                onPointerEnter={(ev) => setHover({ id: n.id, x: ev.clientX, y: ev.clientY })}
                onPointerLeave={() => setHover(null)}
                data-label={n.label}
              >
                <circle r={r + 6} className="halo" />
                <circle r={r} className="body" style={{ ["--kind" as string]: kindColor(kind, kindList) }} />
                <text y={r + 15} className="node-label">
                  {n.label}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      <div className="graph-overlay top-left">
        <div className="legend">
          {kindList.map((k) => (
            <span key={k} className="legend-item">
              <i style={{ background: kindColor(k, kindList) }} />
              {k}
            </span>
          ))}
          {[...model.nodes.values()].some((n) => n.stub) && (
            <span className="legend-item">
              <i className="stub-swatch" />
              keyword value
            </span>
          )}
        </div>
      </div>
      <div className="graph-overlay top-right">
        <span className="muted small">
          {visibleCount} of {model.nodes.size} nodes at cursor
        </span>
        <button className="btn small" onClick={fit} title="Fit graph to view">
          Fit
        </button>
      </div>
      <div className="graph-overlay bottom-left legend">
        <span className="legend-item">
          <i className="state-swatch added" /> added by this tx
        </span>
        <span className="legend-item">
          <i className="state-swatch removed" /> removed by this tx
        </span>
      </div>

      {hover && (
        <div className="tooltip" style={tooltipPosition(hover.x, hover.y)}>
          <div className="tooltip-title">{model.labelOf(hover.id)}</div>
          <div className="muted small mono">{hover.id}</div>
          {hoverFacts.length === 0 ? (
            <div className="muted small">No properties at the cursor</div>
          ) : (
            <table className="kv">
              <tbody>
                {hoverFacts.slice(0, 12).map((f) => (
                  <tr key={f.key}>
                    <td className="mono">{f.a}</td>
                    <td className="mono">{formatValue(f.v, model)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
