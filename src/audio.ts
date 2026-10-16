// Sound effects, synthesized with the Web Audio API (no audio files). Everything is short, rate-limited and mixed through a compressor.

const MAX_VOICES = 40;


class Sfx {
  enabled = true;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private voices = 0;
  private last: Record<string, number> = {};

  /** Browsers only allow audio after a user gesture: call from the first click/key press. */
  unlock(): void {
    if (this.ctx) { void this.ctx.resume(); return; }
    try {
      const ctx = new AudioContext();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18; comp.ratio.value = 6;
      this.master = ctx.createGain(); this.master.gain.value = 0.55;
      this.master.connect(comp); comp.connect(ctx.destination);
      const len = ctx.sampleRate, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf; this.ctx = ctx;
      void ctx.resume();
    } catch { this.enabled = false; }
  }

  get ready(): boolean { return !!this.ctx && this.ctx.state === 'running'; }

  /** At most one sound of this kind per `gapMs`, and a global polyphony cap. */
  private ok(id: string, gapMs: number): boolean {
    if (!this.enabled || !this.ready || this.voices >= MAX_VOICES) return false;
    const now = performance.now();
    if (now - (this.last[id] ?? -1e9) < gapMs) return false;
    this.last[id] = now;
    return true;
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0): void {
    const ctx = this.ctx!, t = ctx.currentTime + delay, jitter = 1 + (Math.random() - 0.5) * 0.08;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0 * jitter, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1 * jitter), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master!);
    this.voices++; o.onended = () => { this.voices--; };
    o.start(t); o.stop(t + dur + 0.02);
  }

  private noise(dur: number, vol: number, filter: BiquadFilterType, f0: number, f1: number, q = 1, delay = 0): void {
    const ctx = this.ctx!, t = ctx.currentTime + delay;
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = this.noiseBuf; s.loopStart = Math.random() * 0.5; s.loop = true;
    f.type = filter; f.Q.value = q; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master!);
    this.voices++; s.onended = () => { this.voices--; };
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  }

  /** A tower fired (towers that are silent or have a separate event are not listed). */
  shot(key: string, level: number): void {
    if (!this.ok('shot:' + key, 45)) return;
    const l = level * 0.04; // upgraded towers sound a little fuller
    switch (key) {
      case 'tGun': this.tone('square', 900, 280, 0.07, 0.09 + l); break;
      case 'tRifle': this.tone('square', 760, 240, 0.08, 0.1 + l); break;
      case 'tMinigun': this.tone('square', 1100, 450, 0.04, 0.06 + l); break;
      case 'tCursor': this.tone('triangle', 2200, 1500, 0.03, 0.07); break;
      case 'tNail': this.tone('triangle', 1900, 1100, 0.03, 0.07); break;
      case 'tBallistic': this.tone('triangle', 220, 70, 0.12, 0.2); this.noise(0.05, 0.08, 'lowpass', 2000, 400); break;
      case 'tRocket': case 'tMissile': this.noise(0.22, 0.14, 'bandpass', 350, 1400, 1.2); this.tone('sawtooth', 140, 90, 0.18, 0.05); break;
      case 'tHoming': this.tone('sine', 700, 1500, 0.16, 0.1); break;
      case 'tMine': this.tone('sine', 320, 110, 0.14, 0.2); break;
      case 'tBomb': this.tone('triangle', 180, 60, 0.16, 0.22); break;
      case 'tWire': this.tone('sawtooth', 160, 85, 0.2, 0.06); break;
      case 'tBounce': this.tone('sine', 380, 760, 0.09, 0.14); break;
      case 'tSonic': this.tone('sine', 260, 900, 0.22, 0.12); this.tone('sine', 520, 1800, 0.22, 0.04); break;
      case 'tFire': this.noise(0.08, 0.05, 'highpass', 1500, 900); break;
      case 'tStinger': this.tone('sawtooth', 500, 420, 0.1, 0.04); break;
      case 'tLight': this.tone('sine', 2200, 1600, 0.07, 0.08); break;
      case 'tDedication': case 'tSpread': this.tone('sawtooth', 1300, 200, 0.09, 0.07); break;
      case 'tDischarge': this.noise(0.14, 0.12, 'bandpass', 4000, 1500, 2); this.tone('square', 140, 60, 0.1, 0.05); break;
      case 'tLightning': this.noise(0.2, 0.22, 'bandpass', 3500, 700, 1.5); this.tone('sawtooth', 90, 50, 0.18, 0.12); break;
      case 'tShock': this.noise(0.25, 0.2, 'bandpass', 5000, 600, 1.5); this.tone('sawtooth', 3000, 120, 0.25, 0.08); break;
      case 'tShockwave': this.tone('sine', 150, 40, 0.45, 0.28); this.noise(0.35, 0.1, 'lowpass', 900, 150); break;
      default: break; // Toxic, Time, Money, Laser, Flashlight, Heal: silent here
    }
  }

  heal(): void { if (this.ok('heal', 400)) { this.tone('sine', 880, 880, 0.12, 0.08); this.tone('sine', 1320, 1320, 0.14, 0.06, 0.07); } }
  hit(): void { if (this.ok('hit', 30)) this.noise(0.03, 0.05, 'highpass', 3000, 2500); }
  kill(boss: boolean): void {
    if (!this.ok('kill', boss ? 0 : 35)) return;
    if (boss) { this.noise(0.5, 0.3, 'lowpass', 1200, 120); this.tone('sine', 220, 40, 0.5, 0.3); return; }
    this.noise(0.12, 0.12, 'lowpass', 2600, 300); this.tone('sine', 420, 110, 0.12, 0.12);
  }
  appear(): void { if (this.ok('appear', 80)) this.tone('sine', 1100, 1500, 0.04, 0.03); }
  boom(): void { if (this.ok('boom', 60)) { this.noise(0.45, 0.32, 'lowpass', 900, 90); this.tone('sine', 100, 30, 0.4, 0.3); } }
  money(): void { if (this.ok('money', 35)) { this.tone('square', 1400, 1400, 0.04, 0.035); this.tone('square', 1900, 1900, 0.06, 0.035, 0.04); } }
  /** Placing a tower or upgrading: a chime whose pitch climbs with the level (like tower_buy0..9). */
  build(level: number): void {
    if (!this.ok('build', 0)) return;
    const f = 440 * Math.pow(2, level / 6);
    this.tone('square', f, f, 0.09, 0.07); this.tone('square', f * 1.5, f * 1.5, 0.12, 0.07, 0.07);
  }
  denied(): void { if (this.ok('denied', 150)) { this.tone('square', 150, 110, 0.16, 0.09); } }
  wave(): void { if (this.ok('wave', 100)) { this.tone('triangle', 330, 330, 0.08, 0.1); this.tone('triangle', 495, 495, 0.1, 0.1, 0.08); } }
  win(): void { if (this.ok('win', 0)) [523, 659, 784, 1047].forEach((f, i) => this.tone('square', f, f, 0.16, 0.09, i * 0.12)); }
  lose(): void { if (this.ok('lose', 0)) { this.noise(1.0, 0.35, 'lowpass', 700, 50); this.tone('sawtooth', 160, 35, 0.9, 0.18); } }
  click(): void { if (this.ok('click', 40)) this.tone('square', 1200, 900, 0.03, 0.05); }
}

export const sfx = new Sfx();
// the first user gesture unlocks audio
if (typeof addEventListener === 'function') for (const ev of ['pointerdown', 'keydown'] as const) addEventListener(ev, () => sfx.unlock(), { capture: true });
