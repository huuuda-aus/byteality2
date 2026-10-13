import { campaign } from './data.ts';

const KEY = 'byteality.save';
const OLD_KEY = 'byteality.best'; // v0: just the best kills per map

export interface LevelStats { best: number; attempts: number; wins: number; goalReached: boolean }
export interface Settings { hpMode: 'off' | 'near' | 'always'; damageNumbers: boolean; allDamage: boolean; sound: boolean }
export interface SaveData {
  v: 1;
  created: number;
  levels: Record<string, LevelStats>;
  stats: { kills: number; towersBuilt: number; upgrades: number; wins: number; losses: number; creditsEarned: number };
  towersBuilt: Record<string, number>; // per tower type, ever
  maxTowerLevel: number; // highest level index reached by any tower (0..9)
  maxWave: number; // furthest wave reached in any level
  achievements: Record<string, number>; // id -> unlock time (ms since epoch)
  settings: Settings;
}

const fresh = (): SaveData => ({
  v: 1, created: Date.now(), levels: {},
  stats: { kills: 0, towersBuilt: 0, upgrades: 0, wins: 0, losses: 0, creditsEarned: 0 },
  towersBuilt: {}, maxTowerLevel: 0, maxWave: 0, achievements: {},
  settings: { hpMode: 'always', damageNumbers: true, allDamage: false, sound: true },
});

/** Fill anything missing so saves from older versions (or hand-edited ones) still load. */
function normalize(raw: unknown): SaveData {
  const d = fresh();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<SaveData>;
  if (typeof r.created === 'number') d.created = r.created;
  for (const [k, v] of Object.entries(r.levels ?? {})) if (v && typeof v.best === 'number') d.levels[k] = { best: v.best, attempts: v.attempts ?? 0, wins: v.wins ?? 0, goalReached: !!v.goalReached };
  Object.assign(d.stats, r.stats ?? {});
  Object.assign(d.towersBuilt, r.towersBuilt ?? {});
  d.maxTowerLevel = r.maxTowerLevel ?? 0; d.maxWave = r.maxWave ?? 0;
  Object.assign(d.achievements, r.achievements ?? {});
  Object.assign(d.settings, r.settings ?? {});
  return d;
}

function read(): SaveData {
  try {
    const s = localStorage.getItem(KEY);
    if (s) return normalize(JSON.parse(s));
    const old = localStorage.getItem(OLD_KEY); // migrate the first version's scores
    if (old) {
      const d = fresh();
      for (const [k, best] of Object.entries(JSON.parse(old) as Record<string, number>)) {
        const goal = campaign.find(([n]) => n === k)?.[1] ?? Infinity;
        d.levels[k] = { best, attempts: best > 0 ? 1 : 0, wins: best > 1 ? 1 : 0, goalReached: best >= goal };
      }
      return d;
    }
  } catch { /* corrupt or unavailable storage: start fresh */ }
  return fresh();
}

/** Player progress, kept in localStorage. Mutate `data`, then call dirty(); it is written shortly after and when the page is closed. */
class SaveStore {
  data: SaveData = read();
  private timer = 0;
  private pending = false;

  constructor() { if (!localStorage.getItem(KEY) && localStorage.getItem(OLD_KEY)) this.flush(); } // persist a migrated v0 save at once

  dirty(): void {
    this.pending = true;
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.flush(), 1500);
  }

  /** Write now (only if something changed since the last write, unless `force`). */
  flush(force = true): void {
    window.clearTimeout(this.timer);
    if (!force && !this.pending) return;
    this.pending = false;
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); localStorage.removeItem(OLD_KEY); } catch { /* storage full or blocked: progress lasts for this session only */ }
  }

  reset(): void { this.data = fresh(); this.flush(); }

  /** Best kills per map (a failed attempt counts as 1). */
  best(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(this.data.levels)) if (v.best > 0) out[k] = v.best;
    return out;
  }

  /** Record a finished (or abandoned) attempt: failed/abandoned scores 1, like the original. */
  recordLevel(map: string, kills: number, won: boolean, goal: number | null): void {
    const l = this.data.levels[map] ??= { best: 0, attempts: 0, wins: 0, goalReached: false };
    l.attempts++;
    const score = won ? kills : 1;
    if (score > l.best) l.best = score;
    if (won) { l.wins++; this.data.stats.wins++; if (goal !== null && kills >= goal) l.goalReached = true; } else this.data.stats.losses++;
    this.dirty();
  }
}

export const save = new SaveStore();
addEventListener('pagehide', () => save.flush(false));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') save.flush(false); });
