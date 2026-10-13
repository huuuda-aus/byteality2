import * as THREE from 'three';
import { FIELD_H, FIELD_TOP, FIELD_W, PATH_WIDTH } from './data.ts';
import type { Graph } from './graph.ts';

const add = (m: THREE.Material & { blending: THREE.Blending }) => { m.blending = THREE.AdditiveBlending; m.depthTest = false; m.depthWrite = false; return m; };

/** Procedural dark-wood grain, drawn additively like the original's photo texture. */
function woodTexture(): THREE.CanvasTexture {
  const w = 512, h = 512, cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  const hash = (x: number, y: number) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
  const TAU = Math.PI * 2; // every term is periodic over the 512 px tile so the texture repeats without a seam
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const warp = Math.sin((x / w) * TAU * 2 + Math.sin((y / h) * TAU * 3) * 2) * 6;
      const yy = (y + warp) / h * TAU;
      const grain = 0.5 + 0.5 * Math.sin(yy * 72) * Math.sin(yy * 9 + 1.3);
      const v = 14 + grain * 20 + hash(x, y >> 1) * 8;
      const i = (y * w + x) * 4;
      img.data[i] = v; img.data[i + 1] = v * 1.02; img.data[i + 2] = v * 1.08; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function lines(points: number[], color: number, opacity: number): THREE.LineSegments {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(points), 3));
  const m = add(new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
  const l = new THREE.LineSegments(g, m); l.frustumCulled = false; return l;
}

function disc(x: number, y: number, r: number, rgb: number): THREE.Mesh {
  const geo = new THREE.CircleGeometry(r, 24);
  const col = new THREE.Color(rgb), cols: number[] = [];
  for (let i = 0; i < geo.attributes.position.count; i++) i === 0 ? cols.push(col.r, col.g, col.b) : cols.push(0, 0, 0); // centre glow fading to black
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(cols), 3));
  const m = new THREE.Mesh(geo, add(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })));
  m.position.set(x, y, 0); return m;
}


function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * Outline of the union of all path "tubes" (each edge stroked at 2*half width, round joins):
 * side lines and node circles are cut wherever they would run through the inside of another part of the path.
 */
function pathOutline(g: Graph, half: number): number[] {
  // one tube per road: a two-way road (A->B and B->A) is the same tube
  const seen = new Set<string>();
  const tubes: [number, number, number, number][] = [];
  for (let i = 0; i < g.eb.length; i++) {
    const b = g.eb[i], e = g.ee[i], key = b < e ? `${b}-${e}` : `${e}-${b}`;
    if (seen.has(key)) continue;
    seen.add(key);
    tubes.push([g.nx[b], g.ny[b], g.nx[e], g.ny[e]]);
  }
  // is point p strictly inside any tube (further than `margin` from its boundary)?
  const inside = (x: number, y: number, margin: number) => {
    for (const [ax, ay, bx, by] of tubes) if (distToSegment(x, y, ax, ay, bx, by) < half - margin) return true;
    return false;
  };
  // circle arcs: drop if inside a tube, or lying on a tube's own side line (that line is drawn already)
  const covered = (x: number, y: number) => {
    for (const [ax, ay, bx, by] of tubes) {
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
      const t = ((x - ax) * dx + (y - ay) * dy) / l2;
      const d = distToSegment(x, y, ax, ay, bx, by);
      if (d < half - 0.05 || (d < half + 0.05 && t > 0 && t < 1)) return true;
    }
    return false;
  };
  const out: number[] = [];
  const seg = (x1: number, y1: number, x2: number, y2: number) => out.push(x1, y1, 0, x2, y2, 0);

  for (const [ax, ay, bx, by] of tubes) {
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * half, ny = (dx / len) * half;
    const pieces = Math.max(1, Math.ceil(len)); // ~1 px resolution for the cuts
    for (const side of [1, -1]) {
      let runStart = -1;
      for (let k = 0; k <= pieces; k++) {
        const t = k / pieces;
        const keep = k < pieces && !inside(ax + dx * (k + 0.5) / pieces + side * nx, ay + dy * (k + 0.5) / pieces + side * ny, 0.05);
        if (keep && runStart < 0) runStart = k;
        if (!keep && runStart >= 0) {
          const t0 = runStart / pieces;
          seg(ax + dx * t0 + side * nx, ay + dy * t0 + side * ny, ax + dx * t + side * nx, ay + dy * t + side * ny);
          runStart = -1;
        }
      }
    }
  }
  const N = 32; // node circles = round joins / caps; keep only arcs that are outside every tube
  for (let n = 0; n < g.nx.length; n++) {
    for (let k = 0; k < N; k++) {
      const a0 = (k / N) * Math.PI * 2, a1 = ((k + 1) / N) * Math.PI * 2, am = (a0 + a1) / 2;
      if (covered(g.nx[n] + Math.cos(am) * half, g.ny[n] + Math.sin(am) * half)) continue;
      seg(g.nx[n] + Math.cos(a0) * half, g.ny[n] + Math.sin(a0) * half, g.nx[n] + Math.cos(a1) * half, g.ny[n] + Math.sin(a1) * half);
    }
  }
  return out;
}

/** Static layer: background, path outline, sources/sinks, buildings. */
export function buildStaticScene(g: Graph): THREE.Group {
  const group = new THREE.Group();

  const tex = woodTexture();
  tex.repeat.set(FIELD_W / 512, (FIELD_H - FIELD_TOP) / 512);
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(FIELD_W, FIELD_H - FIELD_TOP),
    add(new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide })));
  bg.position.set(FIELD_W / 2, FIELD_TOP + (FIELD_H - FIELD_TOP) / 2, -1);
  group.add(bg);

  group.add(lines(pathOutline(g, PATH_WIDTH / 2), 0xaab4c8, 0.45));

  for (let n = 0; n < g.nx.length; n++) {
    if (g.isSink[n]) group.add(disc(g.nx[n], g.ny[n], 7.5, 0xff0000));
  }
  for (const s of g.sources) group.add(disc(g.nx[s], g.ny[s], 7.5, 0x3366ff));

  return group;
}
