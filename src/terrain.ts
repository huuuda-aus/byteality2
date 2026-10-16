import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { Graph } from './graph.ts';
import { SLAB } from './view3d.ts';
import { FIELD_H, FIELD_TOP, FIELD_W, PATH_WIDTH } from './data.ts';
import { NEON, PARTS, PartBuilder } from './boardParts.ts';

const CELL = 4;            // terrain grid spacing in px
const PANEL = 24;          // board panel size in px (a multiple of CELL)
const FLOOR = -3.4;        // height of the trench floor
const GROOVE = 0.35;       // depth of the seams between panels
const HALF = PATH_WIDTH / 2;
const LIP_ISO = HALF + 5.5; // distance from the path centre where the glowing trench edge runs

const hash2 = (x: number, y: number, s: number) => { const v = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453; return v - Math.floor(v); };
function strHash(s: string): number { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
const mulberry = (seed: number) => () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const smooth = (e0: number, e1: number, v: number) => { const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

export interface Terrain {
  group: THREE.Group;
  /** Ground height at a field position (towers and buildings stand on it). */
  heightAt(x: number, y: number): number;
  /** Per-frame animation (portals, glow pulses, data packets on the traces). */
  update(time: number): void;
  floorY: number;
}

/** Glowing wide line segments (pixel width, additive). Their materials are kept so the resolution can follow the window. */
function fatLines(pts: number[], color: number, width: number, opacity: number, mats: LineMaterial[]): LineSegments2 {
  const geo = new LineSegmentsGeometry(); geo.setPositions(pts);
  const mat = new LineMaterial({ color, linewidth: width, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending });
  mats.push(mat);
  const l = new LineSegments2(geo, mat); l.frustumCulled = false; return l;
}

/** Marching squares over the distance grid: segments of the contour d = iso, as flat [x,z,x,z,...]. */
function contour(dist: Float32Array, cols: number, rows: number, x0: number, z0: number, iso: number): number[] {
  const out: number[] = [], w = cols + 1;
  const cross = (i0: number, j0: number, i1: number, j1: number): [number, number] | null => {
    const a = dist[j0 * w + i0] - iso, b = dist[j1 * w + i1] - iso;
    if ((a < 0) === (b < 0)) return null;
    const t = a / (a - b);
    return [x0 + (i0 + (i1 - i0) * t) * CELL, z0 + (j0 + (j1 - j0) * t) * CELL];
  };
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const pts = [cross(i, j, i + 1, j), cross(i + 1, j, i + 1, j + 1), cross(i, j + 1, i + 1, j + 1), cross(i, j, i, j + 1)].filter((p): p is [number, number] => !!p);
    if (pts.length === 2) out.push(pts[0][0], pts[0][1], pts[1][0], pts[1][1]);
    else if (pts.length === 4) out.push(pts[0][0], pts[0][1], pts[3][0], pts[3][1], pts[1][0], pts[1][1], pts[2][0], pts[2][1]);
  }
  return out;
}

/**
 * Sci-fi circuit-board diorama: dark panelled board with the enemy path as a trench lined with neon, signal traces and low-poly
 * motherboard parts (solid and wireframe) around the edge, portals at sources/sinks.
 */
export function buildTerrain(g: Graph, mapName: string): Terrain {
  const seed = strHash(mapName), rnd = mulberry(seed);
  const x0 = SLAB.x0, x1 = SLAB.x1, z0 = SLAB.z0, z1 = SLAB.z1;
  const cols = Math.round((x1 - x0) / CELL), rows = Math.round((z1 - z0) / CELL), w = cols + 1;
  const mats: LineMaterial[] = [];
  // distance from every vertex to the path
  const ne = g.eb.length, sx1 = new Float32Array(ne), sy1 = new Float32Array(ne), sx2 = new Float32Array(ne), sy2 = new Float32Array(ne);
  for (let e = 0; e < ne; e++) { sx1[e] = g.nx[g.eb[e]]; sy1[e] = g.ny[g.eb[e]]; sx2[e] = g.nx[g.ee[e]]; sy2[e] = g.ny[g.ee[e]]; }
  const dist = new Float32Array(w * (rows + 1)), H = new Float32Array(w * (rows + 1)), seam = new Uint8Array(w * (rows + 1));
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
    const x = x0 + i * CELL, z = z0 + j * CELL;
    let d = Infinity;
    for (let e = 0; e < ne; e++) {
      const dx = sx2[e] - sx1[e], dy = sy2[e] - sy1[e], t = Math.max(0, Math.min(1, ((x - sx1[e]) * dx + (z - sy1[e]) * dy) / (dx * dx + dy * dy || 1)));
      const ex = x - (sx1[e] + t * dx), ey = z - (sy1[e] + t * dy), dd = ex * ex + ey * ey;
      if (dd < d) d = dd;
    }
    d = Math.sqrt(d);
    const k = j * w + i; dist[k] = d;
    const onSeam = Math.round(x / CELL) % (PANEL / CELL) === 0 || Math.round(z / CELL) % (PANEL / CELL) === 0; seam[k] = onSeam ? 1 : 0;
    const trench = smooth(HALF + 7, HALF - 2, d); // 0 on the board, 1 on the floor, smooth wall in between
    const lip = smooth(HALF + 13, HALF + 8, d) * (1 - smooth(HALF + 8, HALF + 4, d)) * 0.5; // a slightly raised edge
    H[k] = (onSeam ? -GROOVE : 0) * (1 - trench) + lip * (1 - trench) + FLOOR * trench;
  }
  const heightAt = (x: number, y: number) => {
    const fi = Math.min(cols - 0.001, Math.max(0, (x - x0) / CELL)), fj = Math.min(rows - 0.001, Math.max(0, (y - z0) / CELL)), i = Math.floor(fi), j = Math.floor(fj), u = fi - i, v = fj - j;
    const h = (a: number, b: number) => H[b * w + a];
    return h(i, j) * (1 - u) * (1 - v) + h(i + 1, j) * u * (1 - v) + h(i, j + 1) * (1 - u) * v + h(i + 1, j + 1) * u * v;
  };
  const distAt = (x: number, y: number) => dist[Math.min(rows, Math.max(0, Math.round((y - z0) / CELL))) * w + Math.min(cols, Math.max(0, Math.round((x - x0) / CELL)))];

  // flat-shaded surface: one colour per triangle; panels vary a little, seams are darker, the trench is almost black
  const pos: number[] = [], col: number[] = [];
  const panelA = new THREE.Color(0x15222e), panelB = new THREE.Color(0x1d3040), seamC = new THREE.Color(0x070d13), floorC = new THREE.Color(0x05090e), wallC = new THREE.Color(0x0e1a25), c = new THREE.Color();
  const vtx = (i: number, j: number) => [x0 + i * CELL, H[j * w + i], z0 + j * CELL];
  const tri = (a: number[], b: number[], cc: number[], ia: number, ib: number, ic: number) => {
    pos.push(...a, ...b, ...cc);
    const avgH = (a[1] + b[1] + cc[1]) / 3, depth = Math.min(1, Math.max(0, avgH / FLOOR));
    const px = Math.floor(a[0] / PANEL), pz = Math.floor(a[2] / PANEL);
    const inField = a[0] > -2 && a[0] < FIELD_W + 2 && a[2] > FIELD_TOP - 2 && a[2] < FIELD_H + 2;
    c.copy(panelA).lerp(panelB, hash2(px, pz, seed) * 0.8).multiplyScalar(inField ? 1 : 0.7);
    if (seam[ia] && seam[ib] && seam[ic]) c.lerp(seamC, 0.85);
    if (depth > 0.05) c.lerp(depth > 0.8 ? floorC : wallC, Math.min(1, depth * 2.5));
    for (let k = 0; k < 3; k++) col.push(c.r, c.g, c.b);
  };
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const a = vtx(i, j), b = vtx(i + 1, j), d = vtx(i, j + 1), e = vtx(i + 1, j + 1), flip = (i + j) % 2 === 0;
    const ka = j * w + i, kb = ka + 1, kd = ka + w, ke = kd + 1;
    if (flip) { tri(a, d, b, ka, kd, kb); tri(b, d, e, kb, kd, ke); } else { tri(a, d, e, ka, kd, ke); tri(a, e, b, ka, ke, kb); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); geo.computeVertexNormals();
  const group = new THREE.Group();
  const surface = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  surface.receiveShadow = true; group.add(surface);

  // dark metal skirt around the slab
  const skirt: number[] = [], skirtCol: number[] = [], metal = new THREE.Color(0x0a121a), metal2 = new THREE.Color(0x05090d), bottom = -18;
  const wallQuad = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => {
    skirt.push(ax, ay, az, bx, by, bz, ax, bottom, az, bx, by, bz, bx, bottom, bz, ax, bottom, az);
    const cc = metal.clone().lerp(metal2, hash2(ax, az, seed)); for (let k = 0; k < 6; k++) skirtCol.push(cc.r, cc.g, cc.b);
  };
  for (let i = 0; i < cols; i++) { wallQuad(...(vtx(i, 0) as [number, number, number]), ...(vtx(i + 1, 0) as [number, number, number])); wallQuad(...(vtx(i + 1, rows) as [number, number, number]), ...(vtx(i, rows) as [number, number, number])); }
  for (let j = 0; j < rows; j++) { wallQuad(...(vtx(0, j + 1) as [number, number, number]), ...(vtx(0, j) as [number, number, number])); wallQuad(...(vtx(cols, j) as [number, number, number]), ...(vtx(cols, j + 1) as [number, number, number])); }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(skirt, 3)); sg.setAttribute('color', new THREE.Float32BufferAttribute(skirtCol, 3)); sg.computeVertexNormals();
  group.add(new THREE.Mesh(sg, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide })));

  // ---- neon lines ----
  const glowLines: LineSegments2[] = [];
  const lift = (x: number, z: number, dy: number) => [x, heightAt(x, z) + dy, z];
  // trench lip (bright, with a wider soft halo) and floor edge (dim)
  const lipPts: number[] = [], floorPts: number[] = [];
  const lipXZ = contour(dist, cols, rows, x0, z0, LIP_ISO), floorXZ = contour(dist, cols, rows, x0, z0, HALF - 1);
  for (let i = 0; i < lipXZ.length; i += 2) lipPts.push(...lift(lipXZ[i], lipXZ[i + 1], 0.7));
  for (let i = 0; i < floorXZ.length; i += 2) floorPts.push(...lift(floorXZ[i], floorXZ[i + 1], 0.5));
  if (lipPts.length) { glowLines.push(fatLines(lipPts, NEON.cyan, 5, 0.08, mats), fatLines(lipPts, NEON.cyan, 1.4, 0.6, mats)); }
  if (floorPts.length) glowLines.push(fatLines(floorPts, NEON.blue, 1, 0.35, mats));
  // playfield outline and slab rim
  const fo = [[-2, FIELD_TOP - 2], [FIELD_W + 2, FIELD_TOP - 2], [FIELD_W + 2, FIELD_H + 2], [-2, FIELD_H + 2]];
  const outline: number[] = [];
  for (let i = 0; i < 4; i++) { const a = fo[i], b = fo[(i + 1) % 4], n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 10); for (let s = 0; s < n; s++) { const t0 = s / n, t1 = (s + 1) / n; outline.push(...lift(a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0, 0.7), ...lift(a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1, 0.7)); } }
  const outlineSafe: number[] = []; // keep the outline out of trenches that run off the field
  for (let i = 0; i < outline.length; i += 6) if (distAt(outline[i], outline[i + 2]) > HALF + 7) outlineSafe.push(...outline.slice(i, i + 6));
  if (outlineSafe.length) glowLines.push(fatLines(outlineSafe, NEON.cyan, 1, 0.25, mats));
  const rimCorners = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], rimPts: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [ax, az] = rimCorners[i], [bx, bz] = rimCorners[(i + 1) % 4], n = Math.ceil(Math.hypot(bx - ax, bz - az) / CELL);
    for (let s = 0; s < n; s++) rimPts.push(...lift(ax + ((bx - ax) * s) / n, az + ((bz - az) * s) / n, 0.5), ...lift(ax + ((bx - ax) * (s + 1)) / n, az + ((bz - az) * (s + 1)) / n, 0.5));
  }
  glowLines.push(fatLines(rimPts, NEON.cyan, 4, 0.06, mats), fatLines(rimPts, NEON.cyan, 1.2, 0.5, mats));

  // faint panel-corner ticks (thin lines)
  const ticks: number[] = [];
  for (let px = Math.ceil(x0 / PANEL) * PANEL; px <= x1 - 1; px += PANEL) for (let pz = Math.ceil(z0 / PANEL) * PANEL; pz <= z1 - 1; pz += PANEL) {
    if (distAt(px, pz) < HALF + 9) continue;
    const t = 2.2; ticks.push(...lift(px - t, pz, 0.3), ...lift(px + t, pz, 0.3), ...lift(px, pz - t, 0.3), ...lift(px, pz + t, 0.3));
  }
  const tickGeo = new THREE.BufferGeometry(); tickGeo.setAttribute('position', new THREE.Float32BufferAttribute(ticks, 3));
  group.add(new THREE.LineSegments(tickGeo, new THREE.LineBasicMaterial({ color: NEON.cyan, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending })));

  // ---- margin: signal traces and motherboard parts (never on the playfield) ----
  const mx0 = x0 + 3, mx1 = x1 - 3, mz0 = z0 + 3, mz1 = z1 - 3;
  const fieldRect = { x0: -4, x1: FIELD_W + 4, z0: FIELD_TOP - 4, z1: FIELD_H + 4 };
  const traces: number[][] = []; // polylines [x,z,x,z,...] for the data packets
  const tracePts: number[] = [];
  const addTrace = (pl: number[]) => {
    traces.push(pl);
    for (let i = 0; i + 3 < pl.length; i += 2) tracePts.push(...lift(pl[i], pl[i + 1], 0.35), ...lift(pl[i + 2], pl[i + 3], 0.35));
  };
  // a bus is a few parallel lines running along a margin strip with one 45 degree jog
  const strips: { horizontal: boolean; c0: number; c1: number; a0: number; a1: number }[] = [
    { horizontal: true, c0: mz0 + 4, c1: fieldRect.z0 - 5, a0: mx0, a1: mx1 },
    { horizontal: true, c0: fieldRect.z1 + 5, c1: mz1 - 4, a0: mx0, a1: mx1 },
    { horizontal: false, c0: mx0 + 4, c1: fieldRect.x0 - 5, a0: mz0, a1: mz1 },
    { horizontal: false, c0: fieldRect.x1 + 5, c1: mx1 - 4, a0: mz0, a1: mz1 },
  ];
  for (const s of strips) for (let k = 0; k < 5; k++) {
    const lines = 2 + Math.floor(rnd() * 3), sp = 2.2, jog = (rnd() < 0.5 ? -1 : 1) * (4 + Math.floor(rnd() * 3) * 2);
    const base = s.c0 + 6 + rnd() * Math.max(1, s.c1 - s.c0 - 12 - Math.abs(jog)), len = 70 + rnd() * 220, start = s.a0 + rnd() * Math.max(1, s.a1 - s.a0 - len), mid = start + len * (0.35 + rnd() * 0.3);
    for (let l = 0; l < lines; l++) {
      const o = l * sp, a = [start, base + o], b = [mid, base + o], c2 = [mid + Math.abs(jog), base + o + jog], d = [start + len, base + o + jog];
      const flat = [...a, ...b, ...c2, ...d];
      addTrace(s.horizontal ? flat : flat.map((_, i) => flat[i ^ 1])); // swap x/z for vertical strips
    }
  }
  if (tracePts.length) group.add(fatLines(tracePts, NEON.cyan, 1.2, 0.5, mats));

  // parts
  const builder = new PartBuilder(), placed: { x: number; z: number; hx: number; hz: number }[] = [];
  const totalW = PARTS.reduce((s, p) => s + p.weight, 0);
  for (let tries = 0; tries < 700 && placed.length < 60; tries++) {
    let r = rnd() * totalW, part = PARTS[0];
    for (const p of PARTS) { r -= p.weight; if (r <= 0) { part = p; break; } }
    const quarter = Math.floor(rnd() * 4), swap = quarter % 2 === 1, hx = swap ? part.hz : part.hx, hz = swap ? part.hx : part.hz;
    const x = x0 + hx + 2 + rnd() * (x1 - x0 - 2 * hx - 4), z = z0 + hz + 2 + rnd() * (z1 - z0 - 2 * hz - 4);
    if (x + hx > fieldRect.x0 && x - hx < fieldRect.x1 && z + hz > fieldRect.z0 && z - hz < fieldRect.z1) continue; // not on the playfield
    if (distAt(x, z) < HALF + 12 + Math.max(hx, hz) * 0.5) continue;                                              // nor near a trench (paths may leave the field)
    if (placed.some((p) => Math.abs(p.x - x) < p.hx + hx + 3 && Math.abs(p.z - z) < p.hz + hz + 3)) continue;
    placed.push({ x, z, hx, hz });
    builder.begin(x, heightAt(x, z), z, quarter * (Math.PI / 2), 1);
    part.build(builder, rnd);
  }
  const solids = new THREE.Mesh(builder.solidGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  solids.castShadow = true; solids.receiveShadow = true; group.add(solids);
  group.add(new THREE.LineSegments(builder.lineGeometry(), new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending })));
  glowLines.forEach((l) => group.add(l));

  // data packets: bright points sliding along the traces
  const packets = traces.length ? Array.from({ length: Math.min(40, traces.length * 2) }, () => ({ trace: Math.floor(rnd() * traces.length), t: rnd(), speed: 30 + rnd() * 60 })) : [];
  const traceLen = traces.map((pl) => { let L = 0; for (let i = 0; i + 3 < pl.length; i += 2) L += Math.hypot(pl[i + 2] - pl[i], pl[i + 3] - pl[i + 1]); return L; });
  const packetGeo = new THREE.BufferGeometry(); packetGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(packets.length * 3), 3));
  const packetMesh = new THREE.Points(packetGeo, new THREE.PointsMaterial({ color: 0xbffaff, size: 3.5, sizeAttenuation: false, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending }));
  packetMesh.frustumCulled = false; group.add(packetMesh);
  const along = (k: number, dist0: number, out: Float32Array, o: number) => {
    const pl = traces[k]; let rest = dist0;
    for (let i = 0; i + 3 < pl.length; i += 2) {
      const seg = Math.hypot(pl[i + 2] - pl[i], pl[i + 3] - pl[i + 1]);
      if (rest <= seg || i + 4 >= pl.length) { const t = seg ? Math.min(1, rest / seg) : 0, x = pl[i] + (pl[i + 2] - pl[i]) * t, z = pl[i + 1] + (pl[i + 3] - pl[i + 1]) * t; out[o] = x; out[o + 1] = heightAt(x, z) + 0.9; out[o + 2] = z; return; }
      rest -= seg;
    }
  };

  // ---- portals: cyan wire ring where enemies appear, orange wire crystal where they leave ----
  const portals: THREE.Object3D[] = [];
  const ringGeo = new THREE.TorusGeometry(8, 1.6, 4, 8), crystalGeo = new THREE.OctahedronGeometry(6, 0);
  for (const s of g.sources) {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: NEON.cyan, wireframe: true })); m.rotation.x = Math.PI / 2; m.position.set(g.nx[s], FLOOR + 1.2, g.ny[s]); group.add(m); portals.push(m);
    const glow = new THREE.Mesh(new THREE.CircleGeometry(7, 8), new THREE.MeshBasicMaterial({ color: 0x1590c0, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false })); glow.rotation.x = -Math.PI / 2; glow.position.set(g.nx[s], FLOOR + 0.3, g.ny[s]); group.add(glow);
  }
  for (let n = 0; n < g.nx.length; n++) if (g.isSink[n]) {
    const m = new THREE.Mesh(crystalGeo, new THREE.MeshBasicMaterial({ color: NEON.orange, wireframe: true })); m.position.set(g.nx[n], FLOOR + 7, g.ny[n]); m.scale.y = 1.4; group.add(m); portals.push(m);
    const glow = new THREE.Mesh(new THREE.CircleGeometry(8, 8), new THREE.MeshBasicMaterial({ color: 0xc05010, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false })); glow.rotation.x = -Math.PI / 2; glow.position.set(g.nx[n], FLOOR + 0.3, g.ny[n]); group.add(glow);
  }

  const pos3 = packetGeo.attributes.position as THREE.BufferAttribute;
  return {
    group, heightAt, floorY: FLOOR,
    update(time: number) {
      portals.forEach((m, i) => { if ((m as THREE.Mesh).geometry === crystalGeo) { m.rotation.y = time * 1.4 + i; m.position.y = FLOOR + 7 + Math.sin(time * 2 + i) * 1.2; } else m.rotation.z = time * 0.8; });
      for (const mt of mats) mt.resolution.set(innerWidth, innerHeight);
      packets.forEach((p, i) => { const L = traceLen[p.trace] || 1; along(p.trace, (p.t * L + time * p.speed) % L, pos3.array as Float32Array, i * 3); });
      pos3.needsUpdate = true;
    },
  };
}
