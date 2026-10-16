import * as THREE from 'three';

/** Low-poly 3D tower models. Every model is a plinth (`root`) plus a `head` that is aimed/spun around Y; the head's forward direction is +X. */
export interface TowerModel { root: THREE.Group; head: THREE.Group; mats: THREE.MeshLambertMaterial[] }

const matCache = new Map<string, THREE.MeshLambertMaterial>();
function mat(hex: number, glow = false): THREE.MeshLambertMaterial {
  const k = hex + (glow ? 'g' : '');
  let m = matCache.get(k);
  if (!m) { m = new THREE.MeshLambertMaterial({ color: hex, flatShading: true, emissive: glow ? hex : 0x000000, emissiveIntensity: glow ? 0.9 : 0 }); matCache.set(k, m); }
  return m;
}
const shade = (hex: number, f: number) => { const c = new THREE.Color(hex); c.multiplyScalar(f); return c.getHex(); };
const geoCache = new Map<string, THREE.BufferGeometry>();
function geo<T extends THREE.BufferGeometry>(k: string, make: () => T): T {
  let g = geoCache.get(k); if (!g) { g = make(); geoCache.set(k, g); } return g as T;
}

type Add = (g: THREE.BufferGeometry, color: number, x: number, y: number, z: number, o?: { rx?: number; ry?: number; rz?: number; glow?: boolean; sx?: number; sy?: number; sz?: number; to?: THREE.Group }) => THREE.Mesh;

export function buildTowerModel(key: string, colorRGB: [number, number, number], R: number, ghost = false): TowerModel {
  const root = new THREE.Group(), head = new THREE.Group();
  const col = (colorRGB[0] << 16) | (colorRGB[1] << 8) | colorRGB[2];
  const dark = shade(col, 0.45), mid = shade(col, 0.75), light = shade(col, 1.25), steel = 0x8a93a3, steelD = 0x4a5160;
  const used = new Set<THREE.MeshLambertMaterial>();
  const add: Add = (g, color, x, y, z, o = {}) => {
    let m = mat(color, o.glow);
    if (ghost) { m = m.clone(); m.transparent = true; m.opacity = 0.75; m.userData.orig = m.color.clone(); }
    used.add(m);
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(x, y, z); mesh.rotation.set(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0); mesh.scale.set(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1);
    mesh.castShadow = true; mesh.receiveShadow = true;
    (o.to ?? head).add(mesh);
    return mesh;
  };
  const box = (w: number, h: number, d: number) => geo(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d));
  const cyl = (rt: number, rb: number, h: number, s = 8) => geo(`c${rt},${rb},${h},${s}`, () => new THREE.CylinderGeometry(rt, rb, h, s));
  const cone = (r: number, h: number, s = 6) => geo(`k${r},${h},${s}`, () => new THREE.ConeGeometry(r, h, s));
  const ball = (r: number, d = 1) => geo(`i${r},${d}`, () => new THREE.IcosahedronGeometry(r, d));
  const octa = (r: number) => geo(`o${r}`, () => new THREE.OctahedronGeometry(r));
  const torus = (r: number, t: number) => geo(`t${r},${t}`, () => new THREE.TorusGeometry(r, t, 4, 10));
  const Z = Math.PI / 2; // lay a Y-axis shape along +X: rz = -Z
  const barrel = (len: number, r: number, y: number, z = 0, color = steel) => add(cyl(r, r, len, 6), color, len / 2, y, z, { rz: -Z });

  // plinth: hexagonal slab with a coloured ring
  add(cyl(R * 0.98, R * 1.05, 2.2, 6), 0x3a4256, 0, 1.1, 0, { to: root });
  add(cyl(R * 0.82, R * 0.9, 1.2, 6), dark, 0, 2.7, 0, { to: root });
  head.position.y = 3.3;

  switch (key) {
    case 'tGun': add(box(R * 0.9, 2.6, R * 0.9), mid, 0, 1.3, 0); add(box(R * 0.5, 1.4, R * 0.6), col, -R * 0.1, 3.2, 0); barrel(R * 1.2, 0.9, 2.6); break;
    case 'tRifle': add(box(R * 0.8, 2, R * 1.1), mid, 0, 1, 0); barrel(R * 2.0, 0.6, 2.2, R * 0.3); barrel(R * 2.0, 0.6, 2.2, -R * 0.3); add(box(R * 0.5, 1.2, R * 0.9), light, R * 0.1, 2.2, 0); break;
    case 'tBallistic': add(cyl(R * 0.6, R * 0.7, 3, 8), mid, 0, 1.5, 0); add(box(R * 1.0, 3, R * 0.9), col, 0, 4, 0); barrel(R * 1.5, 1.7, 4.2, 0, steelD); add(cyl(2.2, 2.2, 1.2, 6), light, R * 1.4, 4.2, 0, { rz: -Z }); break;
    case 'tBomb': add(cyl(R * 0.7, R * 0.8, 3, 8), mid, 0, 1.5, 0); add(cyl(R * 0.45, R * 0.55, R * 1.2, 7), col, R * 0.25, 5, 0, { rz: -0.9 }); add(ball(R * 0.35), 0x222222, R * 0.75, 7.6, 0, {}); add(box(R * 0.9, 0.8, R * 0.9), steelD, -R * 0.3, 0.4, 0); break;
    case 'tBounce': add(cyl(R * 0.3, R * 0.5, 3, 6), steelD, 0, 1.5, 0); add(torus(R * 0.45, 0.6), light, 0, 3.4, 0, { rx: Z }); add(torus(R * 0.45, 0.6), light, 0, 5, 0, { rx: Z }); add(ball(R * 0.6), col, 0, 7.6, 0); break;
    case 'tCursor': add(cone(R * 0.55, R * 1.6, 5), col, R * 0.4, 1.4, 0, { rz: -Z }); add(ball(R * 0.35), 0xffffff, -R * 0.3, 1.5, 0, { glow: true }); break;
    case 'tDedication': add(cyl(R * 0.4, R * 0.55, 6, 6), mid, 0, 3, 0); add(ball(R * 0.6), col, 0, 7.5, 0, { glow: true }); barrel(R * 1.1, 0.7, 7.5, 0, light); break;
    case 'tDischarge': add(cone(R * 0.55, 6, 6), mid, 0, 3, 0); add(torus(R * 0.5, 0.5), col, 0, 4, 0, { rx: Z, glow: true }); add(torus(R * 0.35, 0.5), col, 0, 6, 0, { rx: Z, glow: true }); add(ball(R * 0.45), 0xcff, 0, 8.5, 0, { glow: true }); break;
    case 'tFire': add(cyl(R * 0.55, R * 0.55, R * 0.9, 7), col, -R * 0.1, 2.2, 0, { rz: -Z, sx: 1, sy: 1 }); barrel(R * 1.3, 1.0, 2.4, 0, steelD); add(cone(R * 0.5, R * 1.1, 5), 0xff7a1a, R * 1.7, 2.4, 0, { rz: -Z, glow: true }); add(ball(R * 0.3), 0xffc040, R * 2.1, 2.4, 0, { glow: true }); break;
    case 'tFlashlight': add(cyl(R * 0.5, R * 0.5, 3, 6), mid, 0, 1.5, 0); add(cyl(R * 0.6, R * 0.8, R * 1.0, 8), col, R * 0.3, 4, 0, { rz: -Z }); add(cyl(R * 0.7, R * 0.7, 0.4, 8), 0xffffcc, R * 0.82, 4, 0, { rz: -Z, glow: true }); break;
    case 'tHeal': add(cyl(R * 0.3, R * 0.4, 3, 6), mid, 0, 1.5, 0); add(box(R * 0.35, R * 1.3, R * 0.35), col, 0, 5.5, 0, { glow: true }); add(box(R * 1.3, R * 0.35, R * 0.35), col, 0, 5.5, 0, { glow: true }); break;
    case 'tHoming': add(octa(R * 0.65), col, 0, 4, 0); for (const a of [0, 2.1, 4.2]) add(box(R * 0.7, 0.4, 1.4), light, -R * 0.4, 4, 0, { ry: a }); barrel(R * 1.0, 0.8, 4, 0, steelD); break;
    case 'tLaser': add(box(R * 0.8, 1.5, R * 1.1), mid, 0, 0.8, 0); add(octa(R * 0.55), col, 0, 4, 0, { sx: 1.6, glow: true }); add(cyl(0.7, 0.7, R * 0.7, 6), 0xffffff, R * 0.95, 4, 0, { rz: -Z, glow: true }); break;
    case 'tLight': add(cyl(R * 0.2, R * 0.2, 7, 5), steelD, 0, 3.5, 0); add(ball(R * 0.8), col, 0, 8, 0, { glow: true }); add(cone(R * 0.5, 2, 6), steelD, 0, 10.3, 0); break;
    case 'tLightning': add(cone(R * 0.55, 8, 4), mid, 0, 4, 0); add(box(R * 1.1, 0.7, 0.7), col, 0, 5.5, 0, { glow: true }); add(box(R * 0.8, 0.7, 0.7), col, 0, 7, 0, { glow: true, ry: Z }); add(octa(R * 0.35), 0xe6d9ff, 0, 9, 0, { glow: true }); break;
    case 'tMine': add(cyl(R * 0.8, R * 0.9, 1.6, 8), col, 0, 0.8, 0); for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; add(cone(1.2, 3, 4), light, Math.cos(a) * R * 0.5, 2.6, Math.sin(a) * R * 0.5); } add(ball(R * 0.3), 0xff3030, 0, 2.2, 0, { glow: true }); break;
    case 'tMinigun': add(cyl(R * 0.6, R * 0.6, R * 0.6, 8), col, 0, 2.2, 0, { rz: -Z }); for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2; add(cyl(0.6, 0.6, R * 1.6, 5), steel, R * 0.8, 2.4 + Math.cos(a) * 1.3, Math.sin(a) * 1.3, { rz: -Z }); } break;
    case 'tMissile': add(box(R * 1.2, 2.2, R * 1.3), mid, 0, 1.1, 0); for (const z of [-R * 0.35, R * 0.35]) { add(cyl(R * 0.28, R * 0.28, R * 1.4, 6), col, R * 0.1, 3.4, z, { rz: -Z }); add(cone(R * 0.28, R * 0.6, 6), 0xdddddd, R * 0.95, 3.4, z, { rz: -Z }); } break;
    case 'tMoney': for (let i = 0; i < 5; i++) add(cyl(R * 0.55, R * 0.55, 0.9, 10), i % 2 ? 0xe8b923 : 0xffd84a, 0, 0.5 + i * 1.0, 0, { ry: i * 0.3 }); add(ball(R * 0.25), 0xffe680, 0, 6.5, 0, { glow: true }); break;
    case 'tNail': add(ball(R * 0.7, 0), col, 0, 4, 0); for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; add(cone(0.9, R * 0.9, 4), light, Math.cos(a) * R * 0.85, 4, Math.sin(a) * R * 0.85, { rz: -Z, ry: -a }); } break;
    case 'tRocket': add(cyl(R * 0.4, R * 0.5, R * 1.6, 7), col, 0, 2.5, 0, { rz: -Z - 0.0 }); add(cone(R * 0.4, R * 0.7, 7), 0xeeeeee, R * 1.15, 2.5, 0, { rz: -Z }); add(box(R * 0.5, 0.4, R * 1.4), light, -R * 0.6, 2.5, 0); add(box(R * 0.5, R * 1.4, 0.4), light, -R * 0.6, 2.5, 0); break;
    case 'tShock': add(ball(R * 0.6), col, 0, 4.2, 0, { glow: true }); for (const a of [0, Z, Math.PI, -Z]) add(cone(R * 0.2, R * 0.7, 4), light, Math.cos(a) * R * 0.8, 4.2, Math.sin(a) * R * 0.8, { rz: -Z, ry: -a }); break;
    case 'tShockwave': add(cyl(R * 0.3, R * 0.3, 5, 6), mid, 0, 2.5, 0); for (let i = 0; i < 3; i++) add(torus(R * (0.8 - i * 0.2), 0.6), col, 0, 2 + i * 1.8, 0, { rx: Z, glow: true }); break;
    case 'tSonic': add(cyl(R * 0.2, R * 0.2, 3, 5), steelD, 0, 1.5, 0); add(cone(R * 0.9, R * 0.9, 10), col, R * 0.2, 4.2, 0, { rz: Z }); add(ball(R * 0.25), 0xffffff, R * 0.4, 4.2, 0, { glow: true }); break;
    case 'tSpread': add(cyl(R * 0.55, R * 0.65, 2.4, 7), mid, 0, 1.2, 0); for (const a of [-0.45, 0, 0.45]) add(cyl(0.9, 0.9, R * 1.2, 5), a === 0 ? col : light, Math.cos(a) * R * 0.6, 2.4, Math.sin(a) * R * 0.6, { rz: -Z, ry: -a }); break;
    case 'tStinger': add(cyl(R * 0.45, R * 0.5, 2, 6), mid, 0, 1, 0); for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2; add(cone(R * 0.22, 6 + (i % 2) * 2, 4), i % 2 ? col : light, Math.cos(a) * R * 0.3, 5, Math.sin(a) * R * 0.3, { rz: Math.cos(a) * 0.3, rx: Math.sin(a) * 0.3 }); } break;
    case 'tTime': add(cone(R * 0.6, 3.6, 6), col, 0, 2.2, 0, { rx: Math.PI }); add(cone(R * 0.6, 3.6, 6), col, 0, 5.8, 0); add(cyl(R * 0.7, R * 0.7, 0.6, 6), steelD, 0, 0.3, 0); add(cyl(R * 0.7, R * 0.7, 0.6, 6), steelD, 0, 7.8, 0); break;
    case 'tToxic': add(cyl(R * 0.6, R * 0.7, 4.6, 8), col, 0, 2.3, 0); add(cyl(R * 0.62, R * 0.62, 0.6, 8), 0x222222, 0, 3.4, 0); add(ball(R * 0.5), 0xb6ff3a, 0, 5.6, 0, { glow: true }); add(box(R * 0.3, 1.4, 0.4), 0x222222, 0, 2.2, R * 0.66); break;
    case 'tWire': add(cyl(R * 0.15, R * 0.15, 8, 5), steelD, 0, 4, 0); for (let i = 0; i < 4; i++) add(torus(R * 0.5, 0.35), col, 0, 2 + i * 1.6, 0, { rx: Z }); add(ball(R * 0.3), 0xffe0a0, 0, 8.4, 0, { glow: true }); break;
    default: add(box(R, 3, R), col, 0, 1.5, 0);
  }
  for (const m of used) if (!ghost) void m;
  root.add(head); root.scale.y = 1.6; // taller than the footprint suggests: reads better from the isometric camera
  return { root, head, mats: [...used] };
}

/** Which models spin continuously instead of aiming (the aim angle is replaced by the idle spin in `draw`). */
export const TINT_RED = new THREE.Color(1, 0.15, 0.15);
