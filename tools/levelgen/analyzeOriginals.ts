import { readFileSync } from 'node:fs';
import { analyze } from './metrics.ts';
const maps = JSON.parse(readFileSync(new URL('../../assets/maps.json', import.meta.url), 'utf8')).maps as Record<string, any>;
const rows: Record<string, number>[] = [], issues: Record<string, number> = {};
for (const [name, map] of Object.entries(maps)) {
  const r = analyze(map);
  rows.push(r.m);
  for (const e of r.errors) issues['ERR ' + e.replace(/\d+/g, 'N')] = (issues['ERR ' + e.replace(/\d+/g, 'N')] ?? 0) + 1;
  for (const w of r.warnings) issues['warn ' + w.replace(/\d+/g, 'N')] = (issues['warn ' + w.replace(/\d+/g, 'N')] ?? 0) + 1;
}
const pct = (v: number[], p: number) => v.sort((a, b) => a - b)[Math.min(v.length - 1, Math.floor(p * v.length))];
console.log('metric'.padEnd(14), 'min    p10    p50    p90    max');
for (const k of Object.keys(rows[0])) {
  const v = rows.map((r) => r[k]).filter((x) => x !== undefined);
  console.log(k.padEnd(14), [0, 0.1, 0.5, 0.9, 0.999].map((p) => String(pct(v.slice(), p)).padEnd(6)).join(' '));
}
console.log(issues);
