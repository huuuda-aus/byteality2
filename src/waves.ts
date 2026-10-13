// Port of wavedata.gml / wave10_set_data.gml. Time units are simulation steps (60/s).
export const WAVE_COLORS: [number, number, number][] = [
  [102, 102, 102], [51, 102, 255], [0, 255, 0], [0, 204, 255], [255, 102, 51],
  [204, 0, 255], [255, 204, 0], [255, 255, 255], [153, 204, 255], [255, 0, 0],
]; // indexed by enemy type: normal many fast weak strong slow few super bonus boss
export const WAVE_TYPE_NAMES = ['Normal', 'Many', 'Fast', 'Weak', 'Strong', 'Slow', 'Few', 'Super', 'Bonus', 'Boss'];
const [NORMAL, MANY, FAST, WEAK, STRONG, SLOW, FEW, SUPER, BONUS, BOSS] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

/** Every wave gets the same countdown before the next one starts (original: 13-27 s depending on tier). */
export const WAVE_SECONDS = 30;
const WAVE_STEPS = WAVE_SECONDS * 60;

export interface WaveDef {
  type: number; // -1 = none
  hp: number; speed: number; amount: number; value: number;
  time: number; interval: number;
}

// tier: hpBonus, hpLo, hpHi, hpBoss, speedLo, amLo, amHi, amBonus, valNorm, valBonus, valBoss, time, interval, bonusInterval
const TIERS: number[][] = [
  [1, 5, 25, 1000, 0.20, 2, 5, 10, 1, 2, 60, 800, 15, 8],
  [4, 20, 100, 2500, 0.25, 3, 6, 12, 2, 4, 120, 850, 14, 7],
  [15, 75, 375, 8750, 0.30, 4, 8, 16, 3, 7, 200, 900, 13, 7],
  [55, 270, 1300, 30000, 0.35, 5, 10, 20, 5, 12, 300, 950, 12, 6],
  [175, 850, 4000, 90000, 0.40, 6, 12, 24, 7, 18, 440, 1025, 11, 6],
  [500, 2375, 11000, 240000, 0.45, 7, 14, 28, 10, 25, 600, 1100, 10, 5],
  [1300, 6000, 27500, 575000, 0.50, 8, 16, 32, 15, 35, 800, 1200, 9, 5],
  [3125, 14000, 62500, 1250000, 0.55, 9, 18, 36, 20, 48, 1080, 1300, 9, 5],
  [6500, 28250, 125000, 2500000, 0.60, 10, 20, 40, 26, 64, 1400, 1400, 8, 4],
  [12250, 52500, 225000, 4375000, 0.65, 11, 22, 44, 32, 80, 1900, 1475, 8, 4],
  [23000, 95000, 400000, 7500000, 0.70, 12, 24, 48, 40, 100, 2600, 1525, 7, 4],
  [42500, 170000, 700000, 12500000, 0.75, 13, 26, 52, 50, 125, 3200, 1575, 7, 3],
  [77500, 300000, 1200000, 20000000, 0.80, 14, 28, 56, 60, 150, 4000, 1600, 6, 3],
  [145000, 550000, 2000000, 32500000, 0.85, 15, 30, 60, 72, 180, 5000, 1600, 6, 3],
  [250000, 925000, 3250000, 50000000, 0.90, 16, 32, 64, 86, 220, 6200, 1600, 5, 3],
  [425000, 1500000, 5000000, 72500000, 0.95, 17, 34, 68, 100, 260, 8000, 1600, 5, 2],
  [725000, 2500000, 7500000, 102500000, 1.00, 18, 36, 72, 120, 300, 10000, 1600, 5, 2],
  [1200000, 4000000, 11250000, 147500000, 1.05, 19, 38, 76, 144, 360, 10000, 1600, 5, 2],
  [2000000, 6500000, 16250000, 200000000, 1.10, 20, 40, 80, 170, 420, 10000, 1600, 5, 2],
  [3250000, 10000000, 22500000, 250000000, 1.15, 21, 42, 84, 200, 500, 10000, 1600, 5, 2],
];

function shuffle<T>(a: T[], rnd: () => number): T[] {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** waves[0] is the initial 15 s pause; waves[10*(tier-1)+i] follow the original numbering. */
export function buildWaves(rnd: () => number = Math.random): WaveDef[] {
  const waves: WaveDef[] = [{ type: -1, hp: 0, speed: 0, amount: 0, value: 0, time: WAVE_STEPS, interval: 1 }];
  TIERS.forEach((t, k) => {
    const [hpBonus, hpLo, hpHi, hpBoss, spLo, nuLo, nuHi, nuBonus, vaAll, vaBonus, vaBoss, , interval, bonusInterval] = t; // original per-tier time (index 11) replaced by WAVE_SECONDS
    const spHi = 2 * spLo, spBoss = 0.8 * spLo, spBonus = 5 * spLo;
    const o234 = shuffle([FAST, STRONG, MANY], rnd);
    const o567 = shuffle([SLOW, WEAK, FEW], rnd);
    const base = 10 * k;
    const set = (i: number, type: number, hp: number, speed: number, amount: number, value: number, tm = WAVE_STEPS, iv = interval) => {
      waves[base + i] = { type, hp, speed, amount, value, time: tm, interval: iv };
    };
    set(1, NORMAL, hpLo, spLo, nuLo, vaAll);
    [...o234.map((ty, j) => [2 + j, ty]), ...o567.map((ty, j) => [5 + j, ty])].forEach(([i, ty]) => {
      let hp = hpLo, sp = spLo, nu = nuLo;
      if (ty === MANY) { hp = hpLo; sp = spLo; nu = nuHi; }
      if (ty === FAST) { hp = hpLo; sp = spHi; nu = nuLo; }
      if (ty === WEAK) { hp = hpLo; sp = spHi; nu = nuHi; }
      if (ty === STRONG) { hp = hpHi; sp = spLo; nu = nuLo; }
      if (ty === SLOW) { hp = hpHi; sp = spLo; nu = nuHi; }
      if (ty === FEW) { hp = hpHi; sp = spHi; nu = nuLo; }
      set(i, ty, hp, sp, nu, vaAll);
    });
    set(8, SUPER, hpHi, spHi, nuHi, vaAll);
    set(9, BONUS, hpBonus, spBonus, nuBonus, vaBonus, WAVE_STEPS, bonusInterval);
    set(10, BOSS, hpBoss, spBoss, 1, vaBoss, WAVE_STEPS, interval);
  });
  return waves;
}

/** Port of the controllerobject Step logic: waves overlap, each spawns `amount` enemies at `interval` steps. */
export class WaveRunner {
  currentWave = 0; // 0 = waiting for the player's first Space
  waveTime = 0;
  started = false;
  private counters: number[] = [0];
  constructor(readonly waves: WaveDef[], private spawn: (waveId: number) => void) {}

  /** Seconds until the next wave starts on its own (0 until the first wave is started). */
  get secondsLeft(): number { return this.started ? Math.max(0, (this.waves[this.currentWave].time - this.waveTime) / 60) : 0; }

  step(): void {
    if (!this.started) return;
    this.waveTime++;
    for (let w = 0; w <= this.currentWave; w++) {
      const d = this.waves[w];
      this.counters[w]++;
      if (d.type >= 0 && this.counters[w] % d.interval === 0 && this.counters[w] < d.amount * d.interval) this.spawn(w);
    }
    if (this.waveTime > this.waves[this.currentWave].time && this.currentWave < this.waves.length - 1) this.nextWave();
  }

  /** Space bar in the original: jump to the next wave immediately. */
  nextWave(): void {
    if (this.currentWave >= this.waves.length - 1) return;
    this.started = true;
    this.currentWave++;
    this.waveTime = 0;
    this.counters[this.currentWave] = -1;
  }
}
