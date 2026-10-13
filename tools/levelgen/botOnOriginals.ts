import { readFileSync } from 'node:fs';
import { botPlay } from './calibrate.ts';
const d = JSON.parse(readFileSync(new URL('../../assets/maps.json', import.meta.url), 'utf8'));
const rows: { name: string; goal: number; kills: number; survived: boolean; minHp: number; secs: number; towers: number }[] = [];
for (const [i, name] of Object.entries<string>(d.campaign_order)) {
  const m = d.maps[name], r = botPlay({ ...m }, m.steps, 1);
  rows.push({ name, goal: d.goal_scores[i], kills: r.kills, survived: r.survived, minHp: r.minHpFrac, secs: m.seconds, towers: r.towers });
}
const pct = (v: number[], p: number) => v.slice().sort((a, b) => a - b)[Math.min(v.length - 1, Math.floor(p * v.length))];
const ratio = rows.filter((r) => r.kills > 0).map((r) => r.goal / r.kills);
console.log('levels', rows.length, '| bot survived', rows.filter((r) => r.survived).length, '| bot reached the goal', rows.filter((r) => r.kills >= r.goal).length);
console.log('goal / bot kills  p10/p25/p50/p75/p90:', [0.1, 0.25, 0.5, 0.75, 0.9].map((p) => pct(ratio, p).toFixed(2)).join(' / '));
console.log('bot kills per second of level  p10/p50/p90:', [0.1, 0.5, 0.9].map((p) => pct(rows.map((r) => r.kills / r.secs), p).toFixed(2)).join(' / '));
console.log('bot min building hp fraction  p10/p50/p90:', [0.1, 0.5, 0.9].map((p) => pct(rows.map((r) => r.minHp), p).toFixed(2)).join(' / '));
console.log('lost:', rows.filter((r) => !r.survived).map((r) => r.name).join(', '));
