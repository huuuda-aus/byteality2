import * as THREE from 'three';

const CHARS = '0123456789.,-+/x ';
const CELL_W = 40, CELL_H = 56;

function buildAtlas(): { tex: THREE.CanvasTexture; adv: Record<string, number> } {
  const cv = document.createElement('canvas'); cv.width = CHARS.length * CELL_W; cv.height = CELL_H;
  const ctx = cv.getContext('2d')!;
  ctx.font = `600 38px Fredoka, "Trebuchet MS", system-ui, sans-serif`; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
  ctx.lineJoin = 'round'; ctx.lineWidth = 8; ctx.strokeStyle = '#10142a'; ctx.fillStyle = '#ffffff';
  const adv: Record<string, number> = {};
  [...CHARS].forEach((ch, i) => {
    const cx = i * CELL_W + CELL_W / 2, cy = CELL_H / 2 + 2;
    ctx.strokeText(ch, cx, cy); ctx.fillText(ch, cx, cy);
    adv[ch] = Math.min(1, (ctx.measureText(ch).width + 6) / CELL_W);
  });
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
  return { tex, adv };
}

const VERT = /* glsl */ `
attribute vec3 iAnchor;  // world position the text hangs on
attribute vec4 iBox;     // screen-plane offset x, y and size w, h (world units)
attribute vec4 iUv;      // u0, v0, u1, v1
attribute vec4 iColor;
varying vec2 vUv; varying vec4 vColor;
void main() {
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 world = iAnchor + right * (iBox.x + position.x * iBox.z) + up * (iBox.y + position.y * iBox.w);
  vUv = vec2(mix(iUv.x, iUv.z, position.x), mix(iUv.y, iUv.w, position.y));
  vColor = iColor;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}`;
const FRAG = /* glsl */ `
uniform sampler2D map; varying vec2 vUv; varying vec4 vColor;
void main() { vec4 t = texture2D(map, vUv); if (t.a < 0.02) discard; gl_FragColor = vec4(t.rgb * vColor.rgb, t.a * vColor.a); }`;

/** Camera-facing numbers (instanced quads) anchored in the 3D world: damage numbers, HP, money. `size` is the text height in world units. */
export class GlyphText {
  readonly mesh: THREE.Mesh;
  private anchor: Float32Array; private box: Float32Array; private uv: Float32Array; private col: Float32Array;
  private attrs: THREE.InstancedBufferAttribute[]; private geo = new THREE.InstancedBufferGeometry();
  private adv: Record<string, number>;
  private n = 0;

  constructor(readonly capacity = 30000) {
    const { tex, adv } = buildAtlas(); this.adv = adv;
    this.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]), 3));
    this.geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.anchor = new Float32Array(capacity * 3); this.box = new Float32Array(capacity * 4); this.uv = new Float32Array(capacity * 4); this.col = new Float32Array(capacity * 4);
    this.attrs = [[this.anchor, 3], [this.box, 4], [this.uv, 4], [this.col, 4]].map(([a, s]) => { const at = new THREE.InstancedBufferAttribute(a as Float32Array, s as number); at.setUsage(THREE.DynamicDrawUsage); return at; });
    ['iAnchor', 'iBox', 'iUv', 'iColor'].forEach((name, i) => this.geo.setAttribute(name, this.attrs[i]));
    this.geo.instanceCount = 0;
    this.mesh = new THREE.Mesh(this.geo, new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: { map: { value: tex } }, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 50;
  }

  begin(): void { this.n = 0; }

  text(str: string, ax: number, ay: number, az: number, size: number, r: number, g: number, b: number, a = 1, align: 'left' | 'center' | 'right' = 'center', dx = 0, dy = 0): void {
    const k = size / CELL_H;
    let total = 0; for (const ch of str) total += (this.adv[ch] ?? 0.6) * CELL_W * k;
    let x = (align === 'left' ? 0 : align === 'center' ? -total / 2 : -total) + dx;
    const W = CHARS.length * CELL_W;
    for (const ch of str) {
      const ci = CHARS.indexOf(ch), step = (this.adv[ch] ?? 0.6) * CELL_W * k;
      if (ci >= 0 && this.n < this.capacity && ch !== ' ') {
        const o = this.n++;
        this.anchor[3 * o] = ax; this.anchor[3 * o + 1] = ay; this.anchor[3 * o + 2] = az;
        this.box[4 * o] = x - (CELL_W * k - step) / 2; this.box[4 * o + 1] = dy - size / 2; this.box[4 * o + 2] = CELL_W * k; this.box[4 * o + 3] = size;
        this.uv[4 * o] = (ci * CELL_W) / W; this.uv[4 * o + 1] = 0; this.uv[4 * o + 2] = ((ci + 1) * CELL_W) / W; this.uv[4 * o + 3] = 1;
        this.col[4 * o] = r; this.col[4 * o + 1] = g; this.col[4 * o + 2] = b; this.col[4 * o + 3] = a;
      }
      x += step;
    }
  }

  end(): void {
    this.geo.instanceCount = this.n;
    if (this.n === 0) return;
    for (const at of this.attrs) { at.clearUpdateRanges(); at.addUpdateRange(0, this.n * at.itemSize); at.needsUpdate = true; }
  }
}
