import { buildGraph } from '../../src/graph.ts';
import { EnemySim } from '../../src/enemies.ts';
import { BulletSystem, Kind } from '../../src/bullets.ts';
import { TowerLayer } from '../../src/towers.ts';
import type { PlacedTower } from '../../src/towers.ts';
import { buildWaves, WaveRunner } from '../../src/waves.ts';
import { towerInfo } from '../../src/data.ts';
import type { CombatCtx } from '../../src/combat.ts';
import type { MapData } from './mapTypes.ts';

export const keyByName: Record<string, string> = Object.fromEntries(Object.entries(towerInfo).map(([k, t]) => [t.name.toLowerCase(), k]));
const noop = () => {};
/** The real game logic (towers, bullets, enemies, waves) with the rendering parts stubbed out, so thousands of steps run in milliseconds. */
export interface Game {
  map: MapData; sim: EnemySim; bullets: BulletSystem; towers: TowerLayer; waves: WaveRunner;
  buildings: { x: number; y: number; hp: number; startHp: number }[];
  credits: number; kills: number; step: number; started: boolean;
  quota: Record<string, number>;
  place(key: string, x: number, y: number): PlacedTower | null;
  upgrade(t: PlacedTower): boolean;
  callNextWave(): void;
  tick(): void;
}

export function newGame(map: MapData): Game {
  const g = buildGraph(map), sim = new EnemySim(g, 30000), towers = new TowerLayer(g), waves = buildWaves();
  const buildings = g.buildings.map((b) => ({ x: b.x, y: b.y, hp: b.hp, startHp: b.hp }));
  let bullets: BulletSystem;
  bullets = new BulletSystem(20000, noop, (b) => { for (let k = 0; k < b.sparks; k++) bullets.spawn(Kind.Gun, b.x, b.y, Math.random() * Math.PI * 2, 3 + Math.random() * 7, b.damage, 1, b.color); }, noop, noop);
  const game: Game = {
    map, sim, bullets, towers, buildings, credits: map.money, kills: 0, step: 0, started: false, quota: {},
    waves: new WaveRunner(waves, (w) => { const d = waves[w]; sim.spawn(d.type, d.hp * map.hp_mult, d.speed * map.speed_mult, d.value * map.value_mult, [255, 255, 255]); }),
    place(key, x, y) {
      const cost = towerInfo[key].cost[0];
      if ((game.quota[key] ?? 0) <= 0 || game.credits < cost) return null;
      const t = towers.place(key, x, y); if (!t) return null;
      game.credits -= cost; game.quota[key]--; return t;
    },
    upgrade(t) {
      const cost = towers.upgradeCost(t);
      if (cost === null || game.credits < cost) return false;
      game.credits -= cost; return towers.upgrade(t);
    },
    callNextWave() { game.started = true; game.waves.nextWave(); },
    tick() {
      const ctx = {
        sim, bullets, towers: towers.towers, pointer: { x: 320, y: 240 },
        fx: { beam: noop, lightning: noop, hit: noop, ring: noop, cone: noop, step: noop, render: noop, clear: noop },
        numbers: { add: noop },
        buildings: { heal: (x: number, y: number, range: number, amt: number) => { let any = false; for (const b of buildings) if (b.hp > 0 && Math.hypot(b.x - x, b.y - y) <= range) { b.hp += amt; any = true; } return any; } },
      } as unknown as CombatCtx;
      if (game.started) game.waves.step();
      sim.step(towers.slowers());
      towers.step(ctx);
      bullets.step(sim);
      for (let i = sim.n - 1; i >= 0; i--) if (sim.hp[i] <= 0) { // kills pay out at once (the game delays it by about a second)
        game.credits += sim.value[i] + towers.moneyTowersNear(sim.x[i], sim.y[i]).reduce((a, m) => a + m.value, 0);
        sim.remove(i); game.kills++;
      }
      const alive = buildings.filter((b) => b.hp > 0);
      if (alive.length) for (let i = 0; i < sim.n; i++) {
        let best: (typeof alive)[number] | null = null, bd = 99;
        for (const b of alive) { const d = Math.hypot(b.x - sim.x[i], b.y - sim.y[i]); if (d < bd) { bd = d; best = b; } }
        if (best) best.hp -= 1;
      }
      game.step++;
    },
  };
  for (const n of map.towers) game.quota[keyByName[n]] = (game.quota[keyByName[n]] ?? 0) + 1;
  return game;
}
