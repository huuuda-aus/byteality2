import { rng, type MapData } from './mapTypes.ts';

// Layouts are built on the original's 10 px grid: cell (cx, cy) with cx 1..64, cy 1..33  =>  px (10*cx-5, 10*cy+70).
class Builder {
  nodes: [number, number][] = [];
  edges: [number, number][] = [];
  sources = new Set<number>(); sinks = new Set<number>();
  node(cx: number, cy: number): number {
    cx = Math.round(cx); cy = Math.round(cy);
    const i = this.nodes.findIndex(([x, y]) => x === cx && y === cy);
    if (i >= 0) return i;
    this.nodes.push([cx, cy]); return this.nodes.length - 1;
  }
  link(a: number, b: number): void { if (a !== b && !this.edges.some(([p, q]) => p === a && q === b)) this.edges.push([a, b]); }
  /** Chain of directed segments through the points; returns the node ids. */
  chain(pts: [number, number][]): number[] {
    const ids = pts.map(([x, y]) => this.node(x, y));
    for (let i = 0; i + 1 < ids.length; i++) this.link(ids[i], ids[i + 1]);
    return ids;
  }
}

const px = (cx: number) => 10 * cx - 5, py = (cy: number) => 10 * cy + 70;
const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function segDist(p: number[], a: number[], b: number[]): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Turn a Builder into a MapData: order values by distance from the sources, buildings placed beside the sinks, provisional numbers. */
function finish(b: Builder, r: () => number, style: string): MapData & { style: string } {
  const nodes = b.nodes.map(([cx, cy]) => [px(cx), py(cy)] as [number, number]);
  // order = progress along the route (0 at sources, 100 at sinks)
  const d = new Float64Array(nodes.length).fill(Infinity), todo = [...b.sources];
  for (const s of b.sources) d[s] = 0;
  while (todo.length) {
    todo.sort((x, y) => d[y] - d[x]); const n = todo.pop()!;
    for (const [p, q] of b.edges) if (p === n) { const w = d[n] + dist(nodes[p], nodes[q]); if (w < d[q]) { d[q] = w; todo.push(q); } }
  }
  const far = Math.max(1, ...d.filter(Number.isFinite));
  const order = nodes.map((_, i) => b.sources.has(i) ? 0 : b.sinks.has(i) ? 100 : Math.min(99, Math.max(1, Math.round((100 * (Number.isFinite(d[i]) ? d[i] : far)) / far))));

  // buildings: one beside each sink (sinks closer than 90 px share one); in an arena, one next to the loop
  const segs = b.edges.map(([p, q]) => [nodes[p], nodes[q]]);
  const buildings: [number, number, number][] = [];
  const anchors = b.sinks.size ? [...b.sinks].map((s) => nodes[s]) : Array.from({ length: r() < 0.3 ? 2 : 1 }, () => nodes[b.edges[Math.floor(r() * b.edges.length)][0]]);
  for (const a of anchors) {
    if (buildings.some((q) => dist(q, a) < 90)) continue;
    let best: [number, number] | null = null;
    for (let tries = 0; tries < 200 && !best; tries++) {
      const ang = r() * Math.PI * 2, rad = 50 + r() * 25, c: [number, number] = [Math.round((a[0] + Math.cos(ang) * rad + 5) / 10) * 10 - 5, Math.round((a[1] + Math.sin(ang) * rad - 70) / 10) * 10 + 70];
      if (c[0] < 35 || c[0] > 605 || c[1] < 110 || c[1] > 380) continue;
      if (segs.some(([p, q]) => segDist(c, p, q) < 36)) continue;
      if (buildings.some((q) => Math.abs(q[0] - c[0]) < 70 && Math.abs(q[1] - c[1]) < 70)) continue;
      best = c;
    }
    if (best) buildings.push([best[0], best[1], 100 * (1 + Math.floor(r() * 4))]);
  }

  // provisional numbers (the bot-based calibration comes later): the most common original settings and a basic tower kit
  const kitPool = ['gun', 'rifle', 'minigun', 'rocket', 'nail', 'ballistic', 'mine', 'bounce', 'toxic', 'missile', 'homing']; // towers the bot knows how to play
  const kit: string[] = [], types = 3 + Math.floor(r() * 3);
  const pool = kitPool.slice().sort(() => r() - 0.5).slice(0, types);
  if (!pool.includes('gun')) pool[0] = 'gun';
  for (const t of pool) for (let i = 0; i < 3 + Math.floor(r() * 3); i++) kit.push(t);
  const steps = 600 * (24 + Math.floor(r() * 25)); // 4:00 .. 10:00 like the originals
  return { style, steps, seconds: steps / 60, money: 100, hp_mult: 4, speed_mult: 2, value_mult: 5,
    nodes: nodes.map(([x, y], i) => [x, y, order[i]] as [number, number, number]), edges: b.edges.map(([p, q]) => [p + 1, q + 1] as [number, number]), buildings, towers: kit };
}

const irand = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));

// ---------------------------------------------------------------- styles
function serpentine(r: () => number) {
  const b = new Builder(), rows = irand(r, 2, 4), top = irand(r, 6, 9), bottom = irand(r, 26, 29), gap = (bottom - top) / (rows - 1);
  const w = irand(r, 28, 48), xl = irand(r, 5, 62 - w), xr = xl + w, start = Math.max(2, xl - irand(r, 1, 3));
  const pts: [number, number][] = [[start, top]];
  let dirRight = true;
  for (let i = 0; i < rows; i++) {
    const y = top + i * gap;
    if (i === 0) pts.push([xr, y]);
    else { pts.push([dirRight ? xl : xr, y - gap]); pts.push([dirRight ? xl : xr, y]); pts.push([dirRight ? xr : xl, y]); }
    dirRight = !dirRight;
  }
  const ids = b.chain(pts.filter((p, i, a) => i === 0 || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1]));
  b.sources.add(ids[0]); b.sinks.add(ids[ids.length - 1]);
  return finish(b, r, 'serpentine');
}

function spiral(r: () => number) {
  const b = new Builder(), step = irand(r, 7, 8), w = irand(r, 30, 42), h = irand(r, 20, 25);
  let x0 = irand(r, 4, 62 - w), y0 = irand(r, 6, 31 - h), x1 = x0 + w, y1 = y0 + h;
  const pts: [number, number][] = [[Math.max(2, x0 - 2), y0]];
  const rings = irand(r, 2, 3);
  for (let i = 0; i < rings; i++) {
    pts.push([x1, y0], [x1, y1], [x0, y1]);
    y0 += step; x0 += step; x1 -= step; y1 -= step;
    if (i < rings - 1) pts.push([x0 - step, y0]); // the left edge runs up to the next ring's start row
    else pts.push([x0 - step, y0], [x0 + 2 * step, y0]); // final run into the centre
  }
  const clean = pts.filter((p, i, a) => i === 0 || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1]);
  const ids = b.chain(clean);
  b.sources.add(ids[0]); b.sinks.add(ids[ids.length - 1]);
  return finish(b, r, 'spiral');
}

function diamonds(r: () => number) {
  const b = new Builder(), k = irand(r, 2, 4), mid = irand(r, 15, 19), left = irand(r, 3, 5), right = irand(r, 58, 62);
  const span = (right - left) / k;
  const src = b.node(left, mid); b.sources.add(src);
  let prev = src;
  for (let i = 0; i < k; i++) {
    const xa = left + i * span + irand(r, 1, 3), xb = left + (i + 1) * span - irand(r, 1, 3), h = irand(r, 5, 9), d = Math.min(4, Math.floor((xb - xa) / 4));
    const split = b.node(xa, mid), merge = b.node(xb, mid);
    b.link(prev, split);
    for (const dir of [-1, 1]) { const ids = b.chain([[xa, mid], [xa + d, mid + dir * h], [xb - d, mid + dir * h], [xb, mid]]); void ids; }
    if (r() < 0.5) b.link(split, merge); // optional straight middle branch
    prev = merge;
  }
  const sink = b.node(right + 1 > 62 ? 62 : right + 1, mid); b.link(prev, sink); b.sinks.add(sink);
  return finish(b, r, 'diamonds');
}

function ring(r: () => number) {
  const b = new Builder(), xl = irand(r, 16, 24), xr = irand(r, 42, 50), yt = irand(r, 10, 12), yb = irand(r, 22, 24), c = irand(r, 2, 4);
  const midY = Math.round((yt + yb) / 2);
  // clockwise ring with chamfered corners
  const loop: [number, number][] = [[xl + c, yt], [xr - c, yt], [xr, yt + c], [xr, yb - c], [xr - c, yb], [xl + c, yb], [xl, yb - c], [xl, yt + c]];
  const ids = loop.map(([x, y]) => b.node(x, y));
  for (let i = 0; i < ids.length; i++) b.link(ids[i], ids[(i + 1) % ids.length]);
  // entry from the left, joining the ring on its left edge (between the last two corner nodes)
  const entry = b.node(xl, midY), a = ids[6], z = ids[7];
  b.edges = b.edges.filter(([p, q]) => !(p === a && q === z)); b.link(a, entry); b.link(entry, z);
  const src = b.node(irand(r, 2, 4), midY); b.sources.add(src); b.link(src, entry);
  // three exits (two on top, one below, or the reverse): the more exits per lap, the shorter the tail of enemies that keep circling
  const topFirst = r() < 0.5, exitSpecs: { top: boolean; x: number }[] = [
    { top: topFirst, x: xl + c + irand(r, 2, 4) }, { top: topFirst, x: xr - c - irand(r, 2, 4) }, { top: !topFirst, x: irand(r, xl + 8, xr - 8) }];
  for (const { top, x } of exitSpecs) {
    // find the ring edge (between two consecutive ring nodes on this side) that contains x
    const from = top ? ids[0] : ids[4], to = top ? ids[1] : ids[5];
    const cur = b.edges.find(([p, q]) => (top ? p === from : p === from) && q !== from && b.nodes[p][1] === (top ? yt : yb) && b.nodes[q][1] === (top ? yt : yb) && ((b.nodes[p][0] - x) * (b.nodes[q][0] - x) < 0));
    if (!cur) continue;
    const e = b.node(x, top ? yt : yb), s = b.node(x + irand(r, -3, 3), top ? irand(r, 4, 5) : irand(r, 29, 30));
    b.edges = b.edges.filter((ed) => ed !== cur); b.link(cur[0], e); b.link(e, cur[1]);
    b.link(e, s); b.sinks.add(s);
    void to;
  }
  return finish(b, r, 'ring');
}

function tree(r: () => number) {
  const b = new Builder(), leaves = irand(r, 2, 4), mid = irand(r, 15, 19);
  const ys: number[] = []; for (let i = 0; i < leaves; i++) ys.push(Math.round(7 + ((29 - 7) * i) / (leaves - 1)));
  const src = b.node(irand(r, 2, 4), mid); b.sources.add(src);
  const grow = (from: number, x: number, y: number, group: number[]): void => {
    if (group.length === 1) { const s = b.node(irand(r, 56, 62), group[0]); const m = b.node(x + irand(r, 4, 8), y); b.link(from, m); const m2 = b.node(m < 0 ? x : b.nodes[m][0], group[0]); b.link(m, m2); b.link(m2, s); b.sinks.add(s); return; }
    const half = Math.floor(group.length / 2), a = group.slice(0, half), c = group.slice(half), fx = x + irand(r, 5, 8), fork = b.node(fx, y);
    b.link(from, fork);
    const nx = fx + irand(r, 6, 9);
    for (const sub of [a, c]) { const ty = Math.round(sub.reduce((p, q) => p + q, 0) / sub.length); const k = b.node(nx, y); const v = b.node(nx, ty); b.link(fork, k); b.link(k, v); grow(v, nx, ty, sub); }
  };
  grow(src, b.nodes[src][0], mid, ys);
  return finish(b, r, 'tree');
}

function sawtooth(r: () => number) {
  const b = new Builder(), n = irand(r, 4, 7), x0 = irand(r, 4, 7), x1 = irand(r, 58, 61), top = irand(r, 5, 8), bottom = irand(r, 27, 30);
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) pts.push([Math.round(x0 + ((x1 - x0) * i) / n), i % 2 ? bottom : top]);
  const ids = b.chain(pts);
  b.sources.add(ids[0]); b.sinks.add(ids[ids.length - 1]);
  return finish(b, r, 'sawtooth');
}

// ---------------------------------------------------------------- arena styles (no sink: enemies circulate until someone's home falls)
/** A figure eight. `junction`: the two diagonals meet in a node at the crossing, so enemies may switch loops there. Otherwise the path simply crosses itself (an overpass). */
function figure8(r: () => number, junction: boolean, style: string) {
  const b = new Builder(), cx = irand(r, 30, 34), cy = irand(r, 16, 18), a = irand(r, 12, 17), h = irand(r, 7, 10), inset = 4;
  const S = [[cx - inset, cy - h], [cx - a, cy - h], [cx - a - 3, cy], [cx - a, cy + h], [cx - inset, cy + h]] as [number, number][];
  const T = [[cx + inset, cy - h], [cx + a, cy - h], [cx + a + 3, cy], [cx + a, cy + h], [cx + inset, cy + h]] as [number, number][];
  const ids = [...S, ...T].map(([x, y]) => b.node(x, y));
  const link = (from: number, to: number) => { if (junction) { const c = b.node(cx, cy); b.link(from, c); b.link(c, to); } else b.link(from, to); };
  for (let i = 0; i < 4; i++) { b.link(ids[i], ids[i + 1]); b.link(ids[5 + i], ids[6 + i]); }
  link(ids[4], ids[5]);   // lower left -> upper right diagonal
  link(ids[9], ids[0]);   // lower right -> upper left diagonal
  b.sources.add(ids[irand(r, 1, 3)]);
  return finish(b, r, style);
}

/** A rounded ring with one or two chords across it, joined by a node where they cross: forks everywhere, no exit. */
function circuit(r: () => number) {
  const b = new Builder(), xl = irand(r, 6, 14), xr = irand(r, 50, 58), yt = irand(r, 6, 9), yb = irand(r, 26, 29), c = 3;
  const xm = Math.round((xl + xr) / 2), ym = Math.round((yt + yb) / 2);
  const ring: [number, number][] = [[xl + c, yt], [xm, yt], [xr - c, yt], [xr, yt + c], [xr, ym], [xr, yb - c], [xr - c, yb], [xm, yb], [xl + c, yb], [xl, yb - c], [xl, ym], [xl, yt + c]];
  const ids = ring.map(([x, y]) => b.node(x, y));
  for (let i = 0; i < ids.length; i++) b.link(ids[i], ids[(i + 1) % ids.length]);
  const j = b.node(xm, ym), both = r() < 0.6;
  if (both || r() < 0.5) { const down = r() < 0.5; b.link(down ? ids[1] : ids[7], j); b.link(j, down ? ids[7] : ids[1]); }
  if (both || !b.edges.some(([p]) => p === j)) { const right = r() < 0.5; b.link(right ? ids[10] : ids[4], j); b.link(j, right ? ids[4] : ids[10]); }
  b.sources.add(ids[irand(r, 0, ids.length - 1)]);
  return finish(b, r, 'circuit');
}

/** 2-4 petal loops through a central hub, spread around it so they never touch. */
function clover(r: () => number) {
  const b = new Builder(), cx = irand(r, 30, 34), cy = irand(r, 16, 18), hh = 4, hub = b.node(cx, cy);
  const sets = [[-90, 30, 150], [45, 135, 225, 315], [0, 180], [-90, 90], [-45, 90, 225]];
  const angles = sets[irand(r, 0, sets.length - 1)];
  let loopNode = -1;
  for (const deg of angles) {
    const ax = Math.cos((deg * Math.PI) / 180), ay = Math.sin((deg * Math.PI) / 180), len = irand(r, 12, Math.abs(ay) > 0.9 ? 12 : 15);
    const p = (along: number, side: number): [number, number] => [cx + ax * along - ay * side, cy + ay * along + ax * side];
    const ids = [p(7, hh), p(len, hh), p(len + 2, 0), p(len, -hh), p(7, -hh)].map(([x, y]) => b.node(x, y));
    b.link(hub, ids[0]); for (let i = 0; i < 4; i++) b.link(ids[i], ids[i + 1]); b.link(ids[4], hub);
    if (loopNode < 0) loopNode = ids[1];
  }
  b.sources.add(loopNode);
  return finish(b, r, 'clover');
}

/** One-way city streets: every intersection is a fork. Orientations are re-rolled until every intersection can reach every other one. */
function grid(r: () => number) {
  const rows = irand(r, 3, 4), cols = irand(r, 4, 5), dx = Math.floor(52 / (cols - 1)), dy = Math.floor(24 / (rows - 1)), x0 = irand(r, 4, 8), y0 = irand(r, 5, 7);
  for (let attempt = 0; attempt < 40; attempt++) {
    const rowEast = Array.from({ length: rows }, () => r() < 0.5), colSouth = Array.from({ length: cols }, () => r() < 0.5);
    const b = new Builder(), id = (i: number, j: number) => b.node(x0 + j * dx, y0 + i * dy);
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols - 1; j++) rowEast[i] ? b.link(id(i, j), id(i, j + 1)) : b.link(id(i, j + 1), id(i, j));
    for (let j = 0; j < cols; j++) for (let i = 0; i < rows - 1; i++) colSouth[j] ? b.link(id(i, j), id(i + 1, j)) : b.link(id(i + 1, j), id(i, j));
    // strongly connected?
    const n = b.nodes.length, reach = (adj: number[][]) => { const seen = new Set([0]), q = [0]; while (q.length) for (const k of adj[q.pop()!]) if (!seen.has(k)) { seen.add(k); q.push(k); } return seen.size; };
    const fwd: number[][] = Array.from({ length: n }, () => []), back: number[][] = Array.from({ length: n }, () => []);
    for (const [p, q] of b.edges) { fwd[p].push(q); back[q].push(p); }
    if (reach(fwd) === n && reach(back) === n) { b.sources.add(irand(r, 0, n - 1)); if (r() < 0.4) b.sources.add(irand(r, 0, n - 1)); return finish(b, r, 'grid'); }
  }
  return serpentine(r); // (rare) no valid orientation found: fall back
}

// ---------------------------------------------------------------- forks and crossings with exits
/** A junction: enemies arrive along one or two arms and pick one of the exits at random. */
function crossroads(r: () => number) {
  const b = new Builder(), cx = irand(r, 28, 36), cy = irand(r, 16, 18), j = b.node(cx, cy), twoSources = r() < 0.5;
  const arms: { pos: [number, number]; out: boolean }[] = [{ pos: [3, cy], out: false }, { pos: [61, cy], out: !twoSources }, { pos: [cx, 4], out: true }, { pos: [cx, 31], out: true }];
  if (twoSources) arms[1].out = false;
  for (const arm of arms) {
    const mid = b.node((arm.pos[0] + cx) / 2 + irand(r, -3, 3) * 0, (arm.pos[1] + cy) / 2); // a straight arm with a midpoint node
    if (arm.out) { const s = b.node(arm.pos[0], arm.pos[1]); b.link(j, mid); b.link(mid, s); b.sinks.add(s); }
    else { const s = b.node(arm.pos[0], arm.pos[1]); b.link(s, mid); b.link(mid, j); b.sources.add(s); }
  }
  return finish(b, r, 'crossroads');
}

/** Two long lanes with cross-over rungs: at every rung enemies may switch lanes. */
function ladder(r: () => number) {
  const b = new Builder(), top = irand(r, 8, 11), bot = irand(r, 23, 26), rungs = irand(r, 2, 4), x0 = 3, x1 = 61;
  const xs: number[] = [x0]; for (let i = 1; i <= rungs; i++) xs.push(Math.round(x0 + ((x1 - x0) * i) / (rungs + 1)) + irand(r, -2, 2)); xs.push(x1);
  const T = xs.map((x) => b.node(x, top)), B = xs.map((x) => b.node(x, bot));
  for (let i = 0; i + 1 < xs.length; i++) { b.link(T[i], T[i + 1]); b.link(B[i], B[i + 1]); }
  for (let i = 1; i <= rungs; i++) r() < 0.5 ? b.link(T[i], B[i]) : b.link(B[i], T[i]);
  b.sources.add(T[0]); b.sources.add(B[0]); // both lane starts are sources (otherwise the lower start would be unreachable)
  b.sinks.add(T[T.length - 1]); b.sinks.add(B[B.length - 1]);
  return finish(b, r, 'ladder');
}

/** A hub that fans out to several exits. */
function starburst(r: () => number) {
  const b = new Builder(), cx = irand(r, 22, 28), cy = irand(r, 16, 18), spokes = irand(r, 3, 5), hub = b.node(cx, cy), src = b.node(3, cy);
  b.sources.add(src); b.link(src, b.node(Math.round((3 + cx) / 2), cy)); b.link(b.node(Math.round((3 + cx) / 2), cy), hub);
  for (let i = 0; i < spokes; i++) {
    const ang = (-65 + (130 * i) / (spokes - 1)) * (Math.PI / 180), rad = irand(r, 26, 32);
    const tx = Math.min(62, Math.round(cx + Math.cos(ang) * rad)), ty = Math.max(4, Math.min(31, Math.round(cy + Math.sin(ang) * rad * 0.9)));
    const mid = b.node((cx + tx) / 2, (cy + ty) / 2), s = b.node(tx, ty);
    b.link(hub, mid); b.link(mid, s); b.sinks.add(s);
  }
  return finish(b, r, 'starburst');
}

export const STYLES: Record<string, (r: () => number) => MapData & { style: string }> = {
  serpentine, spiral, diamonds, ring, tree, sawtooth,
  figure8: (r) => figure8(r, true, 'figure8'), overpass: (r) => figure8(r, false, 'overpass'), circuit, clover, grid, crossroads, ladder, starburst,
};
/** Styles whose paths are allowed to cross without a node (enemies pass straight over). */
export const CROSSING_STYLES = new Set(['overpass']);
/** Styles without a sink: enemies circulate forever. */
export const ARENA_STYLES = new Set(['figure8', 'overpass', 'circuit', 'clover', 'grid']);
export { rng };
