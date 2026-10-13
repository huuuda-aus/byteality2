import * as THREE from 'three';

// 7-segment glyphs: a=top, b=top-right, c=bottom-right, d=bottom, e=bottom-left, f=top-left, g=middle
const SEG: Record<string, string> = { '0': 'abcdef', '1': 'bc', '2': 'abdeg', '3': 'abcdg', '4': 'bcfg', '5': 'acdfg', '6': 'acdefg', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg', '-': 'g' };
const COORDS: Record<string, [number, number, number, number]> = { // in a 1 x 2 cell, y down
  a: [0, 0, 1, 0], b: [1, 0, 1, 1], c: [1, 1, 1, 2], d: [0, 2, 1, 2], e: [0, 1, 0, 2], f: [0, 0, 0, 1], g: [0, 1, 1, 1],
};

/** A small dynamic line batch (rebuilt every frame): rectangles and 7-segment numbers for HUD-like overlays in the field. */
export class DynamicLines {
  readonly mesh: THREE.LineSegments;
  private pos: Float32Array; private col: Float32Array;
  private n = 0;
  private geo = new THREE.BufferGeometry();

  constructor(readonly maxVerts = 8192) {
    this.pos = new Float32Array(maxVerts * 3); this.col = new Float32Array(maxVerts * 3);
    const pa = new THREE.BufferAttribute(this.pos, 3), ca = new THREE.BufferAttribute(this.col, 3);
    pa.setUsage(THREE.DynamicDrawUsage); ca.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', pa); this.geo.setAttribute('color', ca);
    this.geo.setDrawRange(0, 0);
    this.mesh = new THREE.LineSegments(this.geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false }));
    this.mesh.frustumCulled = false;
  }

  begin(): void { this.n = 0; }

  line(x1: number, y1: number, x2: number, y2: number, r: number, g: number, b: number, a = 1): void {
    if (this.n + 2 > this.maxVerts) return;
    const o = this.n * 3;
    this.pos[o] = x1; this.pos[o + 1] = y1; this.pos[o + 2] = 0; this.pos[o + 3] = x2; this.pos[o + 4] = y2; this.pos[o + 5] = 0;
    for (let k = 0; k < 2; k++) { this.col[o + 3 * k] = r * a; this.col[o + 3 * k + 1] = g * a; this.col[o + 3 * k + 2] = b * a; }
    this.n += 2;
  }

  rect(cx: number, cy: number, half: number, r: number, g: number, b: number, a = 1): void {
    this.line(cx - half, cy - half, cx + half, cy - half, r, g, b, a); this.line(cx + half, cy - half, cx + half, cy + half, r, g, b, a);
    this.line(cx + half, cy + half, cx - half, cy + half, r, g, b, a); this.line(cx - half, cy + half, cx - half, cy - half, r, g, b, a);
  }

  /** Centered 7-segment number text, digit height `h` px. Thousands are separated by dots like the original's string_1000. */
  number(value: number, cx: number, cy: number, h: number, r: number, g: number, b: number, a = 1): void {
    const s = Math.floor(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    const w = h * 0.5, gap = h * 0.28, adv = (ch: string) => (ch === '.' ? gap : w + gap);
    let total = -gap; for (const ch of s) total += adv(ch);
    let x = cx - total / 2; const y = cy - h / 2;
    for (const ch of s) {
      if (ch === '.') { this.line(x, y + h, x + 0.5, y + h, r, g, b, a); x += adv(ch); continue; }
      for (const sg of SEG[ch] ?? '') {
        const [x1, y1, x2, y2] = COORDS[sg];
        this.line(x + (x1 * w), y + (y1 * h) / 2, x + (x2 * w), y + (y2 * h) / 2, r, g, b, a);
      }
      x += adv(ch);
    }
  }

  /** Text in the original's pixel-font metrics (digit advance 9, '1' 4, '.' 3 at height 9), scaled to height `h`. y is the vertical centre. */
  text(str: string, x: number, y: number, h: number, r: number, g: number, b: number, a = 1, align: 'left' | 'center' | 'right' = 'left'): void {
    const k = h / 9, adv = (ch: string) => (ch === '1' ? 4 : ch === '.' ? 3 : 9) * k, w = 6 * k;
    let total = 0; for (const ch of str) total += adv(ch);
    let cx = align === 'left' ? x : align === 'center' ? x - total / 2 : x - total;
    const top = y - h / 2;
    for (const ch of str) {
      if (ch === '.') this.line(cx + k, top + h, cx + 2 * k, top + h, r, g, b, a);
      else if (ch === '1') { this.line(cx + 2 * k, top, cx + 2 * k, top + h, r, g, b, a); this.line(cx + 0.5 * k, top + 1.5 * k, cx + 2 * k, top, r, g, b, a); }
      else for (const sg of SEG[ch] ?? '') {
        const [x1, y1, x2, y2] = COORDS[sg];
        this.line(cx + x1 * w, top + (y1 * h) / 2, cx + x2 * w, top + (y2 * h) / 2, r, g, b, a);
      }
      cx += adv(ch);
    }
  }

  end(): void {
    this.geo.setDrawRange(0, this.n);
    const pa = this.geo.getAttribute('position') as THREE.BufferAttribute, ca = this.geo.getAttribute('color') as THREE.BufferAttribute;
    for (const at of [pa, ca]) { at.clearUpdateRanges(); if (this.n > 0) at.addUpdateRange(0, this.n * 3); at.needsUpdate = true; }
  }
}
