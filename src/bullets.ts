import type { EnemySim } from './enemies.ts';
import { LineModelBatch } from './lineBatch.ts';
import { models } from './data.ts';

export const enum Kind { Gun, Rocket, Nail, Shard, Cursor, Mine, Homing, Missile, Wire, Bounce, Fireball, Sonic, Disease, Bomb }
const KIND_COUNT = 14;
const RAD = Math.PI / 180;

/** Collision half-size of the bullet (the original masks: 13x13 bulletmask => 6.5; the gun tracer is 3 px thin). */
const BULLET_HALF = [1.5, 6.5, 6.5, 3.5, 6.5, 6.5, 6.5, 6.5, 6.5, 6.5, 6.5, 6.5, 0, 0];
const ENEMY_HALF = 6.5; // enemymask 13x13
const BOUNDS = 60;
const SQUARE = [-3.5, -3.5, 3.5, -3.5, 3.5, -3.5, 3.5, 3.5, 3.5, 3.5, -3.5, 3.5, -3.5, 3.5, -3.5, -3.5];
const MODEL: (number[] | null)[] = [
  [0, 0, -26, 0], models.bullets.model_rocket, models.bullets.model_nail, SQUARE, models.bullets.model_cursorbullet,
  models.bullets.model_mine, models.bullets.model_homingbullet, models.bullets.model_missile, models.bullets.model_wire,
  models.bullets.model_bouncyball, null, null, models.bullets.model_disease, models.bullets.model_bomb,
];
const SPINNERS = new Set<number>([Kind.Mine, Kind.Wire, Kind.Bounce, Kind.Disease]); // drawn with their own spin angle

export interface HitInfo { x: number; y: number; enemy: number; damage: number; dealt: number; vx: number; vy: number; rgb: [number, number, number]; kind: number }
export interface BombBlast { x: number; y: number; sparks: number; damage: number; color: [number, number, number] }
export interface BulletOpts { scale?: number; life?: number; spin?: number; target?: number; aux?: number; aux2?: number; half?: number; level?: number }

const shortest = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

/** Projectiles: structure-of-arrays. Swept collision against the enemy spatial hash; behaviour per Kind. */
export class BulletSystem {
  n = 0;
  stingerTowers = 0; // disease bullets can only replicate up to 50 per Stinger tower
  private x: Float32Array; private y: Float32Array; private vx: Float32Array; private vy: Float32Array;
  private damage: Float32Array; private scale: Float32Array; private life: Int32Array; private lifeMax: Int32Array;
  private kind: Uint8Array; private col: Float32Array; private ang: Float32Array; private spin: Float32Array;
  private target: Int32Array; private aux: Float32Array; private aux2: Float32Array; private half: Float32Array; private level: Uint8Array;
  private tmp: number[] = [];
  private diseaseCount = 0;
  readonly batches: (LineModelBatch | null)[];
  readonly meshes: LineModelBatch['mesh'][];

  constructor(readonly cap = 20000, private onHit: (h: HitInfo) => void = () => {},
              private onBlast: (b: BombBlast) => void = () => {},
              private onEmber: (x: number, y: number, kind: Kind, dirRad: number) => void = () => {},
              private onDamage: (enemy: number, dealt: number, kind: Kind) => void = () => {}) {
    const f = (c: number) => new Float32Array(c);
    this.x = f(cap); this.y = f(cap); this.vx = f(cap); this.vy = f(cap); this.damage = f(cap); this.scale = f(cap);
    this.ang = f(cap); this.spin = f(cap); this.aux = f(cap); this.aux2 = f(cap); this.half = f(cap); this.col = f(cap * 3);
    this.life = new Int32Array(cap); this.lifeMax = new Int32Array(cap); this.target = new Int32Array(cap);
    this.kind = new Uint8Array(cap); this.level = new Uint8Array(cap);
    this.batches = MODEL.map((m, k) => (m ? new LineModelBatch(m, k === Kind.Gun || k === Kind.Rocket || k === Kind.Nail ? cap : 6000, { tailFade: k === Kind.Gun }) : null));
    this.meshes = this.batches.filter((b): b is LineModelBatch => b !== null).map((b) => b.mesh);
  }

  /** Speed in px/step, direction in radians (y-down). life < 0 = until it leaves the field. */
  spawn(kind: Kind, x: number, y: number, dir: number, speed: number, damage: number, scale: number,
        rgb: [number, number, number], life = -1, o: BulletOpts = {}): void {
    if (this.n >= this.cap) return;
    const i = this.n++;
    this.x[i] = x; this.y[i] = y; this.vx[i] = Math.cos(dir) * speed; this.vy[i] = Math.sin(dir) * speed;
    this.damage[i] = damage; this.scale[i] = scale; this.life[i] = life; this.lifeMax[i] = life; this.kind[i] = kind;
    this.col[3 * i] = rgb[0]; this.col[3 * i + 1] = rgb[1]; this.col[3 * i + 2] = rgb[2];
    this.ang[i] = SPINNERS.has(kind) ? Math.random() * Math.PI * 2 : dir;
    this.spin[i] = o.spin ?? 0; this.target[i] = o.target ?? 0; this.aux[i] = o.aux ?? 0; this.aux2[i] = o.aux2 ?? 0;
    this.half[i] = o.half ?? BULLET_HALF[kind]; this.level[i] = o.level ?? 0;
    if (kind === Kind.Disease) this.diseaseCount++;
  }

  private remove(i: number): void {
    if (this.kind[i] === Kind.Disease) this.diseaseCount--;
    const l = --this.n;
    if (i === l) return;
    for (const a of [this.x, this.y, this.vx, this.vy, this.damage, this.scale, this.ang, this.spin, this.aux, this.aux2, this.half] as Float32Array[]) a[i] = a[l];
    this.life[i] = this.life[l]; this.lifeMax[i] = this.lifeMax[l]; this.kind[i] = this.kind[l]; this.target[i] = this.target[l]; this.level[i] = this.level[l];
    for (let k = 0; k < 3; k++) this.col[3 * i + k] = this.col[3 * l + k];
  }

  clear(): void { this.n = 0; this.diseaseCount = 0; }
  countOf(kind: Kind): number { return kind === Kind.Disease ? this.diseaseCount : 0; }

  /** Moves bullets, applies damage. Never removes enemies (callers reap hp <= 0). */
  step(sim: EnemySim): void {
    for (let i = this.n - 1; i >= 0; i--) {
      const kind = this.kind[i] as Kind;
      if (kind === Kind.Disease) { this.stepDisease(i, sim); continue; }
      if (kind === Kind.Homing) this.steerHoming(i, sim);
      if (SPINNERS.has(kind)) this.ang[i] += this.spin[i];

      const x0 = this.x[i], y0 = this.y[i];
      let x1 = x0 + this.vx[i], y1 = y0 + this.vy[i];
      if (kind === Kind.Bounce) { // bounce inside the original playfield (x 5..635, y 80..400)
        if (x1 < 5) { x1 = 10 - x1; this.vx[i] = -this.vx[i]; } else if (x1 > 635) { x1 = 1270 - x1; this.vx[i] = -this.vx[i]; }
        if (y1 < 80) { y1 = 160 - y1; this.vy[i] = -this.vy[i]; } else if (y1 > 400) { y1 = 800 - y1; this.vy[i] = -this.vy[i]; }
      }
      const reach = ENEMY_HALF + this.half[i];

      if (kind === Kind.Fireball || kind === Kind.Sonic) { // piercing: damages every overlapping enemy every step
        for (const e of sim.queryBox(x1 - reach, y1 - reach, x1 + reach, y1 + reach, this.tmp)) {
          if (sim.hp[e] > 0 && Math.hypot(sim.x[e] - x1, sim.y[e] - y1) <= reach) {
            this.onDamage(e, Math.min(this.damage[i], sim.hp[e]), kind);
            sim.hp[e] -= this.damage[i];
          }
        }
        this.onEmber(x1, y1, kind, Math.atan2(this.vy[i], this.vx[i]));
      } else if (kind !== Kind.Bomb) {
        const dx = x1 - x0, dy = y1 - y0, len2 = dx * dx + dy * dy || 1e-6;
        const cand = sim.queryBox(Math.min(x0, x1) - reach, Math.min(y0, y1) - reach, Math.max(x0, x1) + reach, Math.max(y0, y1) + reach, this.tmp);
        let best = -1, bestT = 2;
        for (const e of cand) {
          if (sim.hp[e] <= 0) continue; // already dying this step
          const t = Math.max(0, Math.min(1, ((sim.x[e] - x0) * dx + (sim.y[e] - y0) * dy) / len2));
          const ex = sim.x[e] - (x0 + dx * t), ey = sim.y[e] - (y0 + dy * t);
          if (ex * ex + ey * ey <= reach * reach && t < bestT) { bestT = t; best = e; }
        }
        if (best >= 0) {
          const dealt = Math.min(this.damage[i], sim.hp[best]);
          sim.hp[best] -= this.damage[i];
          this.onHit({ x: x0 + dx * bestT, y: y0 + dy * bestT, enemy: best, damage: this.damage[i], dealt, vx: this.vx[i], vy: this.vy[i], rgb: [this.col[3 * i], this.col[3 * i + 1], this.col[3 * i + 2]], kind });
          this.remove(i); continue;
        }
      }
      this.x[i] = x1; this.y[i] = y1;
      if (this.life[i] > 0 && --this.life[i] === 0) {
        if (kind === Kind.Bomb) this.onBlast({ x: x1, y: y1, sparks: this.aux[i], damage: this.damage[i], color: [this.col[3 * i], this.col[3 * i + 1], this.col[3 * i + 2]] });
        this.remove(i); continue;
      }
      if (x1 < -BOUNDS || x1 > 640 + BOUNDS || y1 < -BOUNDS || y1 > 480 + BOUNDS) this.remove(i);
    }
  }

  /** homingbullet Step: turn up to homingangle*speed degrees per step toward the target (re-targets the healthiest nearby enemy). */
  private steerHoming(i: number, sim: EnemySim): void {
    if (sim.n === 0) return;
    let e = this.target[i] ? sim.indexOfId(this.target[i]) : -1;
    if (e < 0 || sim.hp[e] <= 0) {
      let best = -1, bh = -Infinity;
      const reach = 150 + 30 * this.level[i];
      for (let k = 0; k < sim.n; k++) {
        if (sim.hp[k] > 0 && sim.hp[k] > bh && Math.hypot(sim.x[k] - this.x[i], sim.y[k] - this.y[i]) <= reach) { bh = sim.hp[k]; best = k; }
      }
      e = best; this.target[i] = best >= 0 ? sim.id[best] : 0;
    }
    if (e < 0) return;
    const speed = Math.hypot(this.vx[i], this.vy[i]), turn = this.aux[i] * speed * RAD;
    const dir = Math.atan2(this.vy[i], this.vx[i]), want = Math.atan2(sim.y[e] - this.y[i], sim.x[e] - this.x[i]);
    const d = shortest(want, dir);
    const nd = Math.abs(d) < turn ? want : dir + Math.sign(d) * turn;
    this.vx[i] = Math.cos(nd) * speed; this.vy[i] = Math.sin(nd) * speed;
    this.ang[i] = nd;
  }

  /** diseasebullet: swarms to its target with friction, bites every 3 steps within 20 px, spreads when the host dies. */
  private stepDisease(i: number, sim: EnemySim): void {
    this.ang[i] += this.spin[i];
    this.scale[i] = 0.97 * this.scale[i] + 0.03 * (1 + 0.25 * this.level[i]);
    let e = this.target[i] ? sim.indexOfId(this.target[i]) : -1;
    if (e >= 0 && sim.hp[e] > 0) {
      const dx = sim.x[e] - this.x[i], dy = sim.y[e] - this.y[i], r = Math.hypot(dx, dy) || 1e-6;
      const s = r / 5; // original: min(10, target.speed) + r/5, and an enemy's built-in speed is 0
      this.vx[i] = (this.vx[i] + (dx / r) * s) * 0.8; this.vy[i] = (this.vy[i] + (dy / r) * s) * 0.8;
      if (r < 20 && this.life[i] % 3 === 0) { // damage tick every 3 steps (alarm 9)
        this.onDamage(e, Math.min(this.damage[i], sim.hp[e]), Kind.Disease);
        sim.hp[e] -= this.damage[i]; this.aux[i] -= 1;
        if (this.aux[i] <= 0) { this.remove(i); return; }
      }
      this.life[i] = (this.life[i] + 1) % 3 + 0; // reuse life as a 0..2 tick counter
    } else {
      // host gone: look for a new one in [20, 120+20*level]; maybe replicate; otherwise die
      const lo = 20, hi = 120 + 20 * this.level[i];
      const pick = () => {
        const c: number[] = [];
        for (let k = 0; k < sim.n; k++) { if (sim.hp[k] > 0) { const d = Math.hypot(sim.x[k] - this.x[i], sim.y[k] - this.y[i]); if (d >= lo && d <= hi) c.push(k); } }
        return c.length ? c[Math.floor(Math.random() * c.length)] : -1;
      };
      const t = pick();
      if (t < 0) { this.remove(i); return; }
      this.target[i] = sim.id[t];
      const a = pick();
      if (a >= 0 && this.diseaseCount < 50 * this.stingerTowers) {
        const d = Math.atan2(sim.y[a] - this.y[i], sim.x[a] - this.x[i]);
        this.spawn(Kind.Disease, this.x[i], this.y[i], d, 3, this.damage[i], 0.2, [this.col[3 * i], this.col[3 * i + 1], this.col[3 * i + 2]], 0,
          { target: sim.id[a], aux: this.aux[i], aux2: this.aux2[i], level: this.level[i], spin: (Math.random() < 0.5 ? 1 : -1) * Math.pow(0.1 + Math.random() * 6561, 0.125) * RAD });
      }
    }
    this.x[i] += this.vx[i]; this.y[i] += this.vy[i];
  }

  render(): void {
    for (const b of this.batches) b?.begin();
    for (let i = 0; i < this.n; i++) {
      const k = this.kind[i] as Kind, b = this.batches[k];
      if (!b) continue;
      let a = 1;
      if (k === Kind.Mine) a = 0.4;
      else if (k === Kind.Bounce) a = Math.sqrt(Math.max(0, this.life[i]) / Math.max(1, this.lifeMax[i]));
      else if (k === Kind.Disease) a = Math.min(1, (3 * this.aux[i]) / Math.max(1, this.aux2[i]));
      const angle = SPINNERS.has(k) ? this.ang[i] : Math.atan2(this.vy[i], this.vx[i]);
      b.push(this.x[i], this.y[i], angle, this.scale[i], this.col[3 * i], this.col[3 * i + 1], this.col[3 * i + 2], a);
    }
    for (const b of this.batches) b?.end();
  }
}
