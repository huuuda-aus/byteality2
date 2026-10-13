import packJson from '../assets/generated-levels.json' with { type: 'json' };
import { towerInfo, type MapData } from './data.ts';
import { buildGraph } from './graph.ts';

/** Where generated levels come from:
 *  - the shipped pack, assets/generated-levels.json (commit an exported file there to deploy levels with the game),
 *  - "mine": levels kept in the generator gallery or imported in the level select, stored in this browser (localStorage). */
export interface CustomLevel { name: string; map: MapData; source: 'pack' | 'mine' }
const KEY = 'byteality.kept';
const knownTowers = new Set(Object.values(towerInfo).map((t) => t.name.toLowerCase()));

const readMine = (): Record<string, MapData> => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { return {}; } };
const writeMine = (m: Record<string, MapData>) => { try { localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* storage unavailable */ } };

/** Structural check of a map from an untrusted file: right shapes, known towers, and a graph the game can load. */
export function validMap(m: unknown): m is MapData {
  const x = m as MapData;
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
  try {
    if (!x || !Array.isArray(x.nodes) || !Array.isArray(x.edges) || !Array.isArray(x.buildings) || !Array.isArray(x.towers)) return false;
    if (![x.steps, x.money, x.hp_mult, x.speed_mult, x.value_mult].every(num) || x.steps <= 0 || x.steps > 255 * 600) return false;
    if (x.nodes.length > 255 || x.edges.length > 255 || x.buildings.length === 0 || x.buildings.length > 255) return false;
    if (!x.nodes.every((n) => Array.isArray(n) && n.length === 3 && n.every(num)) || !x.edges.every((e) => Array.isArray(e) && e.length === 2 && e.every(num))) return false;
    if (!x.buildings.every((b) => Array.isArray(b) && b.length === 3 && b.every(num)) || !x.towers.every((t) => typeof t === 'string' && knownTowers.has(t))) return false;
    if (x.towers.length === 0 || (x.goal !== undefined && !num(x.goal))) return false;
    buildGraph(x); // throws on dangling edges, dead ends, no source
    return true;
  } catch { return false; }
}

export function loadCustom(): CustomLevel[] {
  const out: CustomLevel[] = [];
  const pack = (packJson as { maps?: Record<string, MapData> }).maps ?? {};
  for (const [name, map] of Object.entries(pack)) if (validMap(map)) out.push({ name, map, source: 'pack' });
  for (const [name, map] of Object.entries(readMine())) if (validMap(map) && !out.some((l) => l.name === name)) out.push({ name, map, source: 'mine' });
  return out;
}

/** Import an exported file ({maps: {...}}), a bare name->map object or a single map. Invalid maps are skipped. */
export function importLevels(text: string): { added: number; rejected: number; error?: string } {
  let data: unknown;
  try { data = JSON.parse(text); } catch { return { added: 0, rejected: 0, error: 'not a JSON file' }; }
  const obj = data as Record<string, unknown>;
  let maps: Record<string, unknown>;
  if (obj && typeof obj === 'object' && obj.maps && typeof obj.maps === 'object') maps = obj.maps as Record<string, unknown>;
  else if (validMap(obj)) maps = { [`imported_${Date.now().toString(36)}`]: obj };
  else maps = obj as Record<string, unknown>;
  const mine = readMine(); let added = 0, rejected = 0;
  for (const [name, map] of Object.entries(maps ?? {})) {
    if (validMap(map)) { mine[name.replace(/[^\w-]/g, '_')] = map; added++; } else rejected++;
  }
  if (added) writeMine(mine);
  return { added, rejected, error: added || rejected ? undefined : 'no levels found in the file' };
}

export function removeMine(name: string): void { const m = readMine(); delete m[name]; writeMine(m); }
