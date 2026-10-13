import * as THREE from 'three';
import { DynamicLines } from './dynLines.ts';
import { PixelText } from './pixelText.ts';

type RGB = [number, number, number];
/** Size of one font pixel (field px) for damage numbers and HP text, which use the tiny 3x5 font (5 px tall). */
const SMALL_PX = 1;
const fmt = (n: number) => String(Math.floor(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); // original string_1000: 1234 -> "1.234"

/**
 * Floating damage numbers (damageparticles): the number drifts along the hit direction at half the bullet speed,
 * decelerating to a stop; it lives 55-65 steps and fades over the second half.
 */
export class FloatingNumbers {
  enabled = true;
  all = false; // also show damage from beams, auras, fire, viruses... (original "alldamageparticles")
  private n = 0;
  private x: Float32Array; private y: Float32Array; private dx: Float32Array; private dy: Float32Array;
  private speed: Float32Array; private decel: Float32Array; private age: Int32Array; private life: Int32Array; private col: Float32Array;
  private text: string[] = [];
  private pix = new PixelText(8000);
  readonly mesh = this.pix.mesh;

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
    this.pix.begin();
    for (let i = 0; i < this.n; i++) {
      const t = this.age[i] / this.life[i], a = t < 0.5 ? 1 : 2 * (1 - t); // alpha3(1, 1, 0)
      this.pix.text(this.text[i], Math.round(this.x[i]), Math.round(this.y[i]), SMALL_PX, this.col[3 * i], this.col[3 * i + 1], this.col[3 * i + 2], a, 'center', 1);
    }
    this.pix.end();
  }
}

/** Enemy hit point readouts (original enemy Draw): number right-aligned at (x-3, y+3), enemy colour. */
export class HpText {
  mode: 'off' | 'near' | 'always' = 'always';
  private boxes = new DynamicLines(4000);
  private pix = new PixelText(30000);
  readonly mesh = new THREE.Group().add(this.boxes.mesh, this.pix.mesh);
  static readonly MAX_ENEMIES_DRAWN = 3000; // keeps thousands of enemies readable and fast

  render(sim: { n: number; x: Float32Array; y: Float32Array; hp: Float32Array; col: Float32Array; selected: Uint8Array },
         pointer: { x: number; y: number; inside: boolean }): void {
    this.boxes.begin(); this.pix.begin();
    const n = Math.min(sim.n, HpText.MAX_ENEMIES_DRAWN);
    for (let i = 0; i < sim.n; i++) {
      const sel = sim.selected[i] === 1;
      if (sel) this.boxes.rect(sim.x[i], sim.y[i], 8, sim.col[3 * i], sim.col[3 * i + 1], sim.col[3 * i + 2], 1); // selection box
      let a = 0;
      if (sel || (this.mode === 'always' && i < n)) a = 1;
      else if (this.mode !== 'off' && pointer.inside) { const d = Math.hypot(sim.x[i] - pointer.x, sim.y[i] - pointer.y); if (d < 50) a = 1 - 0.02 * d; }
      if (a <= 0) continue;
      this.pix.text(fmt(Math.max(1, Math.ceil(sim.hp[i]))), Math.round(sim.x[i] - 3), Math.round(sim.y[i] + 3 + 2.5), SMALL_PX, sim.col[3 * i], sim.col[3 * i + 1], sim.col[3 * i + 2], a, 'right', 1);
    }
    this.boxes.end(); this.pix.end();
  }
}

/**
 * Flying money (moneyparticles / moneynumber): every kill launches its value as a number that flies in a straight line to the credits
 * counter, flickering between two colours, and is only credited when it arrives (after 40 + ceil(3*sqrt(value)) steps).
 */
export class MoneyNumbers {
  private list: { x: number; y: number; vx: number; vy: number; age: number; life: number; value: number; big: boolean }[] = [];
  private pix = new PixelText(12000);
  readonly mesh = this.pix.mesh;
  static readonly MAX = 1500;

  /** Returns false when too many are in flight; the caller then pays out immediately. */
  spawn(x: number, y: number, value: number, target: { x: number; y: number }, big = false): boolean {
    if (this.list.length >= MoneyNumbers.MAX) return false;
    const life = 40 + Math.ceil(3 * Math.sqrt(value));
    this.list.push({ x, y, vx: (target.x - x) / life, vy: (target.y - y) / life, age: 0, life, value, big });
    return true;
  }

  step(onArrive: (value: number) => void): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const m = this.list[i]; m.x += m.vx; m.y += m.vy;
      if (++m.age >= m.life) { onArrive(m.value); this.list.splice(i, 1); }
    }
  }

  clear(): void { this.list.length = 0; }

  render(): void {
    this.pix.begin();
    for (const m of this.list) {
      const light = (m.life - m.age) % 12 < 6; // original: alarm mod 12 < 6 swaps to colour 2
      const c: RGB = light ? [1, 1, 0.6] : [0, 0.2, 0.4];
      this.pix.text(fmt(m.value), Math.round(m.x), Math.round(m.y), m.big ? 2 : 1, c[0], c[1], c[2], 1, 'center', 0);
    }
    this.pix.end();
  }
}
