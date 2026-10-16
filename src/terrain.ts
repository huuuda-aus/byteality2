import * as THREE from 'three';
import type { Graph } from './graph.ts';
import { SLAB } from './view3d.ts';
import { FIELD_H, FIELD_TOP, FIELD_W, PATH_WIDTH } from './data.ts';

const CELL = 4;            // terrain grid spacing in px
const FLOOR = -3.4;        // height of the trench floor
const HALF = PATH_WIDTH / 2;

const hash2 = (x: number, y: number, s: number) => { const v = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453; return v - Math.floor(v); };
function vnoise(x: number, y: number, s: number): number { // smooth value noise
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function strHash(s: string): number { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
const mulberry = (seed: number) => () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

export interface Terrain {
  group: THREE.Group;
  /** Ground height at a field position (towers and buildings stand on it). */
  heightAt(x: number, y: number): number;
  /** Per-frame animation (portals). */
  update(time: number): void;
  floorY: number;
}

/** Faceted low-poly diorama: rolling grass with the enemy path as a real trench, a rock skirt, scenery around the edge and portals at sources/sinks. */
export function buildTerrain(g: Graph, mapName: string): Terrain {
  const seed = strHash(mapName), rnd = mulberry(seed);
  const x0 = SLAB.x0, x1 = SLAB.x1, z0 = SLAB.z0, z1 = SLAB.z1;
  const cols = Math.round((x1 - x0) / CELL), rows = Math.round((z1 - z0) / CELL);
  // distance from every vertex to the path
  const ne = g.eb.length, sx1 = new Float32Array(ne), sy1 = new Float32Array(ne), sx2 = new Float32Array(ne), sy2 = new Float32Array(ne);
  for (let e = 0; e < ne; e++) { sx1[e] = g.nx[g.eb[e]]; sy1[e] = g.ny[g.eb[e]]; sx2[e] = g.nx[g.ee[e]]; sy2[e] = g.ny[g.ee[e]]; }
  const dist = new Float32Array((cols + 1) * (rows + 1)), H = new Float32Array((cols + 1) * (rows + 1));
  const smooth = (e0: number, e1: number, v: number) => { const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
    const x = x0 + i * CELL, z = z0 + j * CELL;
    let d = Infinity;
    for (let e = 0; e < ne; e++) {
      const dx = sx2[e] - sx1[e], dy = sy2[e] - sy1[e], t = Math.max(0, Math.min(1, ((x - sx1[e]) * dx + (z - sy1[e]) * dy) / (dx * dx + dy * dy || 1)));
      const ex = x - (sx1[e] + t * dx), ey = z - (sy1[e] + t * dy), dd = ex * ex + ey * ey;
      if (dd < d) d = dd;
    }
    d = Math.sqrt(d);
    const k = j * (cols + 1) + i; dist[k] = d;
    const hills = (vnoise(x * 0.018, z * 0.018, seed) - 0.5) * 3.2 + (vnoise(x * 0.07, z * 0.07, seed + 5) - 0.5) * 1.1;
    const trench = smooth(HALF + 7, HALF - 2, d); // 0 on the grass, 1 on the floor, smooth wall in between
    const lip = smooth(HALF + 13, HALF + 8, d) * (1 - smooth(HALF + 8, HALF + 4, d)) * 0.7; // a slightly raised edge
    H[k] = (hills + lip) * (1 - trench) + FLOOR * trench + (hash2(i, j, seed) - 0.5) * 0.5 * (1 - 0.6 * trench);
  }
  const heightAt = (x: number, y: number) => {
    const fi = Math.min(cols - 0.001, Math.max(0, (x - x0) / CELL)), fj = Math.min(rows - 0.001, Math.max(0, (y - z0) / CELL)), i = Math.floor(fi), j = Math.floor(fj), u = fi - i, v = fj - j;
    const h = (a: number, b: number) => H[b * (cols + 1) + a];
    return h(i, j) * (1 - u) * (1 - v) + h(i + 1, j) * u * (1 - v) + h(i, j + 1) * (1 - u) * v + h(i + 1, j + 1) * u * v;
  };

  // flat-shaded surface: every triangle gets one colour
  const pos: number[] = [], col: number[] = [];
  const grass = new THREE.Color(0x4f8a4c), grassDark = new THREE.Color(0x3a6d44), dirt = new THREE.Color(0x8a6a48), wall = new THREE.Color(0x6e5a3e), c = new THREE.Color();
  const vtx = (i: number, j: number) => [x0 + i * CELL, H[j * (cols + 1) + i], z0 + j * CELL];
  const tri = (a: number[], b: number[], cc: number[], di: number) => {
    pos.push(...a, ...b, ...cc);
    const avgH = (a[1] + b[1] + cc[1]) / 3, tr = Math.min(1, Math.max(0, -avgH / -FLOOR)); // depth fraction
    const n = hash2(a[0] * 0.5 + b[0], a[2] * 0.5 + cc[2], seed);
    const inField = a[0] > -2 && a[0] < FIELD_W + 2 && a[2] > FIELD_TOP - 2 && a[2] < FIELD_H + 2;
    c.copy(grass).lerp(grassDark, 0.25 + 0.5 * n).multiplyScalar((inField ? 1 : 0.82) * (0.92 + 0.16 * hash2(di, a[0], seed)));
    if (tr > 0.12) c.lerp(tr > 0.7 ? dirt : wall, Math.min(1, (tr - 0.1) * 2.2));
    for (let k = 0; k < 3; k++) col.push(c.r, c.g, c.b);
  };
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const a = vtx(i, j), b = vtx(i + 1, j), d = vtx(i, j + 1), e = vtx(i + 1, j + 1), flip = (i + j) % 2 === 0;
    if (flip) { tri(a, d, b, i * 7 + j); tri(b, d, e, i * 7 + j + 1); } else { tri(a, d, e, i * 7 + j); tri(a, e, b, i * 7 + j + 1); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); geo.computeVertexNormals();
  const group = new THREE.Group();
  const surface = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  surface.receiveShadow = true; group.add(surface);

  // rock skirt around the slab
  const skirt: number[] = [], skirtCol: number[] = [], rock = new THREE.Color(0x4a3c30), rock2 = new THREE.Color(0x362b23), bottom = -18;
  const wallQuad = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => {
    skirt.push(ax, ay, az, bx, by, bz, ax, bottom, az, bx, by, bz, bx, bottom, bz, ax, bottom, az);
    const cc = rock.clone().lerp(rock2, hash2(ax, az, seed)); for (let k = 0; k < 6; k++) skirtCol.push(cc.r, cc.g, cc.b);
  };
  for (let i = 0; i < cols; i++) { wallQuad(...(vtx(i, 0) as [number, number, number]), ...(vtx(i + 1, 0) as [number, number, number])); wallQuad(...(vtx(i + 1, rows) as [number, number, number]), ...(vtx(i, rows) as [number, number, number])); }
  for (let j = 0; j < rows; j++) { wallQuad(...(vtx(0, j + 1) as [number, number, number]), ...(vtx(0, j) as [number, number, number])); wallQuad(...(vtx(cols, j) as [number, number, number]), ...(vtx(cols, j + 1) as [number, number, number])); }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(skirt, 3)); sg.setAttribute('color', new THREE.Float32BufferAttribute(skirtCol, 3)); sg.computeVertexNormals();
  group.add(new THREE.Mesh(sg, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide })));

  // scenery in the margin: pines and rocks (never on the playfield)
  const outside = (x: number, y: number) => x < -6 || x > FIELD_W + 6 || y < FIELD_TOP - 6 || y > FIELD_H + 6;
  const spots: { x: number; y: number; s: number }[] = [];
  for (let tries = 0; tries < 900 && spots.length < 150; tries++) {
    const x = x0 + 6 + rnd() * (x1 - x0 - 12), y = z0 + 6 + rnd() * (z1 - z0 - 12);
    if (outside(x, y) && spots.every((p) => Math.hypot(p.x - x, p.y - y) > 13)) spots.push({ x, y, s: 0.7 + rnd() * 0.8 });
  }
  const trunkGeo = new THREE.CylinderGeometry(1.4, 1.8, 5, 5), coneA = new THREE.ConeGeometry(7, 12, 6), coneB = new THREE.ConeGeometry(5, 10, 6);
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: 0x6b4a2f, flatShading: true }), spots.length);
  const lows = new THREE.InstancedMesh(coneA, new THREE.MeshLambertMaterial({ flatShading: true }), spots.length);
  const highs = new THREE.InstancedMesh(coneB, new THREE.MeshLambertMaterial({ flatShading: true }), spots.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), scl = new THREE.Vector3(), p = new THREE.Vector3(), tint = new THREE.Color();
  spots.forEach((s, i) => {
    const h = heightAt(s.x, s.y), yaw = rnd() * 6.28; q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    scl.setScalar(s.s);
    trunks.setMatrixAt(i, m4.compose(p.set(s.x, h + 2.5 * s.s, s.y), q, scl));
    lows.setMatrixAt(i, m4.compose(p.set(s.x, h + 10 * s.s, s.y), q, scl));
    highs.setMatrixAt(i, m4.compose(p.set(s.x, h + 18 * s.s, s.y), q, scl));
    tint.setHSL(0.33 + (rnd() - 0.5) * 0.06, 0.45, 0.2 + rnd() * 0.12); lows.setColorAt(i, tint); highs.setColorAt(i, tint.clone().offsetHSL(0, 0, 0.04));
  });
  for (const m of [trunks, lows, highs]) { m.castShadow = true; m.receiveShadow = false; group.add(m); }
  const rocks: { x: number; y: number; s: number }[] = [];
  for (let tries = 0; tries < 400 && rocks.length < 50; tries++) {
    const x = x0 + 4 + rnd() * (x1 - x0 - 8), y = z0 + 4 + rnd() * (z1 - z0 - 8);
    if (outside(x, y) && spots.every((t) => Math.hypot(t.x - x, t.y - y) > 10)) rocks.push({ x, y, s: 0.6 + rnd() * 1.1 });
  }
  const rockMesh = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(4, 0), new THREE.MeshLambertMaterial({ flatShading: true }), rocks.length);
  rocks.forEach((r, i) => { q.setFromEuler(new THREE.Euler(rnd() * 3, rnd() * 3, rnd() * 3)); scl.set(r.s, r.s * 0.7, r.s); rockMesh.setMatrixAt(i, m4.compose(p.set(r.x, heightAt(r.x, r.y) + 1.5 * r.s, r.y), q, scl)); rockMesh.setColorAt(i, tint.setHSL(0.08, 0.08, 0.3 + rnd() * 0.15)); });
  rockMesh.castShadow = true; group.add(rockMesh);

  // portals: blue ring where enemies appear, red crystal where they leave
  const portals: THREE.Object3D[] = [];
  const ringGeo = new THREE.TorusGeometry(8, 1.8, 4, 8), crystalGeo = new THREE.OctahedronGeometry(6, 0);
  for (const s of g.sources) {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0x4aa8ff })); m.rotation.x = Math.PI / 2; m.position.set(g.nx[s], FLOOR + 1.2, g.ny[s]); group.add(m); portals.push(m);
    const glow = new THREE.Mesh(new THREE.CircleGeometry(7, 8), new THREE.MeshBasicMaterial({ color: 0x2a6fe0, transparent: true, opacity: 0.55 })); glow.rotation.x = -Math.PI / 2; glow.position.set(g.nx[s], FLOOR + 0.3, g.ny[s]); group.add(glow);
  }
  for (let n = 0; n < g.nx.length; n++) if (g.isSink[n]) {
    const m = new THREE.Mesh(crystalGeo, new THREE.MeshBasicMaterial({ color: 0xff4a4a })); m.position.set(g.nx[n], FLOOR + 7, g.ny[n]); m.scale.y = 1.4; group.add(m); portals.push(m);
    const glow = new THREE.Mesh(new THREE.CircleGeometry(8, 8), new THREE.MeshBasicMaterial({ color: 0xc02020, transparent: true, opacity: 0.55 })); glow.rotation.x = -Math.PI / 2; glow.position.set(g.nx[n], FLOOR + 0.3, g.ny[n]); group.add(glow);
  }
  return {
    group, heightAt, floorY: FLOOR,
    update(time: number) { portals.forEach((m, i) => { if ((m as THREE.Mesh).geometry === crystalGeo) { m.rotation.y = time * 1.4 + i; m.position.y = FLOOR + 7 + Math.sin(time * 2 + i) * 1.2; } else m.rotation.z = time * 0.8; }); },
  };
}
