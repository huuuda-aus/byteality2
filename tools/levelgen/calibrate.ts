import { rng, type MapData } from './mapTypes.ts';
import { newGame } from './sim.ts';
import { Bot } from './bot.ts';

export interface BotResult { survived: boolean; kills: number; minHpFrac: number; destroyedAt: number | null; wavesReached: number; towers: number; creditsLeft: number }
export type Calibrated = MapData & { goal: number; bot: BotResult; style?: string };

/** Play a level with the bot for `steps` steps (seeded, so reproducible). */
export function botPlay(map: MapData, steps: number, seed: number): BotResult {
  const realRandom = Math.random; Math.random = rng(seed);
  try {
    const game = newGame(map), bot = new Bot(game);
    const max = game.buildings.reduce((a, b) => a + b.startHp, 0);
    let minFrac = 1, destroyedAt: number | null = null;
    for (let s = 0; s < steps; s++) {
      bot.update(); game.tick();
      const hp = game.buildings.reduce((a, b) => a + Math.max(0, b.hp), 0);
      minFrac = Math.min(minFrac, hp / max);
      if (hp <= 0) { destroyedAt = s; break; }
    }
    return { survived: destroyedAt === null, kills: game.kills, minHpFrac: minFrac, destroyedAt, wavesReached: game.waves.currentWave, towers: game.towers.towers.length, creditsLeft: Math.round(game.credits) };
  } finally { Math.random = realRandom; }
}

const round10 = (v: number, unit: number) => Math.round(v / unit) * unit;

/**
 * Sets level length, credits, enemy strength and the goal score from play-testing:
 *  - length follows the tower allowance (the originals: r = 0.5 with the number of towers, 4:00 .. 10:00),
 *  - difficulty: the least credits (then the weakest enemies) at which the bot still wins with the building above 40% health,
 *  - goal: 90% of what the bot kills in that time. Tested on the 120 original levels: the bot kills 0.61 per second (median) and the author's
 *    goals work out to 0.63 per second, i.e. the bot plays like a typical player at the original goal level, and a goal a little below it is reachable.
 * Returns null when no setting lets the bot survive (the layout is too hard for its tower kit).
 */
export function calibrate(base: MapData, seed: number): { map: Calibrated; tried: number } | { fail: string; tried: number } {
  const quota = base.towers.length;
  const seconds = Math.min(600, Math.max(240, round10(120 + 12 * quota, 10)));
  const steps = seconds * 60;
  let tried = 0;
  const moneyLevels = [30, 40, 50, 70, 100, 140, 190, 260, 360, 500];
  const ok = (r: BotResult) => r.survived && r.minHpFrac >= 0.4 && r.towers >= 2;
  const play = (money: number, hp_mult: number) => { const map: MapData = { ...base, steps, seconds, money, hp_mult }; tried++; return { map, r: botPlay(map, steps, seed) }; };
  // 1) the least credits, at the usual enemy strength (then weaker enemies), at which the bot still wins
  for (const hp_mult of [4, 3, 2]) {
    for (const money of moneyLevels) {
      let cur = play(money, hp_mult);
      if (!ok(cur.r)) continue;
      // 2) too easy (the bot never gets hurt)? make the enemies tougher while the bot still wins with a margin; the originals' median is ~40% building health left
      let best = cur;
      while (best.r.minHpFrac > 0.8 && best.map.hp_mult < 8) {
        cur = play(money, best.map.hp_mult + 1);
        if (!ok(cur.r)) break;
        best = cur;
      }
      const goal = Math.max(10, round10(0.9 * best.r.kills, 10));
      if (goal < 0.15 * seconds) return { fail: 'goal too low (too few enemies to kill)', tried };
      return { map: { ...best.map, goal, bot: best.r }, tried };
    }
  }
  return { fail: 'the bot cannot survive this layout with its tower kit', tried };
}
