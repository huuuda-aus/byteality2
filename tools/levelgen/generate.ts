import { mkdirSync, writeFileSync } from 'node:fs';
import { analyze, type Report } from './metrics.ts';
import { STYLES, CROSSING_STYLES } from './generators.ts';
import { rng, type MapData } from './mapTypes.ts';
import { calibrate, type Calibrated } from './calibrate.ts';

const args = new Map<string, string>(); for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
const noCalibrate = args.get('calibrate') === 'off';
const count = Number(args.get('count') ?? 30), seed = Number(args.get('seed') ?? 1), out = args.get('out') ?? 'generated/maps.json';

/** Level acceptance, calibrated on the 120 original maps (see analyzeOriginals.ts). Returns the reasons to reject (empty = accept). */
export function accept(rep: Report, style = ''): string[] {
  const why = [...rep.errors];
  const m = rep.m;
  if (m.nodes > 60) why.push('too many nodes');
  if (!m.arena) {
    if (m.routeMean < 220) why.push(`route too short (${m.routeMean} px)`);
    if (m.routeMean > 2200) why.push(`route too long (${m.routeMean} px)`);
    if (m.routeP95 > 2 * m.routeMean + 300) why.push('some enemies wander far longer than the average');
  }
  if (m.coverage < 0.9) why.push('too little of the path is reachable by towers');
  if (m.towerSpots < 1500) why.push('not enough room to build');
  if (!m.arena && m.sinkToBuilding > 99) why.push('building too far from a sink');
  if (rep.warnings.some((w) => w.includes('closer than 20 px'))) why.push('corridors too tight');
  if (m.crossings && (!CROSSING_STYLES.has(style) || m.crossings > 2)) why.push('paths cross without a node');
  if (m.arena && rep.warnings.some((w) => w.includes('arena building'))) why.push('arena building out of enemy range');
  if (m.arena && m.edges < 6) why.push('arena loop too small');
  return why;
}

const names = Object.keys(STYLES), maps: Record<string, (MapData | Calibrated) & { style: string }> = {}, reports: Record<string, Report> = {};
const tally: Record<string, { tried: number; ok: number; why: Record<string, number> }> = {};
for (const n of names) tally[n] = { tried: 0, ok: 0, why: {} };
let made = 0, attempt = 0;
const quota = Math.ceil(count / names.length);
while (made < count && attempt < count * 120) {
  const style = names[attempt % names.length];
  const r = rng(seed * 100003 + attempt++), t = tally[style];
  if (t.ok >= quota) continue;
  const map = STYLES[style](r), rep = analyze(map, r), why = accept(rep, style);
  t.tried++;
  if (why.length) { for (const w of why) { const k = w.replace(/[\d.]+/g, 'N'); t.why[k] = (t.why[k] ?? 0) + 1; } continue; }
  let final: MapData & { style: string } = map;
  if (!noCalibrate) { // play-test with the bot: sets length, credits, enemy strength and goal score
    const cal = calibrate(map, seed * 7919 + attempt);
    if ('fail' in cal) { t.why[cal.fail] = (t.why[cal.fail] ?? 0) + 1; continue; }
    final = { ...cal.map, style };
  }
  t.ok++;
  const name = `gen_${seed}_${String(made + 1).padStart(2, '0')}_${style}`;
  maps[name] = final; reports[name] = rep; made++;
}
mkdirSync(out.replace(/\/[^/]*$/, ''), { recursive: true });
writeFileSync(out, JSON.stringify({ seed, maps, reports, tally }));
console.log(`${made}/${count} levels written to ${out} (${attempt} candidates)`);
for (const [n, t] of Object.entries(tally)) console.log(n.padEnd(11), `${t.ok}/${t.tried} accepted`, Object.entries(t.why).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${v}x ${k}`).join('; '));
