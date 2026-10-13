import { LineModelBatch } from './lineBatch.ts';
import type { FragmentSystem } from './fragments.ts';

type RGB = [number, number, number];

/** Transient visuals: beams and lightning (as short-lived GPU fragments), hit sparks, expanding rings. */
export class Effects {
  private rings: { x: number; y: number; r: number; max: number; speed: number; rgb: RGB; alpha: number }[] = [];
  private ringBatch: LineModelBatch;
  readonly mesh;

  constructor(private frag: FragmentSystem) {
    const seg: number[] = [];
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2, b = ((i + 1) / 64) * Math.PI * 2;
      seg.push(Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b));
    }
    this.ringBatch = new LineModelBatch(seg, 512);
    this.mesh = this.ringBatch.mesh;
  }

  /** Straight beam: `width` parallel 1 px lines, fading over `life` seconds. */
  beam(x1: number, y1: number, x2: number, y2: number, rgb: RGB, width: number, life: number): void {
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
    const nx = -dy / (len || 1), ny = dx / (len || 1);
    const lines = Math.max(1, Math.round(width));
    for (let k = 0; k < lines; k++) {
      const off = k - (lines - 1) / 2;
      this.frag.spawn((x1 + x2) / 2 + nx * off, (y1 + y2) / 2 + ny * off, 0, 0, a, 0, len / 2, rgb[0], rgb[1], rgb[2], life);
    }
  }

  /** Jagged electric arc from A to B. */
  lightning(x1: number, y1: number, x2: number, y2: number, rgb: RGB, life: number, segs = 7, jitter = 7): void {
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
    let px = x1, py = y1;
    for (let i = 1; i <= segs; i++) {
      const t = i / segs, j = i === segs ? 0 : (Math.random() - 0.5) * 2 * jitter;
      const qx = x1 + dx * t + nx * j, qy = y1 + dy * t + ny * j;
      this.beam(px, py, qx, qy, rgb, 1, life);
      px = qx; py = qy;
    }
  }

  /** Sparks where a bullet lands (original: round(0.1*sqrt(damage)) lines in the enemy colour). */
  hit(x: number, y: number, rgb: RGB, damage: number): void {
    const n = Math.max(1, Math.round(0.1 * Math.sqrt(damage)));
    for (let k = 0; k < Math.min(n, 12); k++) {
      const a = Math.random() * Math.PI * 2, sp = 40 + Math.random() * 120;
      this.frag.spawn(x, y, Math.cos(a) * sp, Math.sin(a) * sp, a, 0, 1 + Math.random() * 2, rgb[0], rgb[1], rgb[2], 0.15 + Math.random() * 0.3);
    }
  }

  /** Flashlight cone (apex at x,y, opening +-half radians over len px): outline and fan lines. */
  cone(x: number, y: number, dir: number, len: number, half: number, rgb: RGB): void {
    const reach = len / Math.cos(half), a1 = dir - half, a2 = dir + half;
    const p = (a: number, l: number): [number, number] => [x + Math.cos(a) * l, y + Math.sin(a) * l];
    const life = 0.03;
    for (const a of [a1, a2]) { const [ex, ey] = p(a, reach); this.beam(x, y, ex, ey, rgb, 1, life); }
    let [px, py] = p(a1, reach);
    for (let k = 1; k <= 8; k++) { const [qx, qy] = p(a1 + ((a2 - a1) * k) / 8, reach); this.beam(px, py, qx, qy, rgb, 1, life); px = qx; py = qy; }
    for (let k = 1; k < 5; k++) { const [ex, ey] = p(a1 + ((a2 - a1) * k) / 5, reach); this.beam(x, y, ex, ey, rgb.map((v) => v * 0.5) as RGB, 1, life); }
  }

  /** Ring expanding by `speed` px per step until `max`. */
  ring(x: number, y: number, max: number, speed: number, rgb: RGB, alpha = 0.8): void {
    if (this.rings.length < 512) this.rings.push({ x, y, r: 1, max, speed, rgb, alpha });
  }

  step(): void {
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]; r.r += r.speed;
      if (r.r >= r.max) this.rings.splice(i, 1);
    }
  }

  render(): void {
    this.ringBatch.begin();
    for (const r of this.rings) this.ringBatch.push(r.x, r.y, 0, r.r, r.rgb[0], r.rgb[1], r.rgb[2], r.alpha * (1 - r.r / r.max));
    this.ringBatch.end();
  }

  clear(): void { this.rings.length = 0; }
}
