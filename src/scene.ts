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


/** Direction the light comes from, in field coordinates (x right, y down): from the top left, a little above the surface. */
const LIGHT = (() => { const v = [-0.55, -0.7, 0.62], l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; })();
const CARVE_SCALE = 2; // texture pixels per field pixel
const CARVE_DEPTH = 2.8; // steepness of the groove walls (bigger = stronger bevels)

/** Separable box blur (several passes ~ a gaussian) of a w*h float image, in place. */
function boxBlur(a: Float32Array, w: number, h: number, r: number, passes: number): void {
  const t = new Float32Array(Math.max(w, h));
  const run = (get: (i: number) => number, set: (i: number, v: number) => void, n: number) => {
    let sum = 0; const win = 2 * r + 1;
    for (let i = -r; i <= r; i++) sum += get(Math.min(n - 1, Math.max(0, i)));
    for (let i = 0; i < n; i++) {
      t[i] = sum / win;
      sum += get(Math.min(n - 1, i + r + 1)) - get(Math.max(0, i - r));
    }
    for (let i = 0; i < n; i++) set(i, t[i]);
  };
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) run((i) => a[y * w + i], (i, v) => { a[y * w + i] = v; }, w);
    for (let x = 0; x < w; x++) run((i) => a[i * w + x], (i, v) => { a[i * w + x] = v; }, h);
  }
}

/**
 * The path as a groove carved into the wood: rasterise the path, blur it into a smooth height field, and light it from LIGHT.
 * Walls facing the light are brightened, walls facing away are shadowed, and the groove floor is a little darker than the surface.
 * Returns a transparent overlay covering the playfield.
 */
function carvedPath(g: Graph): THREE.Mesh {
  const S = CARVE_SCALE, W = FIELD_W * S, H = (FIELD_H - FIELD_TOP) * S;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#fff'; ctx.lineWidth = PATH_WIDTH * S; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let i = 0; i < g.eb.length; i++) {
    ctx.moveTo(g.nx[g.eb[i]] * S, (g.ny[g.eb[i]] - FIELD_TOP) * S); ctx.lineTo(g.nx[g.ee[i]] * S, (g.ny[g.ee[i]] - FIELD_TOP) * S);
  }
  ctx.stroke();
  const px = ctx.getImageData(0, 0, W, H), m = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) m[i] = px.data[i * 4] / 255;
  boxBlur(m, W, H, 1, 3); // narrow blur = narrow, crisper bevels
  const [lx, ly, lz] = LIGHT, D = CARVE_DEPTH;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    const gx = ((x + 1 < W ? m[i + 1] : m[i]) - (x > 0 ? m[i - 1] : m[i])) / 2, gy = ((y + 1 < H ? m[i + W] : m[i]) - (y > 0 ? m[i - W] : m[i])) / 2;
    // height = -D*m, so the surface normal is (D*gx, D*gy, 1)
    const nx = D * gx, ny = D * gy, inv = 1 / Math.hypot(nx, ny, 1);
    const shade = (nx * lx + ny * ly + lz) * inv - lz; // 0 on flat ground, <0 facing away from the light, >0 facing it
    const floor = 0.38 * m[i]; // the groove floor is darker than the surface
    let r = 0, gch = 0, b = 0, a: number;
    if (shade >= 0) { r = 235; gch = 215; b = 190; a = Math.min(0.5, shade * 1.1); }  // lit wall: warm highlight
    else a = Math.min(0.7, -shade * 1.3);                                           // shadowed wall: black
    const total = 1 - (1 - a) * (1 - floor); // combine with the floor darkening (black over everything)
    if (shade >= 0 && floor > 0) { const wf = a / total; r *= wf; gch *= wf; b *= wf; } // blend toward black as the floor term takes over
    const o = i * 4; px.data[o] = r; px.data[o + 1] = gch; px.data[o + 2] = b; px.data[o + 3] = Math.round(total * 255);
  }
  ctx.putImageData(px, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.flipY = false; tex.colorSpace = THREE.SRGBColorSpace; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(FIELD_W, FIELD_H - FIELD_TOP),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
  mesh.position.set(FIELD_W / 2, FIELD_TOP + (FIELD_H - FIELD_TOP) / 2, -0.5);
  return mesh;
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

  group.add(carvedPath(g));

  for (let n = 0; n < g.nx.length; n++) {
    if (g.isSink[n]) group.add(disc(g.nx[n], g.ny[n], 7.5, 0xff0000));
  }
  for (const s of g.sources) group.add(disc(g.nx[s], g.ny[s], 7.5, 0x3366ff));

  return group;
}
