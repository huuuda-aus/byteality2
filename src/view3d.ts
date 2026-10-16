import * as THREE from 'three';
import { FIELD_H, FIELD_TOP, FIELD_W } from './data.ts';

/** Slab the camera has to fit: the playfield plus a margin of scenery. */
export const SLAB = { x0: -40, x1: FIELD_W + 40, z0: FIELD_TOP - 40, z1: FIELD_H + 40 };
const AZIMUTH = (18 * Math.PI) / 180, PITCH = (50 * Math.PI) / 180;

/**
 * Orthographic 3D view of the playfield. Game coordinates stay 2D: field (x, y) lives on the ground plane at world (x, 0, y).
 * `ground2d` and `air2d` host the old flat line/quad effects (range rings, beams ...) lying on the ground / floating above it.
 */
export class View3D {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 5000);
  readonly ground2d = new THREE.Group();
  readonly air2d = new THREE.Group();
  readonly top2d = new THREE.Group(); // flat symbols resting on top of the enemy spheres
  readonly sun = new THREE.DirectionalLight(0xffe0b0, 2.6);
  private topInset = 0;
  private base = { cx: 0, cy: 0, hw: 1, hh: 1, W: 1, Hr: 1 };
  private zoom = 1; private panX = 0; private panY = 0; // pan in camera-view units
  private ray = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  constructor(parent: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    parent.append(this.renderer.domElement);
    const cx = (SLAB.x0 + SLAB.x1) / 2, cz = (SLAB.z0 + SLAB.z1) / 2, dist = 1500;
    this.camera.position.set(cx + Math.sin(AZIMUTH) * Math.cos(PITCH) * dist, Math.sin(PITCH) * dist, cz + Math.cos(AZIMUTH) * Math.cos(PITCH) * dist);
    this.camera.lookAt(cx, 0, cz); this.camera.updateMatrixWorld(true);
    // lights: a warm low sun from the upper left, cool fill from the sky
    this.scene.add(new THREE.HemisphereLight(0xaec6ff, 0x2a3a2e, 1.15));
    this.sun.position.set(cx - 420, 560, cz - 260); this.sun.target.position.set(cx, 0, cz);
    this.sun.castShadow = true; this.sun.shadow.mapSize.set(2048, 2048); this.sun.shadow.bias = -0.0008; this.sun.shadow.normalBias = 0.6;
    const sc = this.sun.shadow.camera; sc.left = -520; sc.right = 520; sc.top = 380; sc.bottom = -380; sc.near = 50; sc.far = 1600;
    this.scene.add(this.sun, this.sun.target);
    this.ground2d.rotation.x = Math.PI / 2; this.ground2d.position.y = 0.6;   // (x, y, 0) -> (x, 0.6, y)
    this.air2d.rotation.x = Math.PI / 2; this.air2d.position.y = 7;
    this.top2d.rotation.x = Math.PI / 2; this.top2d.position.y = 12.8;
    this.scene.add(this.ground2d, this.air2d, this.top2d);
  }

  get canvas(): HTMLCanvasElement { return this.renderer.domElement; }

  /** Fit the whole slab into the window below `topInset` px (reserved for the top bar). */
  resize(topInset: number): void {
    this.topInset = topInset;
    const W = innerWidth, H = innerHeight, Hr = Math.max(100, H - topInset);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(W, H);
    const cam = this.camera, inv = cam.matrixWorldInverse;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const x of [SLAB.x0, SLAB.x1]) for (const z of [SLAB.z0, SLAB.z1]) for (const y of [-16, 20]) {
      const v = new THREE.Vector3(x, y, z).applyMatrix4(inv); minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x); minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
    }
    const aspect = W / Hr, cxv = (minX + maxX) / 2, cyv = (minY + maxY) / 2;
    const halfW = Math.max(((maxX - minX) / 2) * 1.03, ((maxY - minY) / 2) * 1.03 * aspect), halfH = halfW / aspect;
    this.base = { cx: cxv, cy: cyv, hw: halfW, hh: halfH, W, Hr };
    cam.setViewOffset(W, Hr, 0, -topInset, W, H); // the picture lands below the top bar
    this.applyView();
  }

  private applyView(): void {
    const { cx, cy, hw, hh } = this.base, z = this.zoom, cam = this.camera;
    const mx = hw * (1 - 1 / z), my = hh * (1 - 1 / z); // keep the zoomed window inside the full view
    this.panX = Math.max(-mx, Math.min(mx, this.panX)); this.panY = Math.max(-my, Math.min(my, this.panY));
    cam.left = cx + this.panX - hw / z; cam.right = cx + this.panX + hw / z; cam.top = cy + this.panY + hh / z; cam.bottom = cy + this.panY - hh / z;
    cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
  }

  /** Drag the view by a screen-pixel delta. */
  panBy(dxPx: number, dyPx: number): void {
    const { hw, hh, W, Hr } = this.base;
    this.panX -= (dxPx * 2 * hw) / this.zoom / W; this.panY += (dyPx * 2 * hh) / this.zoom / Hr;
    this.applyView();
  }

  /** Zoom by `factor` (1 = no change) keeping the ground point under the cursor fixed. */
  zoomAt(factor: number, clientX: number, clientY: number): void {
    const f = this.toField(clientX, clientY), z = Math.max(1, Math.min(4, this.zoom * factor));
    if (z === this.zoom) return;
    this.zoom = z; this.applyView();
    const p = this.toScreen(f.x, 0, f.y); this.panBy(clientX - p.x, clientY - p.y);
    if (z === 1) { this.panX = 0; this.panY = 0; this.applyView(); }
  }

  resetView(): void { this.zoom = 1; this.panX = 0; this.panY = 0; this.applyView(); }

  /** Mouse (client px) -> field coordinates on the ground plane. */
  toField(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), this.camera);
    const p = new THREE.Vector3();
    return this.ray.ray.intersectPlane(this.plane, p) ? { x: p.x, y: p.z } : { x: -1000, y: -1000 };
  }

  /** World point -> client px. */
  toScreen(x: number, y: number, z: number): { x: number; y: number } {
    const v = new THREE.Vector3(x, y, z).project(this.camera), r = this.canvas.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }

  /** The world point that appears at client px (sx, sy) on the camera-parallel plane through `ref` (used to send flying numbers to a HUD element). */
  unprojectAtDepthOf(ref: THREE.Vector3, sx: number, sy: number): THREE.Vector3 {
    const r = this.canvas.getBoundingClientRect(), ndc = new THREE.Vector3(((sx - r.left) / r.width) * 2 - 1, -((sy - r.top) / r.height) * 2 + 1, 0);
    const a = ndc.clone().unproject(this.camera), fwd = new THREE.Vector3(); this.camera.getWorldDirection(fwd);
    const depth = ref.clone().sub(a).dot(fwd); // distance along the view direction from the unprojected near point to the reference
    return a.add(fwd.multiplyScalar(depth));
  }

  render(): void { this.renderer.render(this.scene, this.camera); }
}
