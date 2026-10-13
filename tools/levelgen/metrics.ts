import { buildGraph, type Graph } from '../../src/graph.ts';
import { EnemySim } from '../../src/enemies.ts';
import type { MapData } from './mapTypes.ts';

export const PATH_HALF = 7;        // PATH_WIDTH / 2
export const MIN_TOWER_R = 10;     // smallest tower base radius
export const REACH = 90;           // level-0 range of the common towers
const FIELD = { x0: 0, x1: 640, y0: 75, y1: 480 };

export interface Report { errors: string[]; warnings: string[]; m: Record<string, number> }

// ---- geometry
const cross = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx;
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
/** Proper crossing of two segments (touching at shared endpoints does not count). */
function crosses(a: number[], b: number[]): boolean {
  const d1 = cross(a[2] - a[0], a[3] - a[1], b[0] - a[0], b[1] - a[1]), d2 = cross(a[2] - a[0], a[3] - a[1], b[2] - a[0], b[3] - a[1]);
  const d3 = cross(b[2] - b[0], b[3] - b[1], a[0] - b[0], a[1] - b[1]), d4 = cross(b[2] - b[0], b[3] - b[1], a[2] - b[0], a[3] - b[1]);
  return d1 * d2 < -1e-6 && d3 * d4 < -1e-6;
}
function segSegDist(a: number[], b: number[]): number {
  if (crosses(a, b)) return 0;
  return Math.min(segDist(a[0], a[1], b[0], b[1], b[2], b[3]), segDist(a[2], a[3], b[0], b[1], b[2], b[3]),
    segDist(b[0], b[1], a[0], a[1], a[2], a[3]), segDist(b[2], b[3], a[0], a[1], a[2], a[3]));
}

/** Everything that can be checked statically about a map, plus path statistics from walking real enemies through it. */
export function analyze(map: MapData, rnd: () => number = Math.random): Report {
  const errors: string[] = [], warnings: string[] = [], m: Record<string, number> = {};
  const nn = map.nodes.length, ne = map.edges.length;
  m.nodes = nn; m.edges = ne; m.buildings = map.buildings.length;

  // ---- original format limits and rules (graph_validate + byte-sized fields)
  if (nn >= 256) errors.push('too many nodes'); if (ne >= 256) errors.push('too many lines'); if (map.buildings.length >= 256) errors.push('too many buildings');
  if (map.buildings.length === 0) errors.push('no buildings');
  if (!map.towers.length) errors.push('no towers');
  for (const [x, y] of map.nodes) if (x < 5 || x > 635 || y < 80 || y > 400 || (x + 5) % 10 || (y - 70) % 10) errors.push(`node (${x},${y}) off the 10px grid or field`);
  for (const [b, e] of map.edges) if (b < 1 || e < 1 || b > nn || e > nn || b === e) errors.push(`bad edge ${b}->${e}`);
  if (errors.length) return { errors, warnings, m };

  let g: Graph;
  try { g = buildGraph(map); } catch (e) { return { errors: [String((e as Error).message)], warnings, m }; }
  m.sources = g.sources.length; m.sinks = g.isSink.reduce((a, b) => a + b, 0);
  m.forks = g.out.filter((o) => o.length > 1).length;
  const arena = m.sinks === 0; // original "arena" levels: no exit, enemies circle forever and wear the building down
  m.arena = arena ? 1 : 0;

  // every node can reach a sink; every node is reachable from a source
  const reach = (starts: number[], next: (n: number) => number[]) => { const seen = new Set(starts), q = [...starts]; while (q.length) for (const k of next(q.pop()!)) if (!seen.has(k)) { seen.add(k); q.push(k); } return seen; };
  const fwd = reach(g.sources, (n) => [...g.out[n]].map((e) => g.ee[e]));
  const rev: number[][] = Array.from({ length: nn }, () => []);
  for (let e = 0; e < ne; e++) rev[g.ee[e]].push(g.eb[e]);
  const sinks = [...Array(nn).keys()].filter((i) => g.isSink[i]);
  const back = reach(sinks, (n) => rev[n]);
  if (fwd.size < nn) errors.push(`${nn - fwd.size} nodes unreachable from a source`);
  if (!arena && back.size < nn) errors.push(`${nn - back.size} nodes cannot reach a sink (enemies would loop forever)`);

  // ---- geometry: crossings and corridors too narrow to build in
  const segs = [...Array(ne).keys()].map((e) => [g.nx[g.eb[e]], g.ny[g.eb[e]], g.nx[g.ee[e]], g.ny[g.ee[e]], g.eb[e], g.ee[e]]);
  let crossings = 0, tight = 0;
  for (let i = 0; i < ne; i++) for (let j = i + 1; j < ne; j++) {
    const a = segs[i], b = segs[j], shared = a[4] === b[4] || a[4] === b[5] || a[5] === b[4] || a[5] === b[5];
    if (crosses(a, b)) { crossings++; continue; }
    if (!shared && segSegDist(a, b) < 20) tight++;
  }
  m.crossings = crossings; m.tightPairs = tight;
  if (crossings) warnings.push(`${crossings} paths cross away from a node (enemies pass straight over, no choice)`);
  if (tight) warnings.push(`${tight} segment pairs closer than 20 px (no room to build between)`);

  // ---- buildings: clear of the path, and reachable by enemy fire
  let minBuildingClear = Infinity, sinkToBuilding = 0;
  for (const [bx, by] of map.buildings) for (const s of segs) minBuildingClear = Math.min(minBuildingClear, segDist(bx, by, s[0], s[1], s[2], s[3]));
  for (const s of sinks) { let d = Infinity; for (const [bx, by] of map.buildings) d = Math.min(d, Math.hypot(bx - g.nx[s], by - g.ny[s])); sinkToBuilding = Math.max(sinkToBuilding, d); }
  m.buildingClear = Math.round(minBuildingClear); m.sinkToBuilding = Math.round(sinkToBuilding);
  if (arena && minBuildingClear > 99) warnings.push('arena building is out of enemy range of the loop (it can never be attacked)');
  if (minBuildingClear < 30) errors.push('a building sits on the path');
  if (!arena && sinkToBuilding > 99) warnings.push(`a sink is ${Math.round(sinkToBuilding)} px from the nearest building (enemies never attack from there)`);

  // ---- building room: positions where a tower fits, and how much of the path they cover
  const valid: [number, number][] = [];
  for (let y = FIELD.y0 + MIN_TOWER_R; y <= FIELD.y1 - MIN_TOWER_R; y += 5) for (let x = FIELD.x0 + MIN_TOWER_R; x <= FIELD.x1 - MIN_TOWER_R; x += 5) {
    let ok = true;
    for (const s of segs) if (segDist(x, y, s[0], s[1], s[2], s[3]) < MIN_TOWER_R + PATH_HALF) { ok = false; break; }
    if (ok) for (const [bx, by] of map.buildings) if (Math.abs(bx - x) < 26 + MIN_TOWER_R && Math.abs(by - y) < 26 + MIN_TOWER_R) { ok = false; break; }
    if (ok) valid.push([x, y]);
  }
  m.towerSpots = valid.length;
  let samples = 0, covered = 0;
  for (const s of segs) {
    const len = Math.hypot(s[2] - s[0], s[3] - s[1]), n = Math.max(1, Math.round(len / 8));
    for (let k = 0; k <= n; k++) {
      const px = s[0] + ((s[2] - s[0]) * k) / n, py = s[1] + ((s[3] - s[1]) * k) / n;
      samples++;
      if (valid.some(([x, y]) => (x - px) ** 2 + (y - py) ** 2 <= REACH * REACH)) covered++;
    }
  }
  m.coverage = +(covered / samples).toFixed(3);
  if (m.coverage < 0.9) warnings.push(`only ${(m.coverage * 100).toFixed(0)}% of the path can be reached by a level-1 tower`);

  // ---- walk real enemies (the actual routing code) to measure route length and make sure everyone gets out
  if (!errors.length && !arena) {
    const K = 400, sim = new EnemySim(g, K);
    for (let i = 0; i < K; i++) sim.spawn(0, 1, 1, 1, [255, 255, 255]); // speed 1 px/step => lifetime in steps = route length in px
    const lens: number[] = [];
    let step = 0;
    for (; step < 60000 && sim.n > 0; step++) { const before = sim.n; sim.step(); for (let k = 0; k < before - sim.n; k++) lens.push(step + 1); }
    lens.sort((a, b) => a - b);
    m.stuck = sim.n; m.routeMean = Math.round(lens.reduce((a, b) => a + b, 0) / Math.max(1, lens.length));
    m.routeP95 = lens[Math.floor(lens.length * 0.95)] ?? 0; m.routeMax = lens[lens.length - 1] ?? 0;
    m.routeMin = lens[0] ?? 0;
    let shortest = Infinity; // shortest source->sink route length (Dijkstra on edge lengths)
    const dist = new Float64Array(nn).fill(Infinity), todo = [...g.sources]; for (const s of g.sources) dist[s] = 0;
    while (todo.length) { todo.sort((a, b) => dist[b] - dist[a]); const n = todo.pop()!; for (const e of g.out[n]) if (dist[n] + g.elen[e] < dist[g.ee[e]]) { dist[g.ee[e]] = dist[n] + g.elen[e]; todo.push(g.ee[e]); } }
    for (const s of sinks) shortest = Math.min(shortest, dist[s]);
    m.routeShortest = Math.round(shortest);
    if (sim.n > 0) errors.push(`${sim.n} of ${K} enemies were still walking after 60000 steps`);
    void rnd;
  }
  return { errors, warnings, m };
}
