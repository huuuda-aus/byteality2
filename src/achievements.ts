import { towerInfo } from './data.ts';
import { rowCount, unlockedRows } from './progress.ts';
import { save, type SaveData } from './save.ts';

export interface Achievement { id: string; title: string; desc: string; test: (d: SaveData, ctx: Ctx) => boolean }
/** Facts about the level that just ended (not persisted). */
export interface Ctx { won?: boolean; buildingUntouched?: boolean }

const goalsReached = (d: SaveData) => Object.values(d.levels).filter((l) => l.goalReached).length;

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first_blood', title: 'First blood', desc: 'Destroy your first enemy', test: (d) => d.stats.kills >= 1 },
  { id: 'kills_100', title: 'Exterminator', desc: 'Destroy 100 enemies', test: (d) => d.stats.kills >= 100 },
  { id: 'kills_1000', title: 'Pest control', desc: 'Destroy 1,000 enemies', test: (d) => d.stats.kills >= 1000 },
  { id: 'kills_10000', title: 'Byte massacre', desc: 'Destroy 10,000 enemies', test: (d) => d.stats.kills >= 10000 },
  { id: 'first_win', title: 'Survivor', desc: 'Complete a level', test: (d) => d.stats.wins >= 1 },
  { id: 'goal_1', title: 'On target', desc: 'Reach the goal score on a level', test: (d) => goalsReached(d) >= 1 },
  { id: 'goals_10', title: 'Overachiever', desc: 'Reach the goal score on 10 levels', test: (d) => goalsReached(d) >= 10 },
  { id: 'goals_40', title: 'Perfectionist', desc: 'Reach the goal score on 40 levels', test: (d) => goalsReached(d) >= 40 },
  { id: 'rows_5', title: 'Moving on up', desc: 'Unlock the 5th row of levels', test: () => unlockedRows(save.best()) >= 5 },
  { id: 'rows_all', title: 'Completionist', desc: 'Unlock every row of levels', test: () => unlockedRows(save.best()) >= rowCount },
  { id: 'max_level', title: 'Fully upgraded', desc: 'Upgrade a tower to level 10', test: (d) => d.maxTowerLevel >= 9 },
  { id: 'all_towers', title: 'Collector', desc: 'Build every type of tower', test: (d) => Object.keys(towerInfo).every((k) => (d.towersBuilt[k] ?? 0) > 0) },
  { id: 'flawless', title: 'Untouchable', desc: 'Complete a level without your building taking a hit', test: (_d, c) => !!c.won && !!c.buildingUntouched },
  { id: 'wave_20', title: 'Endurance', desc: 'Reach wave 20 on any level', test: (d) => d.maxWave >= 20 },
  { id: 'wave_100', title: 'Marathon', desc: 'Reach wave 100 on any level', test: (d) => d.maxWave >= 100 },
];

/** Unlock everything whose condition now holds. Returns the achievements that were just unlocked. */
export function checkAchievements(ctx: Ctx = {}): Achievement[] {
  const fresh = ACHIEVEMENTS.filter((a) => !(a.id in save.data.achievements) && a.test(save.data, ctx));
  for (const a of fresh) save.data.achievements[a.id] = Date.now();
  if (fresh.length) save.dirty();
  return fresh;
}
