import * as THREE from 'three';
import { FIELD_H, FIELD_TOP, FIELD_W } from './data.ts';

/** Slab the camera has to fit: the playfield plus a margin of scenery. */
export const SLAB = { x0: -40, x1: FIELD_W + 40, z0: FIELD_TOP - 40, z1: FIELD_H + 40 };
const DEG = Math.PI / 180;
const AZIMUTH = 18 * DEG, PITCH = 50 * DEG;      // the default view
const PITCH_MIN = 25 * DEG, PITCH_MAX = 90 * DEG; // the camera moves inside a cone standing on its tip at the map centre: from straight above down to 25 degrees over the table
const ORBIT_SPEED = 0.006;                         // radians per dragged pixel
const CAM_DIST = 1300, FOV = 35;                   // perspective camera: distance to the map centre, vertical field of view in degrees

/**
 * Perspective 3D view of the playfield. Game coordinates stay 2D: field (x, y) lives on the ground plane at world (x, 0, y).
 * `ground2d` and `air2d` host the old flat line/quad effects (range rings, beams ...) lying on the ground / floating above it.
 */
export class View3D {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(FOV, 1, 50, 6000);
  readonly ground2d = new THREE.Group();
  readonly air2d = new THREE.Group();
  readonly top2d = new THREE.Group(); // flat symbols resting on top of the enemy spheres
  readonly sun = new THREE.DirectionalLight(0xcfe6ff, 2.2);
  private topInset = 0;
  private base = { cx: 0, cy: 0, h: 1, W: 1, Hr: 1 }; // the slab's bounding square in frame coordinates (-1..1 spans the camera's full image)
  private yaw = AZIMUTH; private pitch = PITCH;
  private center = new THREE.Vector3((SLAB.x0 + SLAB.x1) / 2, 0, (SLAB.z0 + SLAB.z1) / 2);
  private zoom = 1; private panX = 0; private panY = 0; // pan in frame coordinates
  private ray = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  constructor(parent: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    parent.append(this.renderer.domElement);
    const cx = this.center.x, cz = this.center.z;
    this.placeCamera();
    // lights: a cool key light from the upper left, bluish fill
    this.scene.add(new THREE.HemisphereLight(0x9fd0ff, 0x0a1420, 1.3));
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

  /** Put the camera on the orbit sphere around the slab centre. Screen-up is the ground direction pointing away from the camera, so the view never rolls (and looking straight down is fine). */
  private placeCamera(): void {
    const { yaw, pitch, center, camera } = this, ch = Math.cos(pitch);
    camera.position.set(center.x + Math.sin(yaw) * ch * CAM_DIST, Math.sin(pitch) * CAM_DIST, center.z + Math.cos(yaw) * ch * CAM_DIST);
    camera.up.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    camera.lookAt(center); camera.updateMatrixWorld(true);
  }

  /** Fit the whole slab into the window below `topInset` px (reserved for the top bar). */
  resize(topInset: number): void {
    this.topInset = topInset;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.fit();
  }

  /** Point in frame coordinates: x and y in -1..1 across the camera's full image (before the zoom/pan window is applied). */
  private frameOf(v: THREE.Vector3): { x: number; y: number } {
    const p = v.clone().applyMatrix4(this.camera.matrixWorldInverse), t = Math.tan((FOV * DEG) / 2);
    return { x: p.x / (-p.z * t * this.camera.aspect), y: p.y / (-p.z * t) };
  }

  /** Frame the slab as seen from the current camera pose: the zoom/pan window is a sub-rectangle of the image (an off-axis projection), so perspective stays true while zooming. */
  private fit(): void {
    const topInset = this.topInset, W = innerWidth, H = innerHeight, Hr = Math.max(100, H - topInset);
    this.camera.aspect = W / Hr; this.camera.clearViewOffset(); this.camera.updateMatrixWorld(true);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const x of [SLAB.x0, SLAB.x1]) for (const z of [SLAB.z0, SLAB.z1]) for (const y of [-16, 30]) {
      const f = this.frameOf(new THREE.Vector3(x, y, z)); minX = Math.min(minX, f.x); maxX = Math.max(maxX, f.x); minY = Math.min(minY, f.y); maxY = Math.max(maxY, f.y);
    }
    this.base = { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, h: Math.max(maxX - minX, maxY - minY) / 2 * 1.03, W, Hr };
    this.applyView();
  }

  private applyView(): void {
    const { cx, cy, h, W, Hr } = this.base, z = this.zoom, cam = this.camera, half = h / z, H = innerHeight;
    const m = h - half; // keep the zoomed window inside the full view
    this.panX = Math.max(-m, Math.min(m, this.panX)); this.panY = Math.max(-m, Math.min(m, this.panY));
    const FW = W / half, FH = Hr / half; // size of the full image in px at this zoom
    cam.setViewOffset(FW, FH, ((cx + this.panX - half + 1) / 2) * FW, ((1 - (cy + this.panY + half)) / 2) * FH - this.topInset, W, H); // the picture lands below the top bar
    cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
  }

  /** Drag the view by a screen-pixel delta. */
  panBy(dxPx: number, dyPx: number): void {
    const { h, W, Hr } = this.base, half = h / this.zoom;
    this.panX -= (dxPx * 2 * half) / W; this.panY += (dyPx * 2 * half) / Hr;
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

  /** Right-drag: spin the board around its centre (horizontal) and tilt the camera between top-down and a low angle (vertical). The point at the middle of the screen stays there. */
  orbitBy(dxPx: number, dyPx: number): void {
    const r = this.canvas.getBoundingClientRect(), mid = this.toField(r.left + r.width / 2, this.topInset + (r.height - this.topInset) / 2);
    this.yaw -= dxPx * ORBIT_SPEED;
    this.pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, this.pitch + dyPx * ORBIT_SPEED));
    this.refit(mid);
  }

  /** Re-frame after a camera move, keeping ground point `keep` at the middle of the screen. */
  private refit(keep: { x: number; y: number }): void {
    this.placeCamera(); this.fit();
    const f = this.frameOf(new THREE.Vector3(keep.x, 0, keep.y));
    this.panX = f.x - this.base.cx; this.panY = f.y - this.base.cy;
    this.applyView();
  }

  resetView(): void { this.zoom = 1; this.panX = 0; this.panY = 0; this.yaw = AZIMUTH; this.pitch = PITCH; this.placeCamera(); this.fit(); }

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
    const r = this.canvas.getBoundingClientRect(), cam = this.camera;
    const dir = new THREE.Vector3(((sx - r.left) / r.width) * 2 - 1, -((sy - r.top) / r.height) * 2 + 1, 0.5).unproject(cam).sub(cam.position).normalize();
    const fwd = new THREE.Vector3(); cam.getWorldDirection(fwd);
    const depth = ref.clone().sub(cam.position).dot(fwd); // distance of the reference along the view direction
    return cam.position.clone().addScaledVector(dir, depth / dir.dot(fwd));
  }

  render(): void { this.renderer.render(this.scene, this.camera); }
}
