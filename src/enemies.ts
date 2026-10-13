import type { Graph } from './graph.ts';

const DEG = 180 / Math.PI;
export const CELL = 32; // spatial hash cell size (px)
const GW = Math.ceil(640 / CELL), GH = Math.ceil(480 / CELL);

/** Structure-of-arrays enemy simulation: fixed 60 Hz step, movement ported from enemy.txt. */
export class EnemySim {
  n = 0;
  readonly x: Float32Array; readonly y: Float32Array;
  readonly vx: Float32Array; readonly vy: Float32Array; // px per step (used for aim prediction)
  readonly angle: Float32Array; // degrees, y-down screen space
  private angVel: Float32Array;
  readonly hp: Float32Array; readonly maxHp: Float32Array;
  readonly speed: Float32Array; readonly value: Float32Array;
  readonly pos: Float32Array; readonly edge: Int32Array;
  readonly type: Uint8Array;
  readonly col: Float32Array; // r,g,b in 0..1
  readonly selected: Uint8Array; // clicked by the player: shows HP and is targeted first
  readonly id: Int32Array; // stable id (indices change on swap-remove)
  readonly shockDelay: Int32Array; // steps until pending shockwave damage lands (-1 = none)
  readonly shockDamage: Float32Array;

  leaked = 0;
  onShockHit: (i: number, dealt: number) => void = () => {};
  private nextId = 1;
  // spatial hash, rebuilt once per step after movement
  private cellHead = new Int32Array(GW * GH);
  private cellNext: Int32Array;

  constructor(readonly graph: Graph, readonly cap: number) {
    this.x = new Float32Array(cap); this.y = new Float32Array(cap);
    this.vx = new Float32Array(cap); this.vy = new Float32Array(cap);
    this.angle = new Float32Array(cap); this.angVel = new Float32Array(cap);
    this.hp = new Float32Array(cap); this.maxHp = new Float32Array(cap);
    this.speed = new Float32Array(cap); this.value = new Float32Array(cap);
    this.pos = new Float32Array(cap); this.edge = new Int32Array(cap);
    this.type = new Uint8Array(cap); this.col = new Float32Array(cap * 3);
    this.id = new Int32Array(cap); this.selected = new Uint8Array(cap);
    this.shockDelay = new Int32Array(cap).fill(-1); this.shockDamage = new Float32Array(cap);
    this.cellNext = new Int32Array(cap);
  }

  /** Random outgoing edge at `node`. An enemy never turns back along a two-way road unless that is its only option (dead end). */
  private pickEdge(node: number, from = -1): number {
    const o = this.graph.out[node], back = from >= 0 ? this.graph.rev[from] : -1;
    if (back < 0 || o.length < 2) return o[Math.floor(Math.random() * o.length)];
    let k = Math.floor(Math.random() * (o.length - 1)); // uniform over the other len-1 edges
    if (o[k] === back) k = o.length - 1;
    return o[k];
  }

  /** Starts at a source, or (stress tests) at `startPos` along `startEdge` anywhere in the graph. */
  spawn(type: number, hp: number, speed: number, value: number, rgb: [number, number, number], startPos = 0, startEdge = -1): number {
    if (this.n >= this.cap) return -1;
    const g = this.graph, i = this.n++;
    const e = startEdge >= 0 ? startEdge : this.pickEdge(g.sources[Math.floor(Math.random() * g.sources.length)]);
    this.edge[i] = e; this.pos[i] = startPos;
    this.x[i] = g.nx[g.eb[e]] + (g.nx[g.ee[e]] - g.nx[g.eb[e]]) * startPos;
    this.y[i] = g.ny[g.eb[e]] + (g.ny[g.ee[e]] - g.ny[g.eb[e]]) * startPos;
    this.vx[i] = 0; this.vy[i] = 0;
    this.angle[i] = Math.random() * 360; this.angVel[i] = 0; // original spawns spinning, then settles onto the path direction
    this.hp[i] = hp; this.maxHp[i] = hp; this.speed[i] = speed; this.value[i] = value;
    this.type[i] = type; this.id[i] = this.nextId++; this.selected[i] = 0;
    this.shockDelay[i] = -1; this.shockDamage[i] = 0;
    this.col[3 * i] = rgb[0] / 255; this.col[3 * i + 1] = rgb[1] / 255; this.col[3 * i + 2] = rgb[2] / 255;
    return i;
  }

  /** Swap-remove. Callers iterating must go from the end down. */
  remove(i: number): void {
    const last = --this.n;
    if (i === last) return;
    for (const a of [this.x, this.y, this.vx, this.vy, this.angle, this.angVel, this.hp, this.maxHp, this.speed, this.value, this.pos, this.shockDamage] as Float32Array[]) a[i] = a[last];
    this.edge[i] = this.edge[last]; this.type[i] = this.type[last]; this.id[i] = this.id[last]; this.shockDelay[i] = this.shockDelay[last]; this.selected[i] = this.selected[last];
    for (let k = 0; k < 3; k++) this.col[3 * i + k] = this.col[3 * last + k];
  }

  indexOfId(id: number): number {
    for (let i = 0; i < this.n; i++) if (this.id[i] === id) return i;
    return -1;
  }

  /** Route progress 0..100 (interpolated node order values) for "furthest along" targeting. */
  progress(i: number): number {
    const g = this.graph, e = this.edge[i];
    return (1 - this.pos[i]) * g.nv[g.eb[e]] + this.pos[i] * g.nv[g.ee[e]];
  }

  /**
   * slowdowns: Time towers {x,y,range,damage}; an enemy in range of each is slowed by 100/(100+damage) (they stack).
   * Applies pending shockwave damage. Does not remove dead enemies (hp <= 0): the caller reaps them.
   */
  step(slowers: { x: number; y: number; range: number; damage: number }[] = []): void {
    const g = this.graph;
    for (let i = this.n - 1; i >= 0; i--) {
      let factor = 1;
      for (const s of slowers) if (Math.hypot(this.x[i] - s.x, this.y[i] - s.y) <= s.range) factor *= 100 / (100 + s.damage);
      if (this.shockDelay[i] >= 0 && --this.shockDelay[i] < 0) { this.onShockHit(i, Math.min(this.shockDamage[i], this.hp[i])); this.hp[i] -= this.shockDamage[i]; this.shockDamage[i] = 0; }

      const px = this.x[i], py = this.y[i];
      let e = this.edge[i];
      let p = this.pos[i] + (this.speed[i] * factor) / g.elen[e];
      let leaked = false;
      while (p >= 1) {
        const node = g.ee[e];
        if (g.isSink[node]) { leaked = true; break; }
        p -= 1; e = this.pickEdge(node, e);
      }
      if (leaked) { this.leaked++; this.remove(i); continue; }
      this.edge[i] = e; this.pos[i] = p;
      const bx = g.nx[g.eb[e]], by = g.ny[g.eb[e]];
      const x = bx + (g.nx[g.ee[e]] - bx) * p, y = by + (g.ny[g.ee[e]] - by) * p;
      this.x[i] = x; this.y[i] = y; this.vx[i] = x - px; this.vy[i] = y - py;
      // turn toward travel direction with inertia (enemy.txt "draai plaatje")
      const target = Math.atan2(y - py, x - px) * DEG;
      const diff = ((target - this.angle[i] + 540) % 360) - 180;
      if (Math.abs(diff) < 0.2 && Math.abs(this.angVel[i]) < 0.5) { this.angle[i] = target; this.angVel[i] = 0; }
      else this.angVel[i] += diff > 0 ? 0.1 : -0.1;
      this.angle[i] += this.angVel[i]; this.angVel[i] *= 0.99;
    }
    this.buildGrid();
  }

  private buildGrid(): void {
    this.cellHead.fill(-1);
    for (let i = 0; i < this.n; i++) {
      const c = this.cellOf(this.x[i], this.y[i]);
      this.cellNext[i] = this.cellHead[c]; this.cellHead[c] = i;
    }
  }

  private cellOf(x: number, y: number): number {
    const cx = Math.max(0, Math.min(GW - 1, (x / CELL) | 0)), cy = Math.max(0, Math.min(GH - 1, (y / CELL) | 0));
    return cy * GW + cx;
  }

  /** Indices of enemies whose cell overlaps the box [x0,x1]x[y0,y1] (superset: caller does the exact test). Valid until the next remove(). */
  queryBox(x0: number, y0: number, x1: number, y1: number, out: number[]): number[] {
    out.length = 0;
    const cx0 = Math.max(0, (x0 / CELL) | 0), cx1 = Math.min(GW - 1, (x1 / CELL) | 0);
    const cy0 = Math.max(0, (y0 / CELL) | 0), cy1 = Math.min(GH - 1, (y1 / CELL) | 0);
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      for (let i = this.cellHead[cy * GW + cx]; i >= 0; i = this.cellNext[i]) out.push(i);
    }
    return out;
  }
}
