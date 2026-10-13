import { readFileSync } from 'node:fs';
import { run } from './runner.ts';
const file = process.argv[2] ?? 'generated/maps.json', which = process.argv[3] ?? 'maps';
const maps = JSON.parse(readFileSync(new URL('../../' + file, import.meta.url), 'utf8')).maps as Record<string, any>;
console.log('level'.padEnd(22), 'time   undefended: wave  spawned  leaked  building lost after');
let worst = 0;
for (const [name, map] of Object.entries(maps).slice(0, Number(process.argv[4] ?? 40))) {
  const t0 = performance.now();
  const r = run(map);
  const lost = r.destroyedAtStep === null ? 'survived' : (r.destroyedAtStep / 60).toFixed(0) + ' s';
  worst = Math.max(worst, performance.now() - t0);
  console.log(name.padEnd(22), `${Math.round(map.steps / 60)} s`.padEnd(6), '           ', String(r.wavesReached).padEnd(5), String(r.spawned).padEnd(8), String(r.leaked).padEnd(7), lost);
}
console.log('slowest simulation:', Math.round(worst), 'ms (a whole level, headless)');
void which;
