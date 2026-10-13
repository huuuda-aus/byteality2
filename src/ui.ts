import { towerIcon } from './screens.ts';
import { MAX_LEVEL, campaign, towerInfo, type TowerInfo } from './data.ts';

export interface UiState {
  map: string;
  tool: 'eraser' | 'tower';
  towerKey: string | null; // tower picked in the toolbar (null = none)
  autoSpawn: number; // enemies per second (stress)
  eraserRadius: number;
  damageNumbers: boolean; // floating damage numbers
  allDamage: boolean; // ...also for beams, auras, fire and viruses
  hpMode: 'off' | 'near' | 'always'; // enemy hit point text
  freeBuild: boolean; // sandbox: all towers, unlimited, free (for testing); off = the level's tower quota and credits apply
}

export interface UiHandlers {
  onMap(name: string): void;
  onSpawn(n: number): void;
  onKillAll(): void;
  onNextWave(): void;
  onClearTowers(): void;
}

export function createUi(root: HTMLElement, state: UiState, h: UiHandlers) {
  root.innerHTML = '<h1>BYTEALITY REMAKE | MVP</h1>';
  const row = (label: string, el: HTMLElement) => {
    const l = document.createElement('label'); l.append(label, el); root.append(l); return el;
  };
  const select = (opts: [string, string][], value: string, on: (v: string) => void) => {
    const s = document.createElement('select');
    for (const [v, t] of opts) s.add(new Option(t, v, false, v === value));
    s.onchange = () => on(s.value); return s;
  };
  const button = (text: string, on: () => void) => { const b = document.createElement('button'); b.textContent = text; b.onclick = on; return b; };

  const mapSelect = row('map', select(campaign.map(([n], i) => [n, `${i + 1} ${n.replace(/_/g, ' ')}`] as [string, string]), state.map, (v) => { state.map = v; h.onMap(v); }));
  const toolSelect = row('tool', select([['tower', 'place tower'], ['eraser', 'eraser (hold LMB)']], state.tool, (v) => { state.tool = v as UiState['tool']; }));

  const rate = document.createElement('input'); rate.type = 'range'; rate.min = '0'; rate.max = '5000'; rate.step = '50'; rate.value = String(state.autoSpawn);
  const rateText = document.createElement('span'); rateText.textContent = String(state.autoSpawn);
  rate.oninput = () => { state.autoSpawn = Number(rate.value); rateText.textContent = rate.value; };
  const rl = document.createElement('label'); rl.append('auto spawn/s', rate, rateText); root.append(rl);

  const rad = document.createElement('input'); rad.type = 'range'; rad.min = '10'; rad.max = '120'; rad.value = String(state.eraserRadius);
  rad.oninput = () => { state.eraserRadius = Number(rad.value); };
  row('eraser size', rad);

  const dn = document.createElement('input'); dn.type = 'checkbox'; dn.checked = state.damageNumbers;
  dn.onchange = () => { state.damageNumbers = dn.checked; };
  row('damage numbers', dn);
  const ad = document.createElement('input'); ad.type = 'checkbox'; ad.checked = state.allDamage;
  ad.onchange = () => { state.allDamage = ad.checked; };
  row('...all damage types', ad);
  row('enemy HP text', select([['always', 'always'], ['near', 'near cursor'], ['off', 'off']], state.hpMode, (v) => { state.hpMode = v as UiState['hpMode']; }));

  const free = document.createElement('input'); free.type = 'checkbox'; free.checked = state.freeBuild;
  free.onchange = () => { state.freeBuild = free.checked; };
  row('sandbox (free, all towers)', free);

  const r1 = document.createElement('div'); r1.className = 'row';
  r1.append(button('+100', () => h.onSpawn(100)), button('+1k', () => h.onSpawn(1000)), button('+10k', () => h.onSpawn(10000)), button('kill all', h.onKillAll));
  const r2 = document.createElement('div'); r2.className = 'row';
  r2.append(button('start / next wave (space)', h.onNextWave), button('restart level', h.onClearTowers));
  root.append(r1, r2);

  const stats = document.createElement('div'); stats.id = 'stats'; root.append(stats);
  const help = document.createElement('div'); help.id = 'help';
  help.textContent = 'Pick a tower in the top bar, click to place. Right-click / Esc cancels. Eraser tool: hold LMB over enemies.';
  root.append(help);
  return {
    setStats(text: string) { stats.textContent = text; },
    /** Reflect a programmatic tool change in the dropdown. */
    syncTool() { (toolSelect as HTMLSelectElement).value = state.tool; },
    syncMap() { (mapSelect as HTMLSelectElement).value = state.map; },
  };
}

/** Top toolbar: one square per tower, drawn from its line model in the tower's colour. */
export function createToolbar(frame: HTMLElement, onSelect: (key: string | null) => void) {
  const bar = document.createElement('div'); bar.id = 'toolbar'; frame.append(bar);
  const buttons = new Map<string, HTMLButtonElement>();
  let selected: string | null = null;
  const entries = Object.entries(towerInfo).sort((a, b) => a[1].id - b[1].id);
  for (const [key, info] of entries) {
    const cv = towerIcon(key);
    const btn = document.createElement('button');
    btn.title = `${info.name} — cost ${info.cost[0]}, range ${info.range[0]}${info.range[1] !== info.range[0] ? '–' + info.range[1] : ''}`;
    const badge = document.createElement('span'); badge.className = 'n';
    btn.append(cv, badge);
    btn.onclick = (e) => { e.stopPropagation(); set(selected === key ? null : key, true); };
    buttons.set(key, btn); bar.append(btn);
  }
  function set(key: string | null, notify: boolean) {
    selected = key;
    for (const [k, b] of buttons) b.classList.toggle('sel', k === key);
    if (notify) onSelect(key);
  }
  /** show = tower belongs to this level; left = remaining quota (null = unlimited); afford = enough credits for level 1. */
  const lastState = new Map<string, string>();
  return {
    setSelected: (key: string | null) => set(key, false),
    update(state: (key: string) => { show: boolean; left: number | null; afford: boolean }) {
      for (const [k, b] of buttons) {
        const st = state(k), sig = `${st.show}|${st.left}|${st.afford}`;
        if (lastState.get(k) === sig) continue;
        lastState.set(k, sig);
        b.hidden = !st.show;
        b.classList.toggle('dim', st.left === 0 || !st.afford);
        (b.querySelector('.n') as HTMLElement).textContent = st.left === null ? '' : String(st.left);
      }
    },
    /** Size the squares so two rows always fit in the black strip above the playfield. */
    layout(canvasW: number, canvasH: number) {
      const strip = (canvasH * 75) / 480;
      const size = Math.max(22, Math.min(44, (canvasW - 12) / 15 - 4, (strip - 12) / 2 - 4));
      bar.style.setProperty('--tb', `${Math.floor(size)}px`);
    },
  };
}

export interface CardData { info: TowerInfo; level: number; upgradeCost: number | null; money: number; free: boolean; selected: boolean }

/** Selected-tower card (bottom-left of the playfield): current stats, next-level stats, upgrade button. */
export function createCard(frame: HTMLElement) {
  const card = document.createElement('div'); card.id = 'card'; card.hidden = true; frame.append(card);
  let last = '';
  card.addEventListener('pointerdown', (e) => e.stopPropagation());
  const fmt = (n: number) => n.toLocaleString('en-US');
  return {
    update(d: CardData | null) {
      if (!d) { card.hidden = true; last = ''; return; }
      const { info, level } = d, max = d.upgradeCost === null;
      const can = !max && (d.free || d.money >= d.upgradeCost!);
      const html = `<div class="t" style="color:rgb(${info.color.join(',')})">${info.name} <span>level ${level + 1}/${MAX_LEVEL + 1}</span></div>`
        + `<div class="r"><b>damage</b>${fmt(info.damage[level])}${max ? '' : ` <i>> ${fmt(info.damage[level + 1])}</i>`}</div>`
        + `<div class="r"><b>upgrade</b>${max ? '<i>max level</i>' : `<span class="${can ? 'cost' : 'cost no'}">${fmt(d.upgradeCost!)}</span>`}</div>`
        + (max ? '' : `<div class="hint">${d.selected ? 'click again to upgrade' : 'click to select'}</div>`);
      if (html !== last) { card.innerHTML = html; last = html; }
      card.classList.toggle('hover', !d.selected);
      card.hidden = false;
    },
  };
}


/** End-of-level overlay (building destroyed / level complete). */
export function createOverlay(frame: HTMLElement, h: { onRestart(): void; onMenu(): void; onNext(): void }) {
  const el = document.createElement('div'); el.id = 'overlay'; el.hidden = true; frame.append(el);
  el.addEventListener('pointerdown', (e) => e.stopPropagation());
  el.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest('button')?.dataset.action;
    if (a === 'restart') h.onRestart(); else if (a === 'menu') h.onMenu(); else if (a === 'next') h.onNext();
  });
  return {
    show(title: string, lines: string[], hasNext: boolean) {
      el.innerHTML = `<h2>${title}</h2>${lines.map((l) => `<p>${l}</p>`).join('')}<div class="b"><button data-action="restart">restart</button>${hasNext ? '<button data-action="next">next level ></button>' : ''}<button data-action="menu">level select</button></div>`;
      el.hidden = false;
    },
    hide() { el.hidden = true; },
  };
}

export interface HudData { credits: number; timeLeft: number | null; totalTime: number; wave: number; waveName: string; waveRgb: [number, number, number]; waveIn: number | null; kills: number; goal: number | null }

/** Top-right HUD: level timer, wave number + countdown, kills against the level's goal. */
export function createHud(frame: HTMLElement, onNextWave: () => void, getSize: () => { w: number; h: number }, onScale: (px: number) => void = () => {}) {
  const el = document.createElement('div'); el.id = 'hud'; frame.append(el);
  el.addEventListener('pointerdown', (e) => e.stopPropagation());
  el.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('button')) onNextWave(); });
  let last = '', lastCredits = -1, pulseTimer = 0, scale = 0;
  /** Largest scale (<= 2, in steps of 0.25) at which the HUD still fits inside the black strip above the field and uses at most ~45% of its width. */
  const layout = () => {
    const { w, h } = getSize(); if (!w || !el.offsetHeight) return;
    const strip = (h * 75) / 480;
    const fit = Math.min(2, (strip - 8) / el.offsetHeight, (w * 0.45) / el.offsetWidth);
    const s = Math.max(0.75, Math.floor(fit * 4) / 4);
    if (s !== scale) { scale = s; el.style.transform = `scale(${s})`; onScale(8 + el.offsetWidth * s + 12); }
  };
  const clock = (s: number) => { const t = Math.max(0, Math.ceil(s)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
  return {
    update(d: HudData) {
      const reached = d.goal !== null && d.kills >= d.goal;
      const html =
        `<div class="row cr"><small>CREDITS</small><b>${Math.floor(d.credits).toLocaleString('en-US')}</b></div>`
        + `<div class="row"><small>TIME</small><b class="${d.timeLeft === null ? 'dim' : ''}">${clock(d.timeLeft ?? d.totalTime)}</b></div>`
        + `<div class="row"><small>WAVE</small>${d.wave === 0
          ? '<span class="dim">press SPACE</span>'
          : `<span><i style="color:rgb(${d.waveRgb.map((v) => Math.round(v * 255)).join(',')})">${d.wave} ${d.waveName}</i></span><b>${d.waveIn === null ? '' : clock(d.waveIn)}</b>`}</div>`
        + `<div class="row"><small>KILLS</small><b class="${reached ? 'ok' : ''}">${d.kills.toLocaleString('en-US')}${d.goal !== null ? ` <u>/ ${d.goal.toLocaleString('en-US')}</u>` : ''}</b></div>`
        + `<button>${d.wave === 0 ? '> START WAVE' : 'NEXT WAVE'} (SPACE)</button>`;
      if (html !== last) { el.innerHTML = html; last = html; }
      layout();
      if (Math.floor(d.credits) > lastCredits && lastCredits >= 0) { // a flying number just arrived
        el.classList.add('pulse'); window.clearTimeout(pulseTimer); pulseTimer = window.setTimeout(() => el.classList.remove('pulse'), 160);
      }
      lastCredits = Math.floor(d.credits);
    },
    layout,
    /** Credits flash red: an upgrade was attempted without enough credits. */
    flashCredits() {
      const b = el.querySelector('.cr b'); if (!b) return;
      b.classList.remove('deny'); void (b as HTMLElement).offsetWidth; b.classList.add('deny');
    },
    /** Centre of the credits value, as a point in client pixels (the flying money's destination). */
    creditsPoint(): { x: number; y: number } | null {
      const b = el.querySelector('.cr b')?.getBoundingClientRect();
      return b ? { x: b.left + b.width / 2, y: b.top + b.height / 2 } : null;
    },
  };
}
