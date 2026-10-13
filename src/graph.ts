export interface MapLike {
  nodes: [number, number, number][];
  edges: [number, number][];
  buildings: [number, number, number][];
}

export interface Graph {
  nx: Float32Array;
  ny: Float32Array;
  nv: Float32Array; // node order 0..100 (progress along the route)
  eb: Int32Array; // edge begin node (0-based)
  ee: Int32Array; // edge end node
  elen: Float32Array;
  rev: Int32Array; // the edge running the opposite way along the same road (two-way roads), or -1
  out: Int32Array[]; // outgoing edge ids per node
  isSink: Uint8Array;
  sources: number[]; // node ids
  buildings: { x: number; y: number; hp: number }[];
}

/** Original files index nodes from 1; order 0 = source, 100 = sink. */
export function buildGraph(map: MapLike): Graph {
  const n = map.nodes.length;
  const nx = new Float32Array(n), ny = new Float32Array(n), nv = new Float32Array(n);
  const isSink = new Uint8Array(n);
  const sources: number[] = [];
  map.nodes.forEach(([x, y, v], i) => {
    nx[i] = x; ny[i] = y; nv[i] = v;
    if (v === 100) isSink[i] = 1;
    if (v === 0) sources.push(i);
  });
  const m = map.edges.length;
  const eb = new Int32Array(m), ee = new Int32Array(m), elen = new Float32Array(m);
  const outLists: number[][] = Array.from({ length: n }, () => []);
  map.edges.forEach(([b, e], i) => {
    eb[i] = b - 1; ee[i] = e - 1;
    if (eb[i] < 0 || eb[i] >= n || ee[i] < 0 || ee[i] >= n) throw new Error(`edge ${i} references missing node`);
    elen[i] = Math.max(0.001, Math.hypot(nx[ee[i]] - nx[eb[i]], ny[ee[i]] - ny[eb[i]]));
    outLists[eb[i]].push(i);
  });
  const rev = new Int32Array(m).fill(-1);
  for (let i = 0; i < m; i++) for (const j of outLists[ee[i]]) if (ee[j] === eb[i]) { rev[i] = j; break; }
  for (let i = 0; i < n; i++) {
    if (!isSink[i] && outLists[i].length === 0) throw new Error(`node ${i} is a dead end`);
  }
  if (sources.length === 0) throw new Error('map has no source');
  return {
    nx, ny, nv, eb, ee, elen, rev, isSink, sources,
    out: outLists.map((l) => Int32Array.from(l)),
    buildings: map.buildings.map(([x, y, hp]) => ({ x, y, hp })),
  };
}

/** Distance from point to the nearest path segment (used for tower placement). */
export function distanceFromNetwork(g: Graph, px: number, py: number): number {
  let best = Infinity;
  for (let i = 0; i < g.eb.length; i++) {
    const ax = g.nx[g.eb[i]], ay = g.ny[g.eb[i]], bx = g.nx[g.ee[i]], by = g.ny[g.ee[i]];
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)));
  }
  return best;
}
