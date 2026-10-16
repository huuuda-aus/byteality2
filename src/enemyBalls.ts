import * as THREE from 'three';
import { ENEMY_RADIUS } from './data.ts';

/** Instanced glossy spheres under the enemies; the line symbols are drawn on top of them. */
export class EnemyBalls {
  readonly mesh: THREE.InstancedMesh;
  private m = new THREE.Matrix4(); private c = new THREE.Color();

  constructor(capacity: number) {
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.1 });
    this.mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(ENEMY_RADIUS, 14, 10), mat, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false; this.mesh.count = 0;
  }

  /** Field (x, y) maps to world (x, ·, y); the sphere rests on the ground. */
  update(n: number, x: Float32Array, y: Float32Array, col: Float32Array): void {
    const k = Math.min(n, this.mesh.instanceMatrix.count);
    for (let i = 0; i < k; i++) {
      this.m.makeTranslation(x[i], ENEMY_RADIUS, y[i]); this.mesh.setMatrixAt(i, this.m);
      this.c.setRGB(col[3 * i] * 0.8, col[3 * i + 1] * 0.8, col[3 * i + 2] * 0.8); this.mesh.setColorAt(i, this.c);
    }
    this.mesh.count = k;
    this.mesh.instanceMatrix.needsUpdate = true; if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

// Instance matrix layout: translation = world anchor; (0,0) / (1,1) = bar width / height; (1,0) / (0,1) = offset along the screen's right / up.
const BAR_VERT = /* glsl */ `
varying vec3 vColor;
void main() {
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float sx = instanceMatrix[0][0], oy = instanceMatrix[0][1], ox = instanceMatrix[1][0], sy = instanceMatrix[1][1];
  vec3 world = instanceMatrix[3].xyz + right * (ox + position.x * sx) + up * (oy + position.y * sy);
  vColor = instanceColor;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}`;
const BAR_FRAG = /* glsl */ `varying vec3 vColor; void main() { gl_FragColor = vec4(vColor, 1.0); }`;

/** Solid, opaque health bars: a black frame with a white fill, as instanced camera-facing quads hanging below the enemy (add to the 3D world group). */
export class HpBars {
  readonly mesh: THREE.InstancedMesh;
  private m = new THREE.Matrix4(); private white = new THREE.Color(1, 1, 1); private black = new THREE.Color(0, 0, 0);

  constructor(capacity: number, readonly w = 12, readonly h = 2.4, readonly dy = -9) {
    const mat = new THREE.ShaderMaterial({ vertexShader: BAR_VERT, fragmentShader: BAR_FRAG, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, capacity * 2);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 6), 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false; this.mesh.count = 0;
  }

  update(n: number, x: Float32Array, y: Float32Array, hp: Float32Array, maxHp: Float32Array): void {
    let k = 0; const cap = this.mesh.instanceMatrix.count, { w, h, dy, m } = this, ay = ENEMY_RADIUS;
    for (let i = 0; i < n && k + 2 <= cap; i++) {
      if (maxHp[i] <= 1) continue;
      const f = Math.max(0, Math.min(1, hp[i] / maxHp[i]));
      m.set(w + 1.6, 0, 0, x[i], dy, h + 1.6, 0, ay, 0, 0, 1, y[i], 0, 0, 0, 1); this.mesh.setMatrixAt(k, m); this.mesh.setColorAt(k++, this.black);
      m.set(w * f, -(w * (1 - f)) / 2, 0, x[i], dy, h, 0, ay, 0, 0, 1, y[i], 0, 0, 0, 1); this.mesh.setMatrixAt(k, m); this.mesh.setColorAt(k++, this.white);
    }
    this.mesh.count = k;
    this.mesh.instanceMatrix.needsUpdate = true; if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
