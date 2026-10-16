import * as THREE from 'three';
import { GlyphText } from './glyphText.ts';

type RGB = [number, number, number];
const fmt = (n: number) => String(Math.floor(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); // original string_1000: 1234 -> "1.234"

/**
 * Floating damage numbers (damageparticles): the number drifts along the hit direction at half the bullet speed,
 * decelerating to a stop, while rising a little; it lives 55-65 steps and fades over the second half.
 */
export class FloatingNumbers {
  enabled = true;
  all = false; // also show damage from beams, auras, fire, viruses... (original "alldamageparticles")
  private n = 0;
  private x: Float32Array; private y: Float32Array; private dx: Float32Array; private dy: Float32Array;
  private speed: Float32Array; private decel: Float32Array; private age: Int32Array; private life: Int32Array; private col: Float32Array;
  private text: string[] = [];
  private glyphs = new GlyphText(8000);
  readonly mesh = this.glyphs.mesh;

  constructor(private cap = 2000) {
    const f = (c: number) => new Float32Array(c);
    this.x = f(cap); this.y = f(cap); this.dx = f(cap); this.dy = f(cap); this.speed = f(cap); this.decel = f(cap); this.col = f(cap * 3);
    this.age = new Int32Array(cap); this.life = new Int32Array(cap);
  }

  /** onlyWithAll: effects the original shows only when "all damage particles" is on. */
  add(x: number, y: number, value: number, speed: number, dirRad: number, rgb: RGB, onlyWithAll = false): void {
    if (!this.enabled || (onlyWithAll && !this.all) || !(value >= 1) || this.n >= this.cap) return;
    let s = speed, d = dirRad;
    if (s < 0.2) { s = 2 + Math.random() * 3; d = Math.random() * Math.PI * 2; }
    const i = this.n++;
    this.x[i] = x; this.y[i] = y; this.dx[i] = Math.cos(d); this.dy[i] = Math.sin(d);
    this.speed[i] = s / 2; this.decel[i] = 0.05 + s / 50; this.age[i] = 0; this.life[i] = 55 + Math.floor(Math.random() * 11);
    this.col[3 * i] = rgb[0]; this.col[3 * i + 1] = rgb[1]; this.col[3 * i + 2] = rgb[2];
    this.text[i] = fmt(value);
  }

  step(): void {
    for (let i = this.n - 1; i >= 0; i--) {
      this.x[i] += this.dx[i] * this.speed[i]; this.y[i] += this.dy[i] * this.speed[i];
      this.speed[i] = Math.max(0, this.speed[i] - this.decel[i]);
      if (++this.age[i] >= this.life[i]) {
        const l = --this.n;
        if (i !== l) {
          this.x[i] = this.x[l]; this.y[i] = this.y[l]; this.dx[i] = this.dx[l]; this.dy[i] = this.dy[l]; this.speed[i] = this.speed[l];
          this.decel[i] = this.decel[l]; this.age[i] = this.age[l]; this.life[i] = this.life[l]; this.text[i] = this.text[l];
          for (let k = 0; k < 3; k++) this.col[3 * i + k] = this.col[3 * l + k];
        }
      }
    }
  }

  clear(): void { this.n = 0; }

  render(): void {
    this.glyphs.begin();
    for (let i = 0; i < this.n; i++) {
      const t = this.age[i] / this.life[i], a = t < 0.5 ? 1 : 2 * (1 - t);
      this.glyphs.text(this.text[i], this.x[i], 14 + this.age[i] * 0.22, this.y[i], 7, this.col[3 * i], this.col[3 * i + 1], this.col[3 * i + 2], a, 'center');
    }
    this.glyphs.end();
  }
}

/** Enemy hit point readouts under each enemy. */
export class HpText {
  mode: 'off' | 'near' | 'always' = 'always';
  private glyphs = new GlyphText(30000);
  readonly mesh = this.glyphs.mesh;
  static readonly MAX_ENEMIES_DRAWN = 1500; // keeps thousands of enemies readable and fast

  render(sim: { n: number; x: Float32Array; y: Float32Array; hp: Float32Array; col: Float32Array; selected: Uint8Array },
         pointer: { x: number; y: number; inside: boolean }): void {
    this.glyphs.begin();
    const n = Math.min(sim.n, HpText.MAX_ENEMIES_DRAWN);
    for (let i = 0; i < sim.n; i++) {
      const sel = sim.selected[i] === 1;
      let a = 0;
      if (sel || (this.mode === 'always' && i < n)) a = 1;
      else if (this.mode !== 'off' && pointer.inside) { const d = Math.hypot(sim.x[i] - pointer.x, sim.y[i] - pointer.y); if (d < 50) a = 1 - 0.02 * d; }
      if (a <= 0) continue;
      const r = 0.55 + 0.45 * sim.col[3 * i], g = 0.55 + 0.45 * sim.col[3 * i + 1], b = 0.55 + 0.45 * sim.col[3 * i + 2];
      this.glyphs.text(fmt(Math.max(1, Math.ceil(sim.hp[i]))), sim.x[i], 9, sim.y[i], 4.6, r, g, b, a, 'center', 0, -2);
    }
    this.glyphs.end();
  }
}

/**
 * Flying money: every kill launches its value as a number that flies in a straight line to the credits counter, flickering between two
 * colours, and is only credited when it arrives (after 40 + ceil(3*sqrt(value)) steps).
 */
export class MoneyNumbers {
  private list: { p: THREE.Vector3; v: THREE.Vector3; age: number; life: number; value: number; big: boolean }[] = [];
  private glyphs = new GlyphText(12000);
  readonly mesh = this.glyphs.mesh;
  static readonly MAX = 1500;

  /** start/target are world positions (the target is the credits counter projected into the scene). Returns false when too many are in flight. */
  spawn(start: THREE.Vector3, value: number, target: THREE.Vector3, big = false): boolean {
    if (this.list.length >= MoneyNumbers.MAX) return false;
    const life = 40 + Math.ceil(3 * Math.sqrt(value));
    this.list.push({ p: start.clone(), v: target.clone().sub(start).divideScalar(life), age: 0, life, value, big });
    return true;
  }

  step(onArrive: (value: number) => void): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const m = this.list[i]; m.p.add(m.v);
      if (++m.age >= m.life) { onArrive(m.value); this.list.splice(i, 1); }
    }
  }

  clear(): void { this.list.length = 0; }

  render(): void {
    this.glyphs.begin();
    for (const m of this.list) {
      const light = (m.life - m.age) % 12 < 6;
      const c: RGB = light ? [1, 0.93, 0.45] : [0.4, 0.75, 1];
      this.glyphs.text(fmt(m.value), m.p.x, m.p.y, m.p.z, m.big ? 13 : 9, c[0], c[1], c[2], 1, 'center');
    }
    this.glyphs.end();
  }
}
