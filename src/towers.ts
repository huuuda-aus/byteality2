import { LineModelBatch, circleSegments, dottedCircleSegments } from './lineBatch.ts';
import { distanceFromNetwork, type Graph } from './graph.ts';
import { FIELD_H, FIELD_TOP, FIELD_W, MAX_LEVEL, PATH_WIDTH, models, towerFirerate, towerInfo, towerRange, type TowerInfo } from './data.ts';
import { shoot, type CombatCtx } from './combat.ts';

export interface PlacedTower {
  info: TowerInfo; key: string; x: number; y: number; level: number;
  lastBullet: number; // steps since last shot
  rich: number; // desired aim direction (degrees, y-down screen space)
  draw: number; // displayed turret direction, chases `rich` at 10 deg/step
  dedicated: number; // Dedication tower: id of its chosen enemy
  steps: number; // steps since placed (the Flashlight only hurts on every 5th)
}
/** Idle spin per step for towers whose model rotates continuously (degrees; the original's ccw is our negative). */
const IDLE_SPIN: Record<string, number> = { tToxic: 1 / 3, tTime: 1 / 5, tHeal: 1, tDischarge: 1 / 3, tShockwave: 1 / 5, tMoney: 1 / 2, tNail: 1 / 3, tBounce: 1 / 2, tHoming: 1 / 2 };

/** Towers for the MVP: placement, selection, upgrading and aiming at the nearest enemy. No shooting yet. */
export class TowerLayer {
  readonly towers: PlacedTower[] = [];
  selected: PlacedTower | null = null;
  readonly batches = new Map<string, LineModelBatch>();
  private rings = new LineModelBatch(circleSegments(24), 256);
  private dots = new LineModelBatch(dottedCircleSegments(120), 24);
  private cursorLines = new LineModelBatch([0, 0, 1, 0], 64, { tailFade: true });
  private ticks = new LineModelBatch([0, 0, 8, 0], 256 * (MAX_LEVEL + 1)); // level markers: level+1 rotating radial ticks
  private stepCount = 0;
  readonly meshes: LineModelBatch['mesh'][] = [this.rings.mesh, this.dots.mesh, this.ticks.mesh, this.cursorLines.mesh];

  constructor(private graph: Graph) {
    for (const key of Object.keys(models.towers)) {
      const b = new LineModelBatch(models.towers[key], 256);
      this.batches.set(key, b); this.meshes.push(b.mesh);
    }
  }

  /**
   * A tower occupies a circle of its base radius. It may touch the path edge or another tower, but not overlap
   * either by even a pixel (the original demanded 20 px from the path and 40 px between towers). Must be fully inside the playfield.
   */
  canPlace(x: number, y: number, radius: number): boolean {
    if (x - radius < 0 || x + radius > FIELD_W || y - radius < FIELD_TOP || y + radius > FIELD_H) return false;
    if (distanceFromNetwork(this.graph, x, y) < radius + PATH_WIDTH / 2) return false;
    return this.towers.every((t) => Math.hypot(t.x - x, t.y - y) >= radius + t.info.baseRadius);
  }

  place(key: string, x: number, y: number): PlacedTower | null {
    if (!this.canPlace(x, y, towerInfo[key].baseRadius) || this.towers.length >= 255) return null;
    const a = Math.random() * 360;
    const t: PlacedTower = { info: towerInfo[key], key, x, y, level: 0, lastBullet: 0, rich: a, draw: a, dedicated: 0, steps: 0 };
    this.towers.push(t);
    return t;
  }

  clear(): void { this.towers.length = 0; this.selected = null; }

  /** Nearest placed tower under the cursor (within its base circle + a small margin). */
  pickAt(x: number, y: number): PlacedTower | null {
    let best: PlacedTower | null = null, bd = Infinity;
    for (const t of this.towers) {
      const d = Math.hypot(t.x - x, t.y - y);
      if (d <= t.info.baseRadius + 6 && d < bd) { bd = d; best = t; }
    }
    return best;
  }

  select(t: PlacedTower | null): void { this.selected = t; }

  /** Price of the next level (original: tower_cost[type, level+1]); null at max level. */
  upgradeCost(t: PlacedTower): number | null { return t.level >= MAX_LEVEL ? null : t.info.cost[t.level + 1]; }

  upgrade(t: PlacedTower): boolean {
    if (t.level >= MAX_LEVEL) return false;
    t.level++;
    return true;
  }

  /** Time towers, as input for enemy slowdown. */
  slowers(): { x: number; y: number; range: number; damage: number }[] {
    return this.towers.filter((t) => t.key === 'tTime').map((t) => ({ x: t.x, y: t.y, range: towerRange(t.info, t.level), damage: t.info.damage[t.level] }));
  }

  /** Money towers in range of a kill at (x,y): each one launches its own number worth its damage value from the tower's position. */
  moneyTowersNear(x: number, y: number): { x: number; y: number; value: number }[] {
    const out: { x: number; y: number; value: number }[] = [];
    for (const t of this.towers) {
      if (t.key === 'tMoney' && Math.hypot(t.x - x, t.y - y) < towerRange(t.info, t.level)) out.push({ x: t.x, y: t.y, value: t.info.damage[t.level] });
    }
    return out;
  }

  /** One simulation step: cooldowns, shooting, turret rotation. */
  step(ctx: CombatCtx): void {
    this.stepCount++;
    ctx.bullets.stingerTowers = this.towers.reduce((n, t) => n + (t.key === 'tStinger' ? 1 : 0), 0);
    for (const t of this.towers) {
      t.steps++;
      if (t.key === 'tCursor') t.rich = (Math.atan2(ctx.pointer.y - t.y, ctx.pointer.x - t.x) * 180) / Math.PI; // the turret always follows the mouse
      t.lastBullet++;
      if (t.lastBullet >= towerFirerate(t.info, t.level) && shoot(t, ctx)) t.lastBullet = 0;
      t.rich -= IDLE_SPIN[t.key] ?? 0;
      const diff = ((t.rich - t.draw + 540) % 360) - 180;
      if (Math.abs(diff) < 10) t.draw = t.rich; else t.draw += diff > 0 ? 10 : -10;
    }
  }

  /**
   * Dotted range circles. level === null (tower being placed): level-0 and max-level range.
   * Otherwise: current range, plus a fainter circle for the next level. Global-range towers (>=600 px) get none.
   */
  private pushRadii(x: number, y: number, info: TowerInfo, level: number | null, r: number, g: number, b: number, a: number): void {
    const circles: [number, number][] = level === null
      ? [[towerRange(info, 0), a], [towerRange(info, MAX_LEVEL), a * 0.5]]
      : [[towerRange(info, level), a], [level < MAX_LEVEL ? towerRange(info, level + 1) : 0, a * 0.45]];
    if (info.innerRange > info.baseRadius) circles.push([info.innerRange, a]);
    for (const [rad, alpha] of circles) if (rad > 0 && rad < 600) this.dots.push(x, y, 0, rad, r, g, b, alpha);
  }

  private pushBase(x: number, y: number, info: TowerInfo, level: number, r: number, g: number, b: number, ringAlpha: number): void {
    this.rings.push(x, y, 0, info.baseRadius, r, g, b, ringAlpha);
    const n = level + 1, rot = (this.stepCount / 4) * (Math.PI / 180), rad = info.baseRadius;
    for (let i = 0; i < n; i++) {
      const a = rot + (i * Math.PI * 2) / n;
      this.ticks.push(x + Math.cos(a) * (rad - 4), y + Math.sin(a) * (rad - 4), a, 1, r, g, b, ringAlpha);
    }
  }

  /** ghost = tower being placed (follows cursor); hover = cursor position used to show radii of a placed tower. */
  render(ghost: { key: string; x: number; y: number; affordable: boolean } | null, hover: { x: number; y: number } | null, pointer: { x: number; y: number } = { x: -1000, y: -1000 }): void {
    this.rings.begin(); this.dots.begin(); this.ticks.begin(); this.cursorLines.begin();
    for (const b of this.batches.values()) b.begin();
    for (const t of this.towers) {
      const [r, g, b] = t.info.color.map((c) => c / 255);
      this.pushBase(t.x, t.y, t.info, t.level, r, g, b, 0.7);
      this.batches.get(t.key)!.push(t.x, t.y, (t.draw * Math.PI) / 180, 1, r, g, b, 1);
      if (t.key === 'tCursor') { // line to the mouse, bright at the cursor end (draw_line_color black->tower colour, alpha 0.3)
        const dx = t.x - pointer.x, dy = t.y - pointer.y;
        this.cursorLines.push(pointer.x, pointer.y, Math.atan2(dy, dx), Math.hypot(dx, dy), r, g, b, 0.3);
      }
    }
    const sel = this.selected;
    if (sel) {
      const [r, g, b] = sel.info.color.map((c) => c / 255);
      this.dots.push(sel.x, sel.y, 0, sel.info.baseRadius + 6, 1, 1, 0.2, 1); // selection ring
      this.pushRadii(sel.x, sel.y, sel.info, sel.level, r, g, b, 0.9);
    }
    if (ghost) {
      const info = towerInfo[ghost.key];
      const [r, g, b] = ghost.affordable && this.canPlace(ghost.x, ghost.y, info.baseRadius) ? info.color.map((c) => c / 255) : [1, 0.15, 0.15];
      this.pushBase(ghost.x, ghost.y, info, 0, r, g, b, 0.8);
      this.batches.get(ghost.key)!.push(ghost.x, ghost.y, 0, 1, r, g, b, 1);
      this.pushRadii(ghost.x, ghost.y, info, null, r, g, b, 0.9);
    } else if (hover) {
      const t = this.pickAt(hover.x, hover.y);
      if (t && t !== sel) this.pushRadii(t.x, t.y, t.info, t.level, t.info.color[0] / 255, t.info.color[1] / 255, t.info.color[2] / 255, 0.6);
    }
    this.rings.end(); this.dots.end(); this.ticks.end(); this.cursorLines.end();
    for (const b of this.batches.values()) b.end();
  }
}
