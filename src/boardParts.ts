import * as THREE from 'three';

/** Palette of the circuit-board look: dark fills, neon edges. */
export const NEON = { cyan: 0x2ee6ff, blue: 0x3a7bff, orange: 0xff8a2e, teal: 0x19d9b0, violet: 0x9a6bff };
const FILL = 0x0b1620, FILL_LIGHT = 0x12222f;

/**
 * Collects low-poly motherboard parts into two buffers: dark flat-shaded solids and glowing edge lines.
 * Every part is built in local space (y up, footprint centred on the origin) and placed with `begin`.
 */
export class PartBuilder {
  readonly solidPos: number[] = []; readonly solidCol: number[] = [];
  readonly linePos: number[] = []; readonly lineCol: number[] = [];
  private base = new THREE.Matrix4(); private m = new THREE.Matrix4(); private c = new THREE.Color();

  begin(x: number, y: number, z: number, rotY: number, scale: number): void {
    this.base.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY), new THREE.Vector3(scale, scale, scale));
  }

  private pushLines(pos: ArrayLike<number>, color: number): void {
    this.c.set(color);
    for (let i = 0; i < pos.length; i += 3) { this.linePos.push(pos[i], pos[i + 1], pos[i + 2]); this.lineCol.push(this.c.r, this.c.g, this.c.b); }
  }

  /** Dark solid with an outline of its sharp edges. `wire` instead draws every triangle edge and no fill (a see-through ghost of the part). */
  shape(geo: THREE.BufferGeometry, x: number, y: number, z: number, edge: number, opts: { fill?: number; wire?: boolean; rx?: number; ry?: number; rz?: number; sx?: number; sy?: number; sz?: number } = {}): void {
    const g = geo.clone();
    this.m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(opts.rx ?? 0, opts.ry ?? 0, opts.rz ?? 0)), new THREE.Vector3(opts.sx ?? 1, opts.sy ?? 1, opts.sz ?? 1));
    g.applyMatrix4(this.m.premultiply(this.base));
    if (opts.wire) {
      this.pushLines(new THREE.WireframeGeometry(g).attributes.position.array, edge);
    } else {
      const flat = g.index ? g.toNonIndexed() : g, p = flat.attributes.position.array;
      this.c.set(opts.fill ?? FILL);
      for (let i = 0; i < p.length; i += 3) { this.solidPos.push(p[i], p[i + 1], p[i + 2]); this.solidCol.push(this.c.r, this.c.g, this.c.b); }
      this.pushLines(new THREE.EdgesGeometry(g, 25).attributes.position.array, edge);
    }
    g.dispose();
  }

  /** Free line segments given in local space as [x1,y1,z1,x2,y2,z2,...]. */
  lines(pts: number[], color: number): void {
    const v = new THREE.Vector3(), out: number[] = [];
    for (let i = 0; i < pts.length; i += 3) { v.set(pts[i], pts[i + 1], pts[i + 2]).applyMatrix4(this.base); out.push(v.x, v.y, v.z); }
    this.pushLines(out, color);
  }

  solidGeometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.solidPos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(this.solidCol, 3)); g.computeVertexNormals();
    return g;
  }
  lineGeometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.linePos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(this.lineCol, 3));
    return g;
  }
}

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const cyl = (r0: number, r1: number, h: number, seg: number) => new THREE.CylinderGeometry(r0, r1, h, seg);

/** A part: draws itself at the builder's current placement, `rnd` picks the accent colour. Footprint is the half-extent (x, z) before rotation. */
export interface Part { name: string; hx: number; hz: number; weight: number; build(b: PartBuilder, rnd: () => number): void }

const pick = (rnd: () => number, ...c: number[]) => c[Math.floor(rnd() * c.length)];
const accent = (rnd: () => number) => pick(rnd, NEON.cyan, NEON.cyan, NEON.cyan, NEON.blue, NEON.teal, NEON.orange);

export const PARTS: Part[] = [
  { name: 'capacitor', hx: 6, hz: 6, weight: 4, build(b, rnd) {
    const col = accent(rnd), h = 8 + rnd() * 6;
    b.shape(cyl(4.2, 4.2, h, 8), 0, h / 2, 0, col);
    b.shape(cyl(3.3, 3.3, 0.8, 8), 0, h + 0.4, 0, col, { fill: FILL_LIGHT });
    b.lines([-1.6, h + 0.85, 0, 1.6, h + 0.85, 0], col); // polarity mark
  } },
  { name: 'chip', hx: 14, hz: 14, weight: 3, build(b, rnd) {
    const col = accent(rnd), s = 16 + rnd() * 5, half = s / 2, pins: number[] = [];
    b.shape(box(s, 3, s), 0, 1.5, 0, col);
    for (let i = 0; i < 6; i++) { const t = -half + (s * (i + 0.5)) / 6; pins.push(t, 0.9, -half, t, 0.9, -half - 3, t, 0.9, half, t, 0.9, half + 3, -half, 0.9, t, -half - 3, 0.9, t, half, 0.9, t, half + 3, 0.9, t); }
    b.lines(pins, col);
    const q = half - 3; // die outline + pin-1 marker
    b.lines([-q, 3.05, -q, q, 3.05, -q, q, 3.05, -q, q, 3.05, q, q, 3.05, q, -q, 3.05, q, -q, 3.05, q, -q, 3.05, -q, -q, 3.05, -q + 3, -q + 3, 3.05, -q], col);
  } },
  { name: 'cpu', hx: 15, hz: 15, weight: 1, build(b, rnd) {
    const col = pick(rnd, NEON.cyan, NEON.orange), grid: number[] = [];
    b.shape(box(29, 1.5, 29), 0, 0.75, 0, col, { fill: FILL_LIGHT });
    b.shape(box(22, 3, 22), 0, 3, 0, col);
    for (let i = -3; i <= 3; i++) { const t = i * 3; grid.push(t, 4.55, -10, t, 4.55, 10, -10, 4.55, t, 10, 4.55, t); }
    b.lines(grid, col);
  } },
  { name: 'heatsink', hx: 13, hz: 10, weight: 2, build(b, rnd) {
    const col = accent(rnd);
    b.shape(box(24, 2, 18), 0, 1, 0, col);
    for (let i = 0; i < 8; i++) b.shape(box(1, 9, 18), -10.5 + i * 3, 6.5, 0, col, { fill: FILL_LIGHT });
  } },
  { name: 'fan', hx: 11, hz: 11, weight: 1, build(b, rnd) {
    const col = accent(rnd), blades: number[] = [];
    b.shape(cyl(10, 10, 3, 10), 0, 1.5, 0, col, { wire: true });
    for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2, a2 = a + 0.5; blades.push(0, 2.6, 0, Math.cos(a) * 8.5, 2.6, Math.sin(a) * 8.5, Math.cos(a) * 8.5, 2.6, Math.sin(a) * 8.5, Math.cos(a2) * 7, 2.6, Math.sin(a2) * 7, Math.cos(a2) * 7, 2.6, Math.sin(a2) * 7, 0, 2.6, 0); }
    b.lines(blades, col);
  } },
  { name: 'ram', hx: 28, hz: 5, weight: 2, build(b, rnd) {
    const col = accent(rnd);
    b.shape(box(54, 3, 6), 0, 1.5, 0, col);
    b.shape(box(50, 14, 1.2), 0, 10, 0, col, { fill: FILL_LIGHT });
    for (let i = 0; i < 4; i++) b.shape(box(9, 7, 0.6), -17 + i * 11.5, 11, 0.9, col);
  } },
  { name: 'inductor', hx: 7, hz: 7, weight: 3, build(b, rnd) {
    const col = accent(rnd);
    b.shape(box(9, 6, 9), 0, 3, 0, col);
    b.shape(new THREE.TorusGeometry(3.4, 1.1, 5, 8), 0, 7.2, 0, col, { wire: true, rx: Math.PI / 2 });
  } },
  { name: 'connector', hx: 10, hz: 7, weight: 2, build(b, rnd) {
    const col = accent(rnd);
    b.shape(box(18, 7, 11), 0, 3.5, 0, col);
    b.shape(box(13, 3.5, 1), 0, 3.4, 5.6, col, { fill: 0x04090e });
  } },
  { name: 'resistors', hx: 9, hz: 5, weight: 4, build(b, rnd) {
    const col = accent(rnd);
    for (let i = 0; i < 3; i++) b.shape(box(6, 1.6, 2.4), 0, 0.8, -3.6 + i * 3.6, col, { fill: FILL_LIGHT });
    b.lines([-6, 0.1, -3.6, -3, 0.1, -3.6, 3, 0.1, 3.6, 6, 0.1, 3.6], col);
  } },
  { name: 'core', hx: 9, hz: 9, weight: 1, build(b, rnd) {
    const col = pick(rnd, NEON.cyan, NEON.violet, NEON.orange);
    b.shape(cyl(8, 8.5, 1.4, 8), 0, 0.7, 0, col, { fill: FILL_LIGHT });
    b.shape(new THREE.IcosahedronGeometry(6, 0), 0, 11, 0, col, { wire: true });
    b.shape(new THREE.OctahedronGeometry(2.4, 0), 0, 11, 0, col, { wire: true });
  } },
];
