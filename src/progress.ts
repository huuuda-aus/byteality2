import { campaign } from './data.ts';

/** Maps per row in the level select (the original used rows of 4). */
export const ROW_SIZE = 3;
export type Status = 'new' | 'failed' | 'partial' | 'goal';

export const rowCount = Math.ceil(campaign.length / ROW_SIZE);
export const rowMaps = (row: number) => campaign.slice(row * ROW_SIZE, row * ROW_SIZE + ROW_SIZE); // row is 0-based

/** Original rule (number_of_mapbars_unlocked), generalised to rows of ROW_SIZE: row 0 is always open; row r opens once the
 *  total kills over all maps reach the sum of the goal scores of every map in rows 0..r-1. */
export function requiredKills(row: number): number {
  let sum = 0;
  for (let r = 0; r < row; r++) for (const [, goal] of rowMaps(r)) sum += goal;
  return sum;
}
export const totalKills = (best: Record<string, number>) => Object.values(best).reduce((a, b) => a + b, 0);
export function unlockedRows(best: Record<string, number>): number {
  const total = totalKills(best);
  let rows = 1;
  for (let r = 1; r < rowCount; r++) if (total >= requiredKills(r)) rows = r + 1;
  return rows;
}

/** Status icon colours of the original: grey = not played, red = failed (score 1), dark yellow = completed below goal, green = goal reached. */
export function statusOf(kills: number | undefined, goal: number): Status {
  if (!kills) return 'new';
  if (kills === 1) return 'failed';
  return kills >= goal ? 'goal' : 'partial';
}

