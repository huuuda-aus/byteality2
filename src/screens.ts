import { MapData, campaign, mapsByName, models, towerInfo } from './data.ts';
import { ACHIEVEMENTS } from './achievements.ts';
import { save } from './save.ts';
import { ROW_SIZE, requiredKills, rowCount, rowMaps, statusOf, totalKills, unlockedRows } from './progress.ts';

/** A tower drawn from its line model in its colour, onto a fresh canvas. */
export function towerIcon(key: string, S = 88, lineWidth = 1.5): HTMLCanvasElement {
  const info = towerInfo[key], seg = models.towers[key];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < seg.length; i += 2) { minX = Math.min(minX, seg[i]); maxX = Math.max(maxX, seg[i]); minY = Math.min(minY, seg[i + 1]); maxY = Math.max(maxY, seg[i + 1]); }
  const scale = (S * 0.68) / Math.max(maxX - minX, maxY - minY, 1);
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const ctx = cv.getContext('2d')!;
  ctx.strokeStyle = `rgb(${info.color.join(',')})`; ctx.lineWidth = lineWidth; ctx.lineCap = 'round';
  ctx.beginPath();
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  for (let i = 0; i < seg.length; i += 4) {
    ctx.moveTo(S / 2 + (seg[i] - cx) * scale, S / 2 + (seg[i + 1] - cy) * scale);
    ctx.lineTo(S / 2 + (seg[i + 2] - cx) * scale, S / 2 + (seg[i + 3] - cy) * scale);
  }
  ctx.stroke();
  return cv;
}

/** Thumbnail of a map: path, sources (blue), sinks (red), buildings (yellow squares). */
export function drawMapPreview(cv: HTMLCanvasElement, map: MapData): void {
  const ctx = cv.getContext('2d')!, W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);
  const s = Math.min(W / 640, H / 340), ox = (W - 640 * s) / 2, oy = (H - 340 * s) / 2 - 70 * s;
  const X = (x: number) => ox + x * s, Y = (y: number) => oy + y * s;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#8c97ab'; ctx.lineWidth = Math.max(2, 8 * s);
  ctx.beginPath();
  for (const [b, e] of map.edges) { const A = map.nodes[b - 1], B = map.nodes[e - 1]; ctx.moveTo(X(A[0]), Y(A[1])); ctx.lineTo(X(B[0]), Y(B[1])); }
  ctx.stroke();
  ctx.strokeStyle = '#0b0f1c'; ctx.lineWidth = Math.max(1, 4 * s); ctx.stroke(); // hollow tube look
  for (const [x, y, v] of map.nodes) {
    if (v !== 0 && v !== 100) continue;
    ctx.fillStyle = v === 0 ? '#3366ff' : '#ff2020'; ctx.beginPath(); ctx.arc(X(x), Y(y), Math.max(2.5, 6 * s), 0, 7); ctx.fill();
  }
  ctx.strokeStyle = '#ffcc00'; ctx.lineWidth = 1.2;
  for (const [x, y] of map.buildings) { const h = Math.max(3, 26 * s); ctx.strokeRect(X(x) - h, Y(y) - h, h * 2, h * 2); }
}

const mmss = (steps: number) => { const t = Math.round(steps / 60); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
const title = (name: string) => name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export function createTitle(frame: HTMLElement, onStart: () => void, onAchievements: () => void) {
  const el = document.createElement('div'); el.className = 'screen'; el.id = 'title'; el.hidden = true; frame.append(el);
  const icons = (keys: string[]) => `<div class="icons">${keys.map((k, i) => `<span style="animation-delay:${-i * 1.7}s"></span>`).join('')}</div>`;
  el.innerHTML = `${icons(['tGun', 'tRifle', 'tMinigun', 'tMine', 'tTime'])}<h1>ByteAlity <em>Tower Defense</em></h1><p class="sub">remake</p>
    <button class="big" id="start">Start game</button><button class="small" id="ach">Achievements</button>
    <p class="credit">Based on <b>ByteAlity Tower Defense</b> by Erik Leppen (2008)</p>${icons(['tLightning', 'tNail', 'tBomb', 'tSonic', 'tStinger'])}`;
  const keysTop = ['tGun', 'tRifle', 'tMinigun', 'tMine', 'tTime'], keysBottom = ['tLightning', 'tNail', 'tBomb', 'tSonic', 'tStinger'];
  [...el.querySelectorAll('.icons')].forEach((row, r) => [...row.children].forEach((slot, i) => slot.append(towerIcon((r ? keysBottom : keysTop)[i], 48, 1.2))));
  (el.querySelector('#start') as HTMLElement).onclick = onStart;
  (el.querySelector('#ach') as HTMLElement).onclick = onAchievements;
  return { show() { el.hidden = false; }, hide() { el.hidden = true; } };
}

export interface LevelSelectCallbacks { onPlay(name: string): void; onBack(): void; onReset(): void; onUnlockAll(): void; onAchievements(): void }

/** Level picker: rows of ROW_SIZE maps; a row is locked until the total kills reach the goals of all earlier rows. */
export function createLevelSelect(frame: HTMLElement, cb: LevelSelectCallbacks) {
  const el = document.createElement('div'); el.className = 'screen'; el.id = 'levels'; el.hidden = true; frame.append(el);
  const previews = new Map<string, HTMLCanvasElement>(); // thumbnails are drawn once
  const preview = (name: string) => {
    let c = previews.get(name);
    if (!c) { c = document.createElement('canvas'); c.width = 240; c.height = 130; drawMapPreview(c, mapsByName[name]); previews.set(name, c); }
    const copy = document.createElement('canvas'); copy.width = c.width; copy.height = c.height; copy.getContext('2d')!.drawImage(c, 0, 0);
    return copy;
  };
  function render(best: Record<string, number>) {
    const open = unlockedRows(best), total = totalKills(best);
    const next = open < rowCount ? requiredKills(open) : null;
    el.innerHTML = `<div class="bar"><button id="back">&lt; back</button><h2>Select level</h2>
      <div class="kills">total kills <b>${total.toLocaleString('en-US')}</b>${next !== null ? ` | next row at <b>${next.toLocaleString('en-US')}</b>` : ' | all rows unlocked'}</div></div>
      <div class="rows"></div>
      <div class="foot"><button id="achBtn">achievements</button><button id="reset">reset progress</button><button id="unlock">unlock all (debug)</button></div>`;
    (el.querySelector('#back') as HTMLElement).onclick = cb.onBack;
    (el.querySelector('#achBtn') as HTMLElement).onclick = cb.onAchievements;
    (el.querySelector('#reset') as HTMLElement).onclick = () => { if (confirm('Reset all level scores?')) cb.onReset(); };
    (el.querySelector('#unlock') as HTMLElement).onclick = cb.onUnlockAll;
    const rows = el.querySelector('.rows')!;
    for (let r = 0; r < rowCount; r++) {
      const locked = r >= open, row = document.createElement('div'); row.className = 'row' + (locked ? ' locked' : '');
      if (locked) row.insertAdjacentHTML('beforeend', `<div class="need">LOCKED - needs ${requiredKills(r).toLocaleString('en-US')} total kills</div>`);
      for (const [name, goal] of rowMaps(r)) {
        const index = campaign.findIndex(([n]) => n === name) + 1, kills = best[name], st = statusOf(kills, goal);
        const card = document.createElement('button'); card.className = `card ${st}`; card.disabled = locked;
        card.innerHTML = `<span class="no">${index}</span><span class="st" title="${st}"></span><span class="nm">${title(name)}</span>
          <span class="meta">${kills && kills > 1 ? `best ${kills.toLocaleString('en-US')}` : st === 'failed' ? 'failed' : 'not played'} / goal ${goal.toLocaleString('en-US')} | ${mmss(mapsByName[name].steps)}</span>`;
        card.prepend(preview(name));
        card.onclick = () => cb.onPlay(name);
        row.append(card);
      }
      rows.append(row);
    }
  }
  return {
    show(best: Record<string, number>) { render(best); el.hidden = false; },
    hide() { el.hidden = true; },
    ROW_SIZE,
  };
}

/** Achievement list: unlocked ones show their date, locked ones show what to do. */
export function createAchievements(frame: HTMLElement, onBack: () => void) {
  const el = document.createElement('div'); el.className = 'screen'; el.id = 'achievements'; el.hidden = true; frame.append(el);
  return {
    show() {
      const got = ACHIEVEMENTS.filter((a) => a.id in save.data.achievements).length;
      el.innerHTML = `<div class="bar"><button id="back">&lt; back</button><h2>Achievements</h2><div class="kills"><b>${got}</b> / ${ACHIEVEMENTS.length}</div></div>
        <div class="list">${ACHIEVEMENTS.map((a) => {
          const t = save.data.achievements[a.id];
          return `<div class="ach ${t ? 'got' : ''}"><span class="mark">${t ? 'X' : ''}</span><div><b>${a.title}</b><small>${a.desc}${t ? ` | ${new Date(t).toLocaleDateString()}` : ''}</small></div></div>`;
        }).join('')}</div>
        <div class="stats">kills ${save.data.stats.kills.toLocaleString('en-US')} | towers built ${save.data.stats.towersBuilt.toLocaleString('en-US')} | upgrades ${save.data.stats.upgrades.toLocaleString('en-US')} | levels won ${save.data.stats.wins.toLocaleString('en-US')}</div>`;
      (el.querySelector('#back') as HTMLElement).onclick = onBack;
      el.hidden = false;
    },
    hide() { el.hidden = true; },
  };
}

/** Small pop-up notices ("Achievement unlocked"). */
export function createToaster(frame: HTMLElement) {
  const box = document.createElement('div'); box.id = 'toasts'; frame.append(box);
  return { show(title: string, desc: string) {
    const t = document.createElement('div'); t.className = 'toast'; t.innerHTML = `<small>ACHIEVEMENT UNLOCKED</small><b>${title}</b><span>${desc}</span>`;
    box.append(t); window.setTimeout(() => t.remove(), 4500);
  } };
}
