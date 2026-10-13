import type { Graph } from './graph.ts';
import type { EnemySim } from './enemies.ts';
import { DynamicLines } from './dynLines.ts';
import { LineModelBatch } from './lineBatch.ts';
import { PixelText } from './pixelText.ts';

export const ENEMY_RANGE = 99; // enemies within this distance of a building shoot it (EnemyRange)
const SOURCE: [number, number, number] = [51 / 255, 102 / 255, 1], SINK: [number, number, number] = [1, 0, 0];

export interface Building { x: number; y: number; hp: number; startHp: number }

/** Buildings to protect: hit points, enemy attacks (1 HP per enemy per step), drawing. Port of main_building + enemy "schiet". */
export class Buildings {
  readonly list: Building[];
  /** True once any enemy has shot a building this level (for the "untouchable" achievement). */
  damaged = false;
  private draw = new DynamicLines(4096);
  private shots = new LineModelBatch([0, 0, 1, 0], 4 * 8000);
  private pix = new PixelText(400);
  readonly meshes = [this.draw.mesh, this.shots.mesh, this.pix.mesh];
  private pendingShots: number[] = []; // x, y, bx, by, r, g, b per shot this step

  constructor(g: Graph) { this.list = g.buildings.map((b) => ({ x: b.x, y: b.y, hp: b.hp, startHp: b.hp })); }

  get alive(): boolean { return this.list.length > 0; }

  /** Enemies shoot the nearest building within range. Returns number of shots fired. */
  attack(sim: EnemySim): void {
    this.pendingShots.length = 0;
    if (this.list.length === 0) return;
    for (let i = 0; i < sim.n; i++) {
      let best = -1, bd = ENEMY_RANGE;
      for (let b = 0; b < this.list.length; b++) {
        const d = Math.hypot(this.list[b].x - sim.x[i], this.list[b].y - sim.y[i]);
        if (d < bd) { bd = d; best = b; }
      }
      if (best < 0) continue;
      this.list[best].hp -= 1; this.damaged = true;
      if (this.pendingShots.length < 8000 * 7) this.pendingShots.push(sim.x[i], sim.y[i], this.list[best].x, this.list[best].y, sim.col[3 * i], sim.col[3 * i + 1], sim.col[3 * i + 2]);
    }
    for (let b = this.list.length - 1; b >= 0; b--) if (this.list[b].hp <= 0) this.list.splice(b, 1);
  }

  /** Heal tower: every building within range of (x,y) gains `amount` (no cap; above max it shows blue). */
  heal(x: number, y: number, range: number, amount: number): boolean {
    let any = false;
    for (const b of this.list) if (Math.hypot(b.x - x, b.y - y) <= range) { b.hp += amount; any = true; }
    return any;
  }

  render(): void {
    this.draw.begin(); this.pix.begin();
    for (const b of this.list) {
      const t = b.hp > b.startHp ? 1 : Math.max(0, b.hp / b.startHp);
      const r = SINK[0] + (SOURCE[0] - SINK[0]) * t, g = SINK[1] + (SOURCE[1] - SINK[1]) * t, bl = SINK[2] + (SOURCE[2] - SINK[2]) * t;
      this.draw.rect(b.x, b.y, 26, r, g, bl, 0.8);
      this.pix.text(String(Math.ceil(b.hp)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'), Math.round(b.x), Math.round(b.y), 1, 1, 1, 0.1, 1, 'center', 0); // original: yellow LCD digits
    }
    this.draw.end(); this.pix.end();
    this.shots.begin();
    const p = this.pendingShots;
    for (let k = 0; k < p.length; k += 7) {
      const dx = p[k + 2] - p[k], dy = p[k + 3] - p[k + 1], len = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
      this.shots.push(p[k], p[k + 1], a, len, p[k + 4], p[k + 5], p[k + 6], 1);
      for (let j = 0; j < 3; j++) { // three jittery echoes at alpha 0.4, like enemybullet
        const jx = (Math.random() - Math.random()) * 2, jy = (Math.random() - Math.random()) * 2;
        this.shots.push(p[k] + jx, p[k + 1] + jy, Math.atan2(dy + jy, dx + jx), len, p[k + 4], p[k + 5], p[k + 6], 0.4);
      }
    }
    this.shots.end();
  }
}
