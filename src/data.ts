import modelsJson from '../assets/models.json';
import towersJson from '../assets/towers.json';
import mapsJson from '../assets/maps.json';

export const FIELD_W = 640;
export const FIELD_H = 480;
/** Playfield in original coordinates: y runs 75..405 between the HUD bars. */
export const FIELD_TOP = 75;

export type Segments = number[]; // flat [x1,y1,x2,y2,...]

export interface ModelSet {
  towers: Record<string, Segments>;
  bullets: Record<string, Segments>;
  enemies: Record<string, Segments>;
}

export interface TowerInfo {
  id: number;
  name: string;
  color: [number, number, number];
  baseRadius: number;
  innerRange: number;
  techLevel: number;
  cost: number[];
  range: number[];
  damage: number[];
  bullets: number[];
  firerate: number[];
}

export interface MapData {
  steps: number; // at 60 steps/s
  seconds: number;
  money: number;
  hp_mult: number;
  speed_mult: number;
  value_mult: number;
  nodes: [number, number, number][]; // x, y (px), order 0=source .. 100=sink
  edges: [number, number][]; // 1-based node indices (GameMaker heritage)
  buildings: [number, number, number][]; // x, y, hp
  towers: string[];
}

export const models = modelsJson as unknown as ModelSet;
export const towerInfo = towersJson as unknown as Record<string, TowerInfo>;
const maps = mapsJson as unknown as {
  campaign_order: Record<string, string>;
  goal_scores: Record<string, number>;
  maps: Record<string, MapData>;
};
export const mapsByName = maps.maps;
/** Campaign order as [name, goalScore]. */
export const campaign: [string, number][] = Object.entries(maps.campaign_order)
  .sort((a, b) => Number(a[0]) - Number(b[0]))
  .map(([i, name]) => [name, maps.goal_scores[i]]);

/** Enemy types in the original's constant order (eNormal=0 .. eBoss=9). */
/** All enemies share one footprint: radius 6 (the original's boss was 8; it is scaled down to match). */
export const ENEMY_RADIUS = 6;
export const PATH_WIDTH = ENEMY_RADIUS * 2 + 2; // path is 2 px wider than an enemy
/** Per-type model scale so every enemy has radius ENEMY_RADIUS (index = enemy type). */
export const ENEMY_SCALE = [1, 1, 1, 1, 1, 1, 1, 1, 1, ENEMY_RADIUS / 8];

export const ENEMY_NAMES = ['normal', 'many', 'fast', 'weak', 'strong', 'slow', 'few', 'super', 'bonus', 'boss'] as const;

export const MAX_LEVEL = 9; // levels 0..9 (original MaxLevel)
/** Original set_array: range and firerate are geometrically interpolated between the level-0 and max-level value. */
function geo(pair: number[], level: number): number {
  return Math.round(Math.pow(pair[0], (MAX_LEVEL - level) / MAX_LEVEL) * Math.pow(pair[1], level / MAX_LEVEL));
}
export const towerRange = (t: TowerInfo, level: number) => geo(t.range, level);
export const towerFirerate = (t: TowerInfo, level: number) => geo(t.firerate, level);
