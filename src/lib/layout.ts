import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationNodeDatum } from "d3-force";

export interface Point {
  x: number;
  y: number;
}

interface SimNode extends SimulationNodeDatum {
  id: string;
}

/**
 * Force-directed layout over every node and edge in the whole history.
 * Positions from an earlier layout are reused as starting points, so a small
 * change to the data only nudges the picture.
 */
export function layoutGraph(
  nodeIds: string[],
  links: { source: string; target: string }[],
  previous: Map<string, Point> = new Map(),
): Map<string, Point> {
  const seen = new Set<string>();
  const uniqueLinks: { source: string; target: string }[] = [];
  for (const l of links) {
    if (l.source === l.target) continue;
    const k = l.source < l.target ? `${l.source}|${l.target}` : `${l.target}|${l.source}`;
    if (seen.has(k)) continue;
    seen.add(k);
    uniqueLinks.push({ source: l.source, target: l.target });
  }

  const nodes: SimNode[] = nodeIds.map((id, i) => {
    const p = previous.get(id);
    // Deterministic spiral start so the same data gives the same picture.
    const angle = i * 2.399963;
    const radius = 30 * Math.sqrt(i + 1);
    return { id, x: p?.x ?? radius * Math.cos(angle), y: p?.y ?? radius * Math.sin(angle) };
  });

  const sim = forceSimulation(nodes)
    .force(
      "link",
      forceLink<SimNode, { source: string; target: string }>(uniqueLinks)
        .id((d) => d.id)
        .distance(110)
        .strength(0.6),
    )
    .force("charge", forceManyBody().strength(-420))
    .force("collide", forceCollide(42))
    .force("x", forceX(0).strength(0.05))
    .force("y", forceY(0).strength(0.07))
    .stop();

  const warm = nodes.every((n) => previous.has(n.id));
  sim.alpha(warm ? 0.3 : 1);
  const ticks = warm ? 120 : 400;
  for (let i = 0; i < ticks; i++) sim.tick();

  const out = new Map<string, Point>();
  for (const n of nodes) out.set(n.id, { x: n.x ?? 0, y: n.y ?? 0 });
  return out;
}

export function bounds(points: Iterable<Point>): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}
