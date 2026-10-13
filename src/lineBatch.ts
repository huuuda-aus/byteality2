import * as THREE from 'three';

const VERT = /* glsl */ `
attribute vec4 iXform; // x, y, angle (rad), scale
attribute vec4 iColor; // rgb, alpha
varying vec4 vColor;
void main() {
  float c = cos(iXform.z), s = sin(iXform.z);
  vec2 p = position.xy * iXform.w;
  p = vec2(c * p.x - s * p.y, s * p.x + c * p.y) + iXform.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 0.0, 1.0);
  vColor = iColor;
}`;
// Variant for tracers: the second vertex of every segment (position.z = 1) fades out.
const VERT_FADE = VERT.replace('vColor = iColor;', 'vColor = vec4(iColor.rgb, iColor.a * (1.0 - position.z));');
const FRAG = /* glsl */ `
varying vec4 vColor;
void main() { gl_FragColor = vColor; }`;

export function additiveMaterial(vertexShader: string, uniforms: Record<string, THREE.IUniform> = {}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader, fragmentShader: FRAG, uniforms,
    transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
  });
}

/** One line-list model drawn many times with a single instanced draw call. */
export class LineModelBatch {
  readonly mesh: THREE.LineSegments;
  count = 0;
  private xf: Float32Array; private cl: Float32Array;
  private xfAttr: THREE.InstancedBufferAttribute; private clAttr: THREE.InstancedBufferAttribute;
  private geo = new THREE.InstancedBufferGeometry();

  constructor(segments: ArrayLike<number>, readonly capacity: number, opts: { tailFade?: boolean } = {}) {
    const nv = segments.length / 2;
    const pos = new Float32Array(nv * 3);
    for (let i = 0; i < nv; i++) { pos[3 * i] = segments[2 * i]; pos[3 * i + 1] = segments[2 * i + 1]; pos[3 * i + 2] = opts.tailFade ? i % 2 : 0; }
    this.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.xf = new Float32Array(capacity * 4); this.cl = new Float32Array(capacity * 4);
    this.xfAttr = new THREE.InstancedBufferAttribute(this.xf, 4); this.clAttr = new THREE.InstancedBufferAttribute(this.cl, 4);
    this.xfAttr.setUsage(THREE.DynamicDrawUsage); this.clAttr.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('iXform', this.xfAttr); this.geo.setAttribute('iColor', this.clAttr);
    this.geo.instanceCount = 0;
    this.mesh = new THREE.LineSegments(this.geo, additiveMaterial(opts.tailFade ? VERT_FADE : VERT));
    this.mesh.frustumCulled = false;
  }

  begin(): void { this.count = 0; }

  push(x: number, y: number, angleRad: number, scale: number, r: number, g: number, b: number, a = 1): void {
    if (this.count >= this.capacity) return;
    const o = this.count++ * 4;
    this.xf[o] = x; this.xf[o + 1] = y; this.xf[o + 2] = angleRad; this.xf[o + 3] = scale;
    this.cl[o] = r; this.cl[o + 1] = g; this.cl[o + 2] = b; this.cl[o + 3] = a;
  }

  end(): void {
    this.geo.instanceCount = this.count;
    if (this.count === 0) return;
    for (const attr of [this.xfAttr, this.clAttr]) {
      attr.clearUpdateRanges(); attr.addUpdateRange(0, this.count * 4); attr.needsUpdate = true;
    }
  }
}

/** Unit-radius dotted circle: `n` short dashes with equal gaps. */
export function dottedCircleSegments(n = 120): number[] {
  const s: number[] = [];
  for (let i = 0; i < n; i += 2) {
    const a = (i / n) * Math.PI * 2, b = ((i + 1) / n) * Math.PI * 2;
    s.push(Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b));
  }
  return s;
}

/** Unit-radius circle outline (n segments) for range/base rings, to use with LineModelBatch. */
export function circleSegments(n = 24): number[] {
  const s: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, b = ((i + 1) / n) * Math.PI * 2;
    s.push(Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b));
  }
  return s;
}
