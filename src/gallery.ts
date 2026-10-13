import '@fontsource/press-start-2p/index.css';
import { drawMapPreview } from './screens.ts';
import type { MapData } from './data.ts';

type GMap = MapData & { style: string; bot?: { survived: boolean; kills: number; minHpFrac: number; wavesReached: number; towers: number } };
interface Rep { errors: string[]; warnings: string[]; m: Record<string, number> }
interface Batch { seed: number; maps: Record<string, GMap>; reports: Record<string, Rep>; tally: Record<string, { tried: number; ok: number; why: Record<string, number> }> }

const KEPT = 'byteality.kept', PLAY = 'byteality.play';
const loadKept = (): Record<string, GMap> => { try { return JSON.parse(localStorage.getItem(KEPT) ?? '{}'); } catch { return {}; } };
const saveKept = (k: Record<string, GMap>) => localStorage.setItem(KEPT, JSON.stringify(k));
let kept = loadKept();
const $ = (id: string) => document.getElementById(id)!;

function play(name: string, map: GMap) {
  localStorage.setItem(PLAY, JSON.stringify({ name, map }));
  window.open('/?play=1', '_blank'); // the game reads the level from localStorage
}

function card(name: string, map: GMap, rep: Rep | null, isKept: boolean): HTMLElement {
  const el = document.createElement('div'); el.className = 'card' + (isKept ? ' kept' : '');
  const cv = document.createElement('canvas'); cv.width = 320; cv.height = 180; drawMapPreview(cv, map);
  el.append(cv);
  const m = rep?.m;
  el.insertAdjacentHTML('beforeend', `<div><b>${name}</b></div>
    <div class="row">${map.nodes.length} nodes | ${map.buildings.length} bldg | time ${Math.floor(map.steps / 3600)}:${String(Math.round(map.steps / 60) % 60).padStart(2, '0')}${m ? (m.arena ? ` | ARENA (no exit) | coverage ${(m.coverage * 100).toFixed(0)}%` : ` | route ${m.routeMean} px | coverage ${(m.coverage * 100).toFixed(0)}%`) : ''}</div>
    <div class="row">goal <b>${map.goal ?? '-'}</b> kills | credits ${map.money} | enemy hp x${map.hp_mult}</div>
    ${map.bot ? `<div class="row">bot: ${map.bot.kills} kills, wave ${map.bot.wavesReached}, building min ${(map.bot.minHpFrac * 100).toFixed(0)}%, ${map.bot.towers} towers</div>` : ''}
    <div class="row">kit ${[...new Set(map.towers)].join(', ')}</div>
    ${(rep?.warnings ?? []).map((w) => `<div class="warn">! ${w}</div>`).join('')}`);
  const bar = document.createElement('div'); bar.className = 'btns';
  const playBtn = Object.assign(document.createElement('button'), { textContent: 'play' });
  playBtn.onclick = () => play(name, map);
  const keepBtn = Object.assign(document.createElement('button'), { textContent: isKept ? 'remove' : (name in kept ? 'kept' : 'keep') });
  keepBtn.onclick = () => { if (isKept || name in kept) delete kept[name]; else kept[name] = map; saveKept(kept); renderKept(); renderBatch(); };
  bar.append(playBtn, keepBtn); el.append(bar);
  return el;
}

function renderKept() {
  const names = Object.keys(kept);
  $('kept').innerHTML = '';
  $('keptTitle').textContent = `Kept levels (${names.length})`;
  for (const n of names) $('kept').append(card(n, kept[n], null, true));
  ($('export') as HTMLButtonElement).disabled = !names.length;
}

let batch: Batch | null = null;
function renderBatch() {
  if (!batch) return;
  $('meta').textContent = `seed ${batch.seed} | ${Object.keys(batch.maps).length} levels accepted by the validator`;
  $('tally').innerHTML = Object.entries(batch.tally).map(([style, t]) =>
    `<div><b>${style}</b>: ${t.ok}/${t.tried} candidates accepted${Object.keys(t.why).length ? ' | rejected for: ' + Object.entries(t.why).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${v}x ${k}`).join(', ') : ''}</div>`).join('');
  $('grid').innerHTML = '';
  for (const [name, map] of Object.entries(batch.maps)) $('grid').append(card(name, map, batch.reports[name], false));
}

async function loadBatch() {
  const res = await fetch(`/generated/maps.json?t=${Date.now()}`);
  if (!res.ok) { $('meta').textContent = 'no batch yet: press "new batch"'; return; }
  batch = (await res.json()) as Batch; renderBatch();
}

($('new') as HTMLButtonElement).onclick = async () => {
  const btn = $('new') as HTMLButtonElement, rnd = $('random') as HTMLButtonElement;
  const seed = Number(($('seed') as HTMLInputElement).value) || Math.floor(Math.random() * 1e6), count = Number(($('count') as HTMLInputElement).value) || 30;
  const calibrate = ($('calibrate') as HTMLInputElement).checked;
  ($('seed') as HTMLInputElement).value = String(seed);
  btn.disabled = rnd.disabled = true;
  batch = null; $('grid').innerHTML = ''; $('tally').innerHTML = ''; // wipe the previous batch straight away
  const t0 = Date.now(), tick = window.setInterval(() => { $('meta').textContent = `generating ${count} levels (seed ${seed})${calibrate ? ', play-testing each with the bot' : ''}... ${Math.round((Date.now() - t0) / 1000)} s`; }, 250);
  btn.textContent = 'generating...';
  try {
    const res = await fetch(`/__generate?seed=${seed}&count=${count}&calibrate=${calibrate ? 'on' : 'off'}`);
    let r: { ok: boolean; log: string } | null = null;
    try { r = await res.json(); } catch { /* not JSON: the dev server has no generator endpoint */ }
    if (!r) throw new Error('The generator endpoint is not available. Restart the dev server (npm run dev) and try again, or run: npm run levels -- --count 30 --seed ' + seed);
    if (!r.ok) throw new Error(r.log);
    await loadBatch();
  } catch (e) {
    $('meta').textContent = 'generation failed: ' + (e as Error).message;
  } finally { window.clearInterval(tick); btn.disabled = rnd.disabled = false; btn.textContent = 'new batch'; }
};
$('random').onclick = () => { ($('seed') as HTMLInputElement).value = String(Math.floor(Math.random() * 1e6)); ($('new') as HTMLButtonElement).click(); };
$('export').onclick = () => {
  const blob = new Blob([JSON.stringify({ maps: kept }, null, 1)], { type: 'application/json' });
  Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'kept-levels.json' }).click();
};

renderKept();
void loadBatch();
$('importHint').textContent = 'Kept levels appear in the game under Level select > Generated levels (same browser). To use them elsewhere: export, then import the file there, or save it as assets/generated-levels.json to ship it with the game.';
