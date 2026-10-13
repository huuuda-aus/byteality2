import * as THREE from 'three';
import { additiveMaterial } from './lineBatch.ts';

// Fragments are simulated entirely on the GPU: the CPU only writes spawn parameters once, into a ring buffer.
const VERT = /* glsl */ `
uniform float uTime;
uniform float uDrag;
attribute vec4 aA; // start xy, velocity xy (px/s)
attribute vec4 aB; // angle0, spin (rad/s), half length, birth time
attribute vec4 aC; // rgb, life (s)
varying vec4 vColor;
void main() {
  float t = uTime - aB.w;
  if (t < 0.0 || t > aC.w) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vColor = vec4(0.0); return; }
  float d = (1.0 - exp(-uDrag * t)) / uDrag;       // velocity decays exponentially
  vec2 centre = aA.xy + aA.zw * d;
  float ang = aB.x + aB.y * t;
  float c = cos(ang), s = sin(ang);
  vec2 p = position.xy * (aB.z * 2.0);
  p = vec2(c * p.x - s * p.y, s * p.x + c * p.y) + centre;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 0.0, 1.0);
  float f = 1.0 - t / aC.w;
  vColor = vec4(aC.rgb, f * f);
}`;

export class FragmentSystem {
  readonly mesh: THREE.LineSegments;
  private a: Float32Array; private b: Float32Array; private c: Float32Array;
  private attrs: THREE.InstancedBufferAttribute[];
  private head = 0;
  private high = 0; // highest ring slot ever written + 1: only that many instances are drawn
  private frameCount = 0;
  private uniforms = { uTime: { value: 0 }, uDrag: { value: 3.0 } };
  /** Total spawned since start (alive count is derived by the shader, not tracked). */
  spawned = 0;

  constructor(readonly capacity = 262144) {
    this.a = new Float32Array(capacity * 4); this.b = new Float32Array(capacity * 4); this.c = new Float32Array(capacity * 4);
    for (let i = 0; i < capacity; i++) this.b[4 * i + 3] = -1e6; // born long ago => invisible
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, 0, 0, 0.5, 0, 0]), 3));
    this.attrs = [this.a, this.b, this.c].map((arr) => {
      const at = new THREE.InstancedBufferAttribute(arr, 4); at.setUsage(THREE.DynamicDrawUsage); return at;
    });
    geo.setAttribute('aA', this.attrs[0]); geo.setAttribute('aB', this.attrs[1]); geo.setAttribute('aC', this.attrs[2]);
    geo.instanceCount = 0;
    this.mesh = new THREE.LineSegments(geo, additiveMaterial(VERT, this.uniforms));
    this.mesh.frustumCulled = false;
  }

  get time(): number { return this.uniforms.uTime.value; }
  set time(t: number) { this.uniforms.uTime.value = t; }

  spawn(x: number, y: number, vx: number, vy: number, angle: number, spin: number, halfLen: number,
        r: number, g: number, b: number, life: number): void {
    const i = this.head, o = i * 4;
    this.a[o] = x; this.a[o + 1] = y; this.a[o + 2] = vx; this.a[o + 3] = vy;
    this.b[o] = angle; this.b[o + 1] = spin; this.b[o + 2] = halfLen; this.b[o + 3] = this.time;
    this.c[o] = r; this.c[o + 1] = g; this.c[o + 2] = b; this.c[o + 3] = life;
    this.high = Math.max(this.high, i + 1);
    this.head = (this.head + 1) % this.capacity;
    this.frameCount = Math.min(this.capacity, this.frameCount + 1);
    this.spawned++;
  }

  /** Break a line model into short pieces flying outward, plus a few sparks. */
  explodeModel(seg: ArrayLike<number>, x: number, y: number, angleRad: number, scale: number,
               r: number, g: number, b: number, power = 1, pieces = 2): void {
    const c = Math.cos(angleRad), s = Math.sin(angleRad);
    for (let i = 0; i + 3 < seg.length; i += 4) {
      const ax = (seg[i] * c - seg[i + 1] * s) * scale, ay = (seg[i] * s + seg[i + 1] * c) * scale;
      const bx = (seg[i + 2] * c - seg[i + 3] * s) * scale, by = (seg[i + 2] * s + seg[i + 3] * c) * scale;
      const ang = Math.atan2(by - ay, bx - ax), half = Math.hypot(bx - ax, by - ay) / pieces / 2;
      for (let k = 0; k < pieces; k++) {
        const t = (k + 0.5) / pieces;
        const cx = ax + (bx - ax) * t, cy = ay + (by - ay) * t;
        const d = Math.hypot(cx, cy) || 1;
        const sp = (30 + Math.random() * 110) * power;
        this.spawn(x + cx, y + cy, (cx / d) * sp + (Math.random() - 0.5) * 40, (cy / d) * sp + (Math.random() - 0.5) * 40,
          ang, (Math.random() - 0.5) * 16, half, r, g, b, 0.45 + Math.random() * 0.7);
      }
    }
    for (let k = 0; k < 8; k++) {
      const a = Math.random() * Math.PI * 2, sp = (60 + Math.random() * 200) * power;
      this.spawn(x, y, Math.cos(a) * sp, Math.sin(a) * sp, a, 0, 1 + Math.random() * 2.5, r, g, b, 0.2 + Math.random() * 0.4);
    }
  }

  /** Upload only the ring-buffer region written since the last flush. */
  flush(): void {
    (this.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount = this.high;
    if (this.frameCount === 0) return;
    const end = this.head, start = (end - this.frameCount + this.capacity) % this.capacity;
    const ranges: [number, number][] = this.frameCount >= this.capacity ? [[0, this.capacity]]
      : start < end || this.frameCount === 0 ? [[start, this.frameCount]]
      : [[start, this.capacity - start], [0, end]];
    for (const at of this.attrs) {
      at.clearUpdateRanges();
      for (const [s, n] of ranges) if (n > 0) at.addUpdateRange(s * 4, n * 4);
      at.needsUpdate = true;
    }
    this.frameCount = 0;
  }
}
