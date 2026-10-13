import { mkdirSync, writeFileSync } from 'node:fs';
import { generateBatch } from './batch.ts';

const args = new Map<string, string>(); for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
const count = Number(args.get('count') ?? 30), seed = Number(args.get('seed') ?? 1), out = args.get('out') ?? 'generated/maps.json';
const batch = generateBatch({ count, seed, calibrate: args.get('calibrate') !== 'off' });
mkdirSync(out.replace(/\/[^/]*$/, ''), { recursive: true });
writeFileSync(out, JSON.stringify(batch));
console.log(`${Object.keys(batch.maps).length}/${count} levels written to ${out}`);
for (const [n, t] of Object.entries(batch.tally)) console.log(n.padEnd(11), `${t.ok}/${t.tried} accepted`, Object.entries(t.why).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${v}x ${k}`).join('; '));
