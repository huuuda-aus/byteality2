import type { EnemySim } from './enemies.ts';
import type { BulletSystem } from './bullets.ts';
import { Kind } from './bullets.ts';
import type { Effects } from './effects.ts';
import type { PlacedTower } from './towers.ts';
import type { Buildings } from './buildings.ts';
import type { FloatingNumbers } from './numbers.ts';
import { towerInfo, towerRange } from './data.ts';
import { sfx } from './audio.ts';

export type Priority = 'nearest' | 'furthest' | 'healthiest' | 'unhealthiest' | 'random';
export interface CombatCtx {
  sim: EnemySim; bullets: BulletSystem; fx: Effects;
  towers: PlacedTower[]; buildings: Buildings; pointer: { x: number; y: number };
  numbers: FloatingNumbers;
}

/** Apply damage and show the damage actually dealt as a floating number (onlyWithAll: the original only shows it with "all damage particles"). */
function hurt(c: CombatCtx, i: number, dmg: number, rgb: RGB, onlyWithAll = true): void {
  c.numbers.add(c.sim.x[i], c.sim.y[i], Math.min(dmg, c.sim.hp[i]), 0, 0, rgb, onlyWithAll);
  c.sim.hp[i] -= dmg;
}

const RAD = Math.PI / 180;
type RGB = [number, number, number];
const rgbOf = (t: PlacedTower): RGB => [t.info.color[0] / 255, t.info.color[1] / 255, t.info.color[2] / 255];

/** enemy_inrange_optimal: best enemy with innerrange <= distance <= range by priority; -1 if none. */
export function pickTarget(sim: EnemySim, x: number, y: number, inner: number, range: number, prio: Priority): number {
  let best = -1, bestScore = -Infinity;
  for (let i = 0; i < sim.n; i++) {
    if (sim.hp[i] <= 0) continue;
    const d = Math.hypot(sim.x[i] - x, sim.y[i] - y);
    if (d < inner || d > range) continue;
    const sel = sim.selected[i] === 1 ? 1 : 0; // enemies the player clicked are targeted first
    const score = prio === 'nearest' ? -d + 1000 * sel : prio === 'furthest' ? sim.progress(i) + 100 * sel : prio === 'healthiest' ? sim.hp[i] + 16777216 * sel
      : prio === 'unhealthiest' ? -sim.hp[i] + 16777216 * sel : Math.random() + sel;
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return best;
}

/** aim(): direction (radians) that leads the enemy, refining the intercept `precision` times. */
export function aimDir(sim: EnemySim, x: number, y: number, e: number, speed: number, precision: number): number {
  const vx = sim.vx[e], vy = sim.vy[e];
  let tx = sim.x[e], ty = sim.y[e];
  let steps = Math.hypot(tx - x, ty - y) / speed;
  const ex = sim.x[e], ey = sim.y[e];
  for (let i = 1; i <= precision; i++) {
    tx = ex + steps * vx; ty = ey + steps * vy;
    steps = Math.hypot(tx - x, ty - y) / speed;
  }
  return Math.atan2(ty - y, tx - x);
}

/** Random subset (<= count) of enemies within `dist` of (x,y), excluding `skip`. */
function randomEnemiesNear(sim: EnemySim, x: number, y: number, dist: number, count: number, skip: number): number[] {
  const c: number[] = [];
  for (let i = 0; i < sim.n; i++) {
    if (i !== skip && sim.hp[i] > 0 && Math.hypot(sim.x[i] - x, sim.y[i] - y) <= dist) c.push(i);
  }
  for (let i = 0; i < Math.min(count, c.length); i++) {
    const j = i + Math.floor(Math.random() * (c.length - i));
    [c[i], c[j]] = [c[j], c[i]];
  }
  return c.slice(0, count);
}

/** Damage every enemy within (halfWidth + enemy radius) of the segment once. Used by the hit-scan towers (Light, Shock, Lightning, Laser). */
function hitLine(c: CombatCtx, rgb: RGB, onlyWithAll: boolean, x1: number, y1: number, x2: number, y2: number, halfWidth: number, dmg: number): void {
  const sim = c.sim;
  const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy || 1e-6, reach = halfWidth + 6.5;
  for (let i = 0; i < sim.n; i++) {
    if (sim.hp[i] <= 0) continue;
    const t = Math.max(0, Math.min(1, ((sim.x[i] - x1) * dx + (sim.y[i] - y1) * dy) / l2));
    const ex = sim.x[i] - (x1 + dx * t), ey = sim.y[i] - (y1 + dy * t);
    if (ex * ex + ey * ey <= reach * reach) hurt(c, i, dmg, rgb, onlyWithAll);
  }
}

/** angle_most_enemies: direction (3 degree buckets) with the most enemies nearby, weighting each enemy by 1/distance. */
function angleMostEnemies(sim: EnemySim, x: number, y: number): number {
  const w = new Float32Array(120);
  for (let i = 0; i < sim.n; i++) {
    const d = Math.hypot(sim.x[i] - x, sim.y[i] - y) || 1e-3;
    const b = Math.round(((Math.atan2(sim.y[i] - y, sim.x[i] - x) / RAD + 360) % 360) / 3) % 120;
    w[b] += 1 / d;
  }
  let best = 0; for (let b = 1; b < 120; b++) if (w[b] > w[best]) best = b;
  return best * 3 * RAD;
}

/** angle_average_tower: direction pointing "on average" at the other towers of the same type (distance 20..max range). */
function angleAverageTower(towers: PlacedTower[], x: number, y: number, key: string): number {
  let vx = 0, vy = 0;
  for (const o of towers) {
    if (o.key !== key) continue;
    const d = Math.hypot(o.x - x, o.y - y);
    if (d > 20 && d <= towerInfo[key].range[1]) { vx += (o.x - x) / d; vy += (o.y - y) / d; }
  }
  return Math.atan2(vy, vx);
}

/** maak_bliksem: a random branching lightning bolt; every segment is a hit-scan line plus a bright band. */
function lightning(c: CombatCtx, energy: number, x: number, y: number, len: number, dir: number, dmg: number, rgb: RGB): void {
  const x2 = x + Math.cos(dir) * len, y2 = y + Math.sin(dir) * len;
  hitLine(c, rgb, false, x, y, x2, y2, 1.5, dmg);
  c.fx.beam(x, y, x2, y2, rgb.map((v) => v * 0.57) as RGB, 9, 0.3);
  const e1 = Math.floor(Math.random() * energy), e2 = Math.round(energy - e1 - 1);
  const l1 = 30 + Math.random() * 50 + (5 + Math.random() * 10) * e1, l2 = 30 + Math.random() * 50 + (5 + Math.random() * 10) * e2;
  const r1 = dir + (5 + Math.random() * (20 + 120 / (e1 + 1))) * RAD, r2 = dir - (5 + Math.random() * (20 + 120 / (e2 + 1))) * RAD;
  if (e1 > 0) lightning(c, e1, x2, y2, l1, r1, dmg, rgb);
  if (e2 > 0) lightning(c, e2, x2, y2, l2, r2, dmg, rgb);
}

/** bomb_find_location: the 10 px cell with the most enemies nearby (14 concentric disks), enemies extrapolated to bomb arrival. */
function bombTarget(sim: EnemySim, x: number, y: number, speed: number): { x: number; y: number } {
  const GW = 64, GH = 33, cnt = new Float32Array(GW * GH);
  for (let i = 0; i < sim.n; i++) {
    if (sim.hp[i] <= 0) continue;
    const dist = Math.hypot(sim.x[i] - x, sim.y[i] - y), k = dist / speed;
    const cx = Math.floor((sim.x[i] + sim.vx[i] * k) / 10), cy = Math.floor((sim.y[i] + sim.vy[i] * k - 75) / 10);
    if (cx >= 0 && cx < GW && cy >= 0 && cy < GH) cnt[cy * GW + cx] += 1;
  }
  const disks: [number, number][] = [[1.7, 1], [3.6, 1], [4.8, 1.001], [5.6, 1], [6.5, 1], [7.4, 1.001], [8.3, 1], [9.3, 1], [10.3, 1], [11.3, 1.001], [12.5, 1], [13.9, 1], [15.9, 1], [21, 1.0004]];
  const R = 21, kernel = new Float32Array((2 * R + 1) ** 2);
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const d2 = dx * dx + dy * dy; let v = 0;
    for (const [r, w] of disks) if (d2 <= r * r) v += w;
    kernel[(dy + R) * (2 * R + 1) + dx + R] = v;
  }
  const score = new Float32Array(GW * GH);
  for (let cy = 0; cy < GH; cy++) for (let cx = 0; cx < GW; cx++) {
    const c = cnt[cy * GW + cx]; if (c === 0) continue;
    for (let dy = -R; dy <= R; dy++) { const yy = cy + dy; if (yy < 0 || yy >= GH) continue;
      for (let dx = -R; dx <= R; dx++) { const xx = cx + dx; if (xx < 0 || xx >= GW) continue; score[yy * GW + xx] += c * kernel[(dy + R) * (2 * R + 1) + dx + R]; } }
  }
  let best = 0; for (let i = 1; i < score.length; i++) if (score[i] > score[best]) best = i;
  return { x: (best % GW) * 10 + 5, y: Math.floor(best / GW) * 10 + 80 };
}

/** One shot of tower t. Returns true if it fired (the cooldown only restarts when something was shot at). */
export function shoot(t: PlacedTower, c: CombatCtx): boolean {
  const { sim, bullets, fx } = c, info = t.info, lv = t.level;
  const range = towerRange(info, lv), inner = info.innerRange, dmg = info.damage[lv], count = info.bullets[lv];
  const rgb = rgbOf(t);
  const hasEnemy = sim.n > 0;

  switch (t.key) {
    case 'tGun':
    case 'tMinigun': {
      const e = pickTarget(sim, t.x, t.y, inner, range, 'nearest'); if (e < 0) return false;
      const d = aimDir(sim, t.x, t.y, e, 9, 2);
      bullets.spawn(Kind.Gun, t.x, t.y, d, 9, dmg, 1, rgb); t.rich = d / RAD; return true;
    }
    case 'tRifle': {
      const e = pickTarget(sim, t.x, t.y, inner, range, 'nearest'); if (e < 0) return false;
      const d = aimDir(sim, t.x, t.y, e, 9, 4), ox = Math.cos(d + Math.PI / 2) * 5, oy = Math.sin(d + Math.PI / 2) * 5;
      bullets.spawn(Kind.Gun, t.x + ox, t.y + oy, d, 9, dmg, 1, rgb);
      bullets.spawn(Kind.Gun, t.x - ox, t.y - oy, d, 9, dmg, 1, rgb); t.rich = d / RAD; return true;
    }
    case 'tRocket': {
      const e = pickTarget(sim, t.x, t.y, inner, range, 'healthiest'); if (e < 0) return false;
      const d = aimDir(sim, t.x, t.y, e, 3, 4);
      bullets.spawn(Kind.Rocket, t.x, t.y, d, 3, dmg, 0.6 + 0.15 * lv, rgb); t.rich = d / RAD; return true;
    }
    case 'tNail': {
      if (!hasEnemy) return false;
      for (let i = 1; i <= count; i++) {
        const a = (t.rich + (i * 360) / count) * RAD;
        bullets.spawn(Kind.Nail, t.x + Math.cos(a) * 15, t.y + Math.sin(a) * 15, a, 2 * Math.pow(1.3, lv), dmg, 0.6 + 0.15 * lv, rgb);
      }
      return true;
    }
    case 'tToxic': {
      let any = false;
      for (let i = 0; i < sim.n; i++) {
        if (sim.hp[i] > 0 && Math.hypot(sim.x[i] - t.x, sim.y[i] - t.y) < range) { hurt(c, i, dmg, rgb); any = true; }
      }
      if (any) fx.ring(t.x, t.y, range, range / 6, rgb, 0.18);
      return true; // original resets the cooldown regardless
    }
    case 'tDedication': {
      if (!hasEnemy) return false;
      let e = t.dedicated ? sim.indexOfId(t.dedicated) : -1;
      if (e < 0 || sim.hp[e] <= 0) { e = Math.floor(Math.random() * sim.n); t.dedicated = sim.id[e]; }
      fx.beam(t.x, t.y, sim.x[e], sim.y[e], rgb.map((v) => v * (0.12 + 0.03 * lv)) as RGB, 0.5 + 0.6 * lv, 0.04);
      hurt(c, e, dmg, rgb); t.rich = Math.atan2(sim.y[e] - t.y, sim.x[e] - t.x) / RAD; return true;
    }
    case 'tSpread': {
      const e = pickTarget(sim, t.x, t.y, inner, range, 'random'); if (e < 0) return false;
      const col = rgb.map((v) => v * 0.8) as RGB;
      fx.beam(t.x, t.y, sim.x[e], sim.y[e], col, 3, 0.16);
      hurt(c, e, dmg, rgb); t.rich = Math.atan2(sim.y[e] - t.y, sim.x[e] - t.x) / RAD;
      const ax = sim.x[e], ay = sim.y[e], dist = 40 + (lv * lv) / 2;
      for (const o of randomEnemiesNear(sim, ax, ay, dist, count, e)) {
        fx.beam(ax, ay, sim.x[o], sim.y[o], col, 3, 0.16);
        hurt(c, o, 1 + Math.floor(Math.random() * (dmg / 2)), rgb);
      }
      return true;
    }
    case 'tDischarge': {
      if (!hasEnemy) return false;
      for (const o of randomEnemiesNear(sim, t.x, t.y, range, count, -1)) {
        hurt(c, o, dmg, rgb); fx.lightning(t.x, t.y, sim.x[o], sim.y[o], rgb, 0.33);
      }
      return true;
    }
    case 'tShockwave': {
      if (!hasEnemy) return false;
      fx.ring(t.x, t.y, range, 4, rgb, 0.9);
      for (let i = 0; i < sim.n; i++) {
        const d = Math.hypot(sim.x[i] - t.x, sim.y[i] - t.y);
        if (d <= range) { sim.shockDelay[i] = Math.round(d / 4); sim.shockDamage[i] += dmg; }
      }
      return true;
    }
    case 'tCursor': {
      if (!hasEnemy) return false;
      const d = Math.atan2(c.pointer.y - t.y, c.pointer.x - t.x);
      bullets.spawn(Kind.Cursor, t.x, t.y, d, 2 * Math.pow(1.3, lv), dmg, 0.6 + 0.15 * lv, rgb); t.rich = d / RAD; return true;
    }
    case 'tMine': {
      const h = Math.random() * Math.PI * 2, sc = 0.6 + 0.15 * lv;
      bullets.spawn(Kind.Mine, t.x + Math.cos(h) * 15, t.y + Math.sin(h) * 15, h, 0.1 - 0.007 * lv, dmg, sc, rgb, -1,
        { half: 6.5 * 2.5 * sc, spin: (Math.random() < 0.5 ? 1 : -1) * Math.pow(0.1 + Math.random() * 0.125, 0.125) * ((15 - lv) / 15) * RAD });
      t.rich = h / RAD; return true;
    }
    case 'tLightning': {
      if (!hasEnemy) return false;
      const h = angleMostEnemies(sim, t.x, t.y);
      lightning(c, 6 + 2 * lv, t.x, t.y, 50 + Math.random() * 80, h, dmg, rgb); t.rich = h / RAD; return true;
    }
    case 'tHoming': {
      let fired = false;
      for (let i = 1; i <= lv + 1; i++) {
        const e = pickTarget(sim, t.x, t.y, inner, range, 'random'); if (e < 0) continue;
        const h = (t.rich + 2 * (lv / 2 + 1 - i)) * RAD;
        bullets.spawn(Kind.Homing, t.x + Math.cos(h) * 15, t.y + Math.sin(h) * 15, h, 3 * Math.pow(1.15, lv), dmg, 0.6 + 0.15 * lv, rgb, -1,
          { target: sim.id[e], aux: 0.4 + 0.05 * lv, level: lv });
        fired = true;
      }
      return fired;
    }
    case 'tBallistic': {
      const e = pickTarget(sim, t.x, t.y, inner, range, 'furthest'); if (e < 0) return false;
      const d = aimDir(sim, t.x, t.y, e, 6, 5);
      bullets.spawn(Kind.Shard, t.x, t.y, d, 6, dmg, 1, rgb); t.rich = d / RAD; return true;
    }
    case 'tWire': {
      const x1 = t.x + Math.cos(t.draw * RAD) * 15, y1 = t.y + Math.sin(t.draw * RAD) * 15;
      for (const w of c.towers) {
        if (w === t || w.key !== 'tWire') continue;
        const d = Math.hypot(t.x - w.x, t.y - w.y);
        if (d < range) {
          bullets.spawn(Kind.Wire, x1, y1, Math.atan2(w.y - y1, w.x - x1), 1, dmg, 0.6 + 0.15 * lv, rgb, Math.max(1, Math.round(d)),
            { spin: (Math.random() < 0.5 ? 1 : -1) * Math.pow(0.1 + Math.random() * 6561, 0.125) * RAD });
        }
      }
      t.rich = angleAverageTower(c.towers, t.x, t.y, 'tWire') / RAD; return true;
    }
    case 'tMissile': {
      const e = pickTarget(sim, t.x, t.y, inner, range, 'healthiest'); if (e < 0) return false;
      t.rich = (Math.atan2(sim.y[e] - t.y, sim.x[e] - t.x)) / RAD;
      for (let k = 1; k <= lv + 1; k++) {
        const d = aimDir(sim, t.x, t.y, e, 4 * Math.pow(1.1, lv), 5) + (lv / 2 + 1 - k) * 3 * Math.sqrt(lv) * RAD;
        bullets.spawn(Kind.Missile, t.x, t.y, d, 4 * Math.pow(1.1, lv), dmg, 0.8 + 0.2 * lv, rgb);
      }
      return true;
    }
    case 'tLight': {
      const e = pickTarget(sim, t.x, t.y, inner, range, 'unhealthiest'); if (e < 0) return false;
      const d = Math.atan2(sim.y[e] - t.y, sim.x[e] - t.x), r = d + Math.PI / 2;
      const k = lv === 9 ? 1.5001 : lv >= 7 ? 1 : lv >= 4 ? 0.5001 : 0;
      for (let i = -k; i <= k; i += 1) {
        const ox = t.x + Math.cos(r) * 5 * i, oy = t.y + Math.sin(r) * 5 * i, ex = ox + Math.cos(d) * 800, ey = oy + Math.sin(d) * 800;
        hitLine(c, rgb, true, ox, oy, ex, ey, 1.5, dmg);
        fx.beam(ox, oy, ex, ey, rgb, 1, 0.06);
      }
      t.rich = d / RAD; return true;
    }
    case 'tShock': {
      const e = pickTarget(sim, t.x, t.y, inner, range, 'furthest'); if (e < 0) return false;
      const d = Math.atan2(sim.y[e] - t.y, sim.x[e] - t.x);
      hitLine(c, rgb, false, t.x, t.y, t.x + Math.cos(d) * 40000, t.y + Math.sin(d) * 40000, 1.5, dmg);
      fx.beam(t.x, t.y, t.x + Math.cos(d) * 800, t.y + Math.sin(d) * 800, rgb, 9, 0.3);
      t.rich = d / RAD; return true;
    }
    case 'tBomb': {
      if (!hasEnemy) return false;
      const speed = 6 * Math.pow(1.1, lv), tg = bombTarget(sim, t.x, t.y, speed);
      const d = Math.atan2(tg.y - t.y, tg.x - t.x), life = Math.max(2, Math.round(Math.hypot(tg.x - t.x, tg.y - t.y) / speed));
      bullets.spawn(Kind.Bomb, t.x, t.y, d, speed, dmg, 0.6 + 0.15 * lv, rgb, life, { aux: count });
      t.rich = d / RAD; return true;
    }
    case 'tHeal': {
      if (c.buildings.heal(t.x, t.y, range, dmg)) sfx.heal();
      return true;
    }
    case 'tLaser': {
      const others = c.towers.filter((o) => o.key === 'tLaser');
      if (others.length < 2) return false;
      for (const o of others) {
        if (o === t) continue;
        const s = Math.hypot(t.x - o.x, t.y - o.y);
        if (s <= range) {
          hitLine(c, rgb, true, t.x, t.y, o.x, o.y, 1.5, dmg);
          fx.beam(t.x, t.y, o.x, o.y, rgb.map((v) => v * 0.1) as RGB, 3, 0.17);
        }
      }
      t.rich = angleAverageTower(c.towers, t.x, t.y, 'tLaser') / RAD; return true;
    }
    case 'tFire': {
      const e = pickTarget(sim, t.x, t.y, inner, range, 'nearest'); if (e < 0) return false;
      const d0 = Math.atan2(sim.y[e] - t.y, sim.x[e] - t.x), ox = t.x + Math.cos(d0) * 30, oy = t.y + Math.sin(d0) * 30, sp = 3 + Math.random();
      const d = aimDir(sim, ox, oy, e, sp, 1) + (Math.random() * 20 - Math.random() * 20) * RAD;
      bullets.spawn(Kind.Fireball, ox, oy, d, sp, dmg, 1, rgb, Math.max(1, Math.round((range - 25) / 3)));
      t.rich = d0 / RAD; return true;
    }
    case 'tBounce': {
      if (!hasEnemy) return false;
      const a = t.rich * RAD, s = 5 + 0.5 * lv;
      bullets.spawn(Kind.Bounce, t.x + Math.cos(a) * 15, t.y + Math.sin(a) * 15, a, s, dmg, 0.6 + 0.15 * lv, rgb, Math.max(1, Math.round(range / s)),
        { spin: (Math.random() < 0.5 ? 1 : -1) * Math.pow(0.1 + Math.random() * 6561, 0.125) * ((15 - lv) / 15) * RAD });
      return true;
    }
    case 'tSonic': {
      const e = pickTarget(sim, t.x, t.y, inner, range, 'nearest'); if (e < 0) return false;
      const d0 = Math.atan2(sim.y[e] - t.y, sim.x[e] - t.x), ox = t.x + Math.cos(d0) * 15, oy = t.y + Math.sin(d0) * 15, sp = 3 + Math.random();
      const d = aimDir(sim, ox, oy, e, sp, 1);
      bullets.spawn(Kind.Sonic, ox, oy, d, sp, dmg, 1, rgb, Math.max(1, Math.round(range / 3)));
      t.rich = d / RAD; return true;
    }
    case 'tFlashlight': {
      const e = pickTarget(sim, t.x, t.y, inner, range, 'nearest'); if (e < 0) return false;
      const d = Math.atan2(sim.y[e] - t.y, sim.x[e] - t.x), half = Math.atan(147 / 400);
      if (t.steps % 5 === 0) { // the cone only hurts every 5th step
        const cs = Math.cos(d), sn = Math.sin(d);
        for (let i = 0; i < sim.n; i++) {
          if (sim.hp[i] <= 0) continue;
          const dx = sim.x[i] - t.x, dy = sim.y[i] - t.y, along = dx * cs + dy * sn, perp = Math.abs(-dx * sn + dy * cs);
          if (along >= -6.5 && along <= range + 6.5 && perp - 6.5 <= (Math.max(0, along) * 147) / 400 + 3) hurt(c, i, dmg, rgb);
        }
      }
      fx.cone(t.x, t.y, d, range, half, rgb.map((v) => v * 0.55) as RGB);
      t.rich = d / RAD; return true;
    }
    case 'tStinger': {
      const e = pickTarget(sim, t.x, t.y, inner, range, 'nearest'); if (e < 0) return false;
      const d = Math.atan2(sim.y[e] - t.y, sim.x[e] - t.x);
      bullets.spawn(Kind.Disease, t.x, t.y, d, 3, dmg, 0.2, rgb, 0,
        { target: sim.id[e], aux: count, aux2: count, level: lv, spin: (Math.random() < 0.5 ? 1 : -1) * Math.pow(0.1 + Math.random() * 6561, 0.125) * RAD });
      t.rich = d / RAD; return true;
    }
    default: return false; // tTime / tMoney act passively

  }
}
