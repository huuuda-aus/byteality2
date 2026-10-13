import * as THREE from 'three';

// Two hand-made pixel digit fonts, drawn as true bitmaps (nearest-neighbour sampled): font 0 is 5x7, font 1 is a tiny 3x5.
const FONTS: { w: number; h: number; glyphs: Record<string, string[]> }[] = [
  { w: 5, h: 7, glyphs: {
    '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'], '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
    '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'], '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
    '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'], '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
    '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'], '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
    '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'], '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
    '.': ['0', '0', '0', '0', '0', '0', '1'], '-': ['000', '000', '000', '111', '000', '000', '000'],
  } },
  { w: 3, h: 5, glyphs: {
    '0': ['111', '101', '101', '101', '111'], '1': ['010', '110', '010', '010', '111'], '2': ['111', '001', '111', '100', '111'],
    '3': ['111', '001', '111', '001', '111'], '4': ['101', '101', '111', '001', '001'], '5': ['111', '100', '111', '001', '111'],
    '6': ['111', '100', '111', '101', '111'], '7': ['111', '001', '001', '010', '010'], '8': ['111', '101', '111', '101', '111'],
    '9': ['111', '101', '111', '001', '111'], '.': ['0', '0', '0', '0', '1'], '-': ['000', '000', '111', '000', '000'],
  } },
];
const CHARS = '0123456789.-';
const CELL = 8;

function buildAtlas(): THREE.CanvasTexture {
  const cv = document.createElement('canvas'); cv.width = CHARS.length * CELL; cv.height = FONTS.length * CELL;
  const ctx = cv.getContext('2d')!; ctx.fillStyle = '#fff';
  FONTS.forEach((f, fi) => [...CHARS].forEach((ch, ci) => {
    f.glyphs[ch].forEach((row, y) => [...row].forEach((bit, x) => { if (bit === '1') ctx.fillRect(ci * CELL + x, fi * CELL + y, 1, 1); }));
  }));
  const t = new THREE.CanvasTexture(cv);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  return t;
}

const VERT = /* glsl */ `
attribute vec4 iRect; // x, y, width, height (field px)
attribute vec4 iUv;   // u0, v0, u1, v1
attribute vec4 iColor;
varying vec2 vUv; varying vec4 vColor;
void main() {
  vec2 p = iRect.xy + position.xy * iRect.zw;
  vUv = vec2(mix(iUv.x, iUv.z, position.x), mix(iUv.y, iUv.w, position.y));
  vColor = iColor;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 0.0, 1.0);
}`;
const FRAG = /* glsl */ `
uniform sampler2D map; varying vec2 vUv; varying vec4 vColor;
void main() { float a = texture2D(map, vUv).a; if (a < 0.5) discard; gl_FragColor = vec4(vColor.rgb, vColor.a); }`;

/** Instanced bitmap digits: one draw call for any number of glyphs. `px` is the size of one font pixel in field pixels. */
export class PixelText {
  readonly mesh: THREE.Mesh;
  private rect: Float32Array; private uv: Float32Array; private col: Float32Array;
  private attrs: THREE.InstancedBufferAttribute[];
  private geo = new THREE.InstancedBufferGeometry();
  private n = 0;

  constructor(readonly capacity = 40000) {
    this.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]), 3));
    this.geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.rect = new Float32Array(capacity * 4); this.uv = new Float32Array(capacity * 4); this.col = new Float32Array(capacity * 4);
    this.attrs = [this.rect, this.uv, this.col].map((a) => { const at = new THREE.InstancedBufferAttribute(a, 4); at.setUsage(THREE.DynamicDrawUsage); return at; });
    this.geo.setAttribute('iRect', this.attrs[0]); this.geo.setAttribute('iUv', this.attrs[1]); this.geo.setAttribute('iColor', this.attrs[2]);
    this.geo.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: { map: { value: buildAtlas() } },
      transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geo, mat); this.mesh.frustumCulled = false;
  }

  begin(): void { this.n = 0; }

  /** y is the vertical centre of the text. font 0 = 5x7, 1 = 3x5. */
  text(str: string, x: number, y: number, px: number, r: number, g: number, b: number, a = 1, align: 'left' | 'center' | 'right' = 'left', font = 0): void {
    const f = FONTS[font];
    const widthOf = (ch: string) => f.glyphs[ch]?.[0].length ?? 0;
    let total = 0; for (const ch of str) total += widthOf(ch) + 1; total = (total - 1) * px;
    let cx = align === 'left' ? x : align === 'center' ? x - total / 2 : x - total;
    const top = y - (f.h * px) / 2;
    for (const ch of str) {
      const w = widthOf(ch), ci = CHARS.indexOf(ch);
      if (w === 0 || ci < 0 || this.n >= this.capacity) continue;
      const o = this.n++ * 4, W = CHARS.length * CELL, H = FONTS.length * CELL, row0 = font * CELL;
      this.rect[o] = cx; this.rect[o + 1] = top; this.rect[o + 2] = w * px; this.rect[o + 3] = f.h * px;
      // quad y runs down the screen: uv.y is the glyph's top edge (canvas rows count from the top, texture v from the bottom)
      this.uv[o] = (ci * CELL) / W; this.uv[o + 1] = 1 - row0 / H; this.uv[o + 2] = (ci * CELL + w) / W; this.uv[o + 3] = 1 - (row0 + f.h) / H;
      this.col[o] = r; this.col[o + 1] = g; this.col[o + 2] = b; this.col[o + 3] = a;
      cx += (w + 1) * px;
    }
  }

  end(): void {
    this.geo.instanceCount = this.n;
    if (this.n === 0) return;
    for (const at of this.attrs) { at.clearUpdateRanges(); at.addUpdateRange(0, this.n * 4); at.needsUpdate = true; }
  }
}
