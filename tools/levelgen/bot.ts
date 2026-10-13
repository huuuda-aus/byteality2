import { buildGraph } from '../../src/graph.ts';
import { towerInfo, towerRange, towerFirerate, MAX_LEVEL } from '../../src/data.ts';
import type { PlacedTower } from '../../src/towers.ts';
import type { Game } from './sim.ts';

/** Towers the bot understands: plain damage dealers. (Time/Money/Heal/Wire/Laser need a plan of their own, Mouse needs a cursor.) */
export const BOT_TOWERS = new Set(['tGun', 'tRifle', 'tMinigun', 'tRocket', 'tNail', 'tBallistic', 'tMine', 'tBounce', 'tToxic', 'tMissile', 'tHoming', 'tLightning', 'tShock', 'tBomb', 'tFire', 'tSonic', 'tDischarge', 'tShockwave', 'tDedication', 'tSpread', 'tLight', 'tStinger', 'tFlashlight']);
/** Rough relative worth of one point of "damage per second" by tower type (area and chain effects hit several enemies). */
const WORTH: Record<string, number> = { tToxic: 3, tBomb: 2, tFire: 2, tSonic: 2, tShockwave: 3, tLightning: 2, tShock: 2, tDischarge: 2, tSpread: 2, tNail: 0.6, tMine: 0.8, tBounce: 0.7, tLight: 2, tFlashlight: 2 };
const dps = (key: string, level: number) => {
  const t = towerInfo[key];
  return (t.damage[level] * (t.bullets[level] > 1 && !['tBomb', 'tStinger', 'tToxic', 'tNail'].includes(key) ? t.bullets[level] : 1) * 60) / towerFirerate(t, level) * (WORTH[key] ?? 1);
};

/** A greedy player: buys/upgrades by damage-per-credit weighted by how much of the route a tower covers, and calls the next wave once the field is clear. */
export class Bot {
  private samples: { x: number; y: number; w: number }[] = [];
  private cover: number[] = [];
  private spots: [number, number][] = [];
  private lastAct = -1e9;
  towersPlaced = 0;

  constructor(private game: Game) {
    const g = buildGraph(game.map);
    for (let e = 0; e < g.eb.length; e++) {
      const x1 = g.nx[g.eb[e]], y1 = g.ny[g.eb[e]], x2 = g.nx[g.ee[e]], y2 = g.ny[g.ee[e]], n = Math.max(1, Math.round(g.elen[e] / 10));
      for (let k = 0; k <= n; k++) this.samples.push({ x: x1 + ((x2 - x1) * k) / n, y: y1 + ((y2 - y1) * k) / n, w: 1 + (g.nv[g.ee[e]] || 0) / 100 }); // enemies near the exit matter more
    }
    this.cover = this.samples.map(() => 0);
    for (let y = 85; y <= 395; y += 10) for (let x = 15; x <= 625; x += 10) this.spots.push([x, y]);
  }

  /** Best place for a new tower of this type: the open spot covering the most not-yet-covered route. */
  private bestSpot(key: string): { x: number; y: number; value: number } | null {
    const info = towerInfo[key], R = towerRange(info, 0), r2 = R * R, inner2 = info.innerRange * info.innerRange;
    let best: { x: number; y: number; value: number } | null = null;
    for (const [x, y] of this.spots) {
      if (!this.game.towers.canPlace(x, y, info.baseRadius)) continue;
      let v = 0;
      for (let i = 0; i < this.samples.length; i++) { const s = this.samples[i], d2 = (s.x - x) ** 2 + (s.y - y) ** 2; if (d2 <= r2 && d2 >= inner2) v += s.w / (1 + this.cover[i]); }
      if (!best || v > best.value) best = { x, y, value: v };
    }
    return best;
  }
  private addCover(t: PlacedTower): void {
    const R = towerRange(t.info, t.level);
    this.samples.forEach((s, i) => { if (Math.hypot(s.x - t.x, s.y - t.y) <= R) this.cover[i]++; });
  }
  private coverage(t: PlacedTower): number { // share of the (weighted) route a tower currently reaches, 0..1
    const R = towerRange(t.info, t.level); let c = 0, all = 0;
    for (const s of this.samples) { all += s.w; if (Math.hypot(s.x - t.x, s.y - t.y) <= R) c += s.w; }
    return c / all;
  }

  /** Call every step; acts every 12 steps. */
  update(): void {
    const g = this.game;
    if (g.step - this.lastAct < 12) return;
    this.lastAct = g.step;
    // 1) spend credits on the action with the best value per credit
    for (let guard = 0; guard < 6; guard++) {
      let best: { score: number; run: () => boolean } | null = null;
      for (const key of Object.keys(g.quota)) {
        if (!BOT_TOWERS.has(key) || g.quota[key] <= 0 || g.credits < towerInfo[key].cost[0]) continue;
        const spot = this.bestSpot(key); if (!spot) continue;
        const total = this.samples.reduce((a, s) => a + s.w, 0), score = (dps(key, 0) / towerInfo[key].cost[0]) * (0.2 + spot.value / total);
        if (!best || score > best.score) best = { score, run: () => { const t = g.place(key, spot.x, spot.y); if (t) { this.towersPlaced++; this.addCover(t); } return !!t; } };
      }
      for (const t of g.towers.towers) {
        const cost = g.towers.upgradeCost(t);
        if (cost === null || g.credits < cost || t.level >= MAX_LEVEL) continue;
        const score = ((dps(t.key, t.level + 1) - dps(t.key, t.level)) / cost) * (0.2 + this.coverage(t)) * 0.9; // slight preference for new towers while any are left
        if (!best || score > best.score) best = { score, run: () => g.upgrade(t) };
      }
      if (!best || !best.run()) break;
    }
    // 2) call the next wave when the field is clear and the building is healthy (Space in the real game)
    const hp = g.buildings.reduce((a, b) => a + Math.max(0, b.hp), 0), max = g.buildings.reduce((a, b) => a + b.startHp, 0);
    if (g.towers.towers.length > 0 && g.sim.n === 0 && hp >= 0.6 * max) g.callNextWave();
    else if (!g.started && g.towers.towers.length > 0) g.callNextWave();
  }
}
