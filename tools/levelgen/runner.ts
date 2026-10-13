import { buildGraph } from '../../src/graph.ts';
import { EnemySim } from '../../src/enemies.ts';
import { buildWaves, WaveRunner } from '../../src/waves.ts';
import type { MapData } from './mapTypes.ts';

export const ENEMY_RANGE = 99;

export interface RunHooks {
  /** Called every simulation step before enemies move; a bot places/upgrades towers and shoots here. */
  onStep?: (ctx: RunContext) => void;
}
export interface RunContext { step: number; sim: EnemySim; wave: number; buildings: { x: number; y: number; hp: number }[]; credits: number; kills: number }
export interface RunResult {
  steps: number;            // steps simulated
  wavesReached: number;
  spawned: number;
  kills: number;
  leaked: number;           // enemies that reached a sink
  buildingHp: number[];     // remaining hp per building (0 = destroyed)
  destroyedAtStep: number | null; // when the last building fell
  completed: boolean;       // survived until map.steps
}

/** Headless version of the game loop (waves, enemy movement along the real graph, enemy fire on buildings). No rendering, no towers unless a hook adds them. */
export function run(map: MapData, hooks: RunHooks = {}, maxSteps = map.steps): RunResult {
  const g = buildGraph(map), sim = new EnemySim(g, 30000), waves = buildWaves();
  const buildings = g.buildings.map((b) => ({ x: b.x, y: b.y, hp: b.hp }));
  let spawned = 0, kills = 0, leakedBefore = 0, destroyedAt: number | null = null;
  const wr = new WaveRunner(waves, (w) => {
    const d = waves[w];
    if (sim.spawn(d.type, d.hp * map.hp_mult, d.speed * map.speed_mult, d.value * map.value_mult, [255, 255, 255]) >= 0) spawned++;
  });
  wr.nextWave(); // start the first wave straight away, like pressing Space
  let step = 0;
  for (; step < maxSteps; step++) {
    wr.step();
    const ctx: RunContext = { step, sim, wave: wr.currentWave, buildings, credits: 0, kills };
    hooks.onStep?.(ctx);
    kills = ctx.kills;
    for (let i = sim.n - 1; i >= 0; i--) if (sim.hp[i] <= 0) { sim.remove(i); kills++; }
    sim.step();
    leakedBefore = sim.leaked;
    // enemies within range shoot the nearest building: 1 hp per enemy per step
    const alive = buildings.filter((b) => b.hp > 0);
    if (alive.length) {
      for (let i = 0; i < sim.n; i++) {
        let best: (typeof alive)[number] | null = null, bd = ENEMY_RANGE;
        for (const b of alive) { const d = Math.hypot(b.x - sim.x[i], b.y - sim.y[i]); if (d < bd) { bd = d; best = b; } }
        if (best) best.hp -= 1;
      }
      if (!buildings.some((b) => b.hp > 0)) { destroyedAt = step; step++; break; }
    }
  }
  return { steps: step, wavesReached: wr.currentWave, spawned, kills, leaked: leakedBefore, buildingHp: buildings.map((b) => Math.max(0, b.hp)), destroyedAtStep: destroyedAt, completed: destroyedAt === null && step >= maxSteps };
}
