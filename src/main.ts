import '@fontsource/fredoka/400.css';
import '@fontsource/fredoka/600.css';
import * as THREE from 'three';
import { View3D } from './view3d.ts';
import { EnemyBalls, HpBars } from './enemyBalls.ts';
import { buildTerrain, type Terrain } from './terrain.ts';
import { FIELD_H, FIELD_W, ENEMY_NAMES, ENEMY_SCALE, campaign, mapsByName, models, towerInfo } from './data.ts';
import { buildGraph, type Graph } from './graph.ts';
import { EnemySim } from './enemies.ts';
import { LineModelBatch } from './lineBatch.ts';
import { FragmentSystem } from './fragments.ts';
import { TowerLayer } from './towers.ts';
import { BulletSystem } from './bullets.ts';
import { Effects } from './effects.ts';
import { type CombatCtx } from './combat.ts';
import { WAVE_COLORS, WAVE_TYPE_NAMES, WaveRunner, buildWaves } from './waves.ts';
import { createTitle, createLevelSelect, createAchievements, createToaster, type CustomEntry } from './screens.ts';
import { importLevels, loadCustom, removeMine } from './generated.ts';
import { ROW_SIZE, unlockedRows } from './progress.ts';
import { save } from './save.ts';
import { sfx } from './audio.ts';
import { checkAchievements, type Achievement } from './achievements.ts';
import { createCard, createHud, createOverlay, createToolbar, createUi, type UiState } from './ui.ts';
import { Buildings } from './buildings.ts';
import { FloatingNumbers, HpText, MoneyNumbers } from './numbers.ts';
import { distanceFromNetwork } from './graph.ts';
import { Kind } from './bullets.ts';

const STEP = 1 / 60;
const MAX_ENEMIES = 30000;

// ---- 3D view: orthographic, isometric-ish; field (x, y) lives on the ground plane at world (x, 0, y) ----
const TOP_INSET = 104; // px reserved for the top bar
const stage = document.getElementById('stage')!;
const frameEl = document.createElement('div'); frameEl.id = 'frame';
stage.append(frameEl);
const view = new View3D(frameEl);
const renderer = view.renderer, scene = view.scene;
let toolbar: ReturnType<typeof createToolbar> | null = null;
let hudLayout: (() => void) | null = null;
function resize() { view.resize(TOP_INSET); hudLayout?.(); }
addEventListener('resize', resize); resize();

// ---- game state, rebuilt on map change ----
const params = new URLSearchParams(location.search);
// a level picked in the generator gallery is handed over through localStorage (?play=1)
let playName: string | null = null;
if (params.has('play')) {
  try { const p = JSON.parse(localStorage.getItem('byteality.play') ?? 'null') as { name: string; map: (typeof mapsByName)[string] } | null; if (p?.map?.nodes) { mapsByName[p.name] = p.map; playName = p.name; } } catch { /* ignore a bad hand-over */ }
}
const campaignNames = new Set(campaign.map(([n]) => n));
/** Generated levels (shipped pack + kept/imported) with the player's best scores; their maps are registered so the game can start them. */
function customEntries(): CustomEntry[] {
  const list = loadCustom();
  for (const l of list) mapsByName[l.name] = l.map;
  return list.map((l) => ({ ...l, best: save.data.custom[l.name]?.best }));
}
customEntries();
const state: UiState = {
  map: playName ?? (params.get('map') && mapsByName[params.get('map')!] ? params.get('map')! : campaign[0][0]), // level 1
  tool: 'tower', towerKey: null, autoSpawn: 0, eraserRadius: 40, freeBuild: false,
  damageNumbers: save.data.settings.damageNumbers, allDamage: save.data.settings.allDamage, hpMode: save.data.settings.hpMode,
};


const numbers = new FloatingNumbers();
const hpText = new HpText();
const moneyNums = new MoneyNumbers();
const colorOf = (key: string): [number, number, number] => [towerInfo[key].color[0] / 255, towerInfo[key].color[1] / 255, towerInfo[key].color[2] / 255];
const fragments = new FragmentSystem(Number(params.get('frag')) || 262144); // ?frag=20000 helps software-GL testing
let world: THREE.Group | null = null;
let terrain: Terrain;
let graph: Graph, sim: EnemySim, towers: TowerLayer, waveRunner: WaveRunner, bullets: BulletSystem, fx: Effects, combat: CombatCtx;
let hpBars: HpBars;
let buildings: Buildings;
let phase: 'playing' | 'over' | 'won' = 'playing';
let levelSteps = 0; // steps since the first wave was called; the level lasts map.steps
let levelMap = mapsByName[state.map];
let enemyBatches: LineModelBatch[] = [];
let enemyBalls: EnemyBalls;
let kills = 0;
let money = 0;
let levelTowers = new Set<string>();
let quota: Record<string, number> = {}; // towers still placeable on this level (original: quotum[])
const keyByName = Object.fromEntries(Object.entries(towerInfo).map(([k, t]) => [t.name.toLowerCase(), k]));

/** Enemy model without its outline circle (short chords on the outer radius): only the type symbol remains. */
function symbolOnly(seg: ArrayLike<number>): number[] {
  let R = 0; for (let i = 0; i < seg.length; i += 2) R = Math.max(R, Math.hypot(seg[i], seg[i + 1]));
  const out: number[] = [];
  for (let i = 0; i < seg.length; i += 4) {
    const r1 = Math.hypot(seg[i], seg[i + 1]), r2 = Math.hypot(seg[i + 2], seg[i + 3]), len = Math.hypot(seg[i + 2] - seg[i], seg[i + 3] - seg[i + 1]);
    if (r1 > R - 0.4 && r2 > R - 0.4 && len < R * 0.7) continue;
    out.push(seg[i], seg[i + 1], seg[i + 2], seg[i + 3]);
  }
  return out;
}

/** Six-pointed crown for the boss, as a closed outline of line segments (model units, before the boss scale). */
function crown(): number[] {
  const pts: [number, number][] = [[-6, 3.5]];
  for (let i = 0; i < 6; i++) { pts.push([-6 + i * 2.4, -3.5]); if (i < 5) pts.push([-4.8 + i * 2.4, 0]); }
  pts.push([6, 3.5], [-6, 3.5]);
  const out: number[] = [];
  for (let i = 0; i + 1 < pts.length; i++) out.push(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
  return out;
}

function loadMap(name: string) {
  if (world) scene.remove(world);
  view.ground2d.clear(); view.air2d.clear(); view.top2d.clear();
  const map = mapsByName[name];
  graph = buildGraph(map);
  sim = new EnemySim(graph, MAX_ENEMIES);
  towers = new TowerLayer(graph);
  buildings = new Buildings(graph);
  levelMap = map; phase = 'playing'; levelSteps = 0; overlay?.hide();
  fx = new Effects(fragments);
  bullets = new BulletSystem(20000, (h) => {
    fx.hit(h.x, h.y, [sim.col[3 * h.enemy], sim.col[3 * h.enemy + 1], sim.col[3 * h.enemy + 2]], h.damage);
    numbers.add(sim.x[h.enemy], sim.y[h.enemy], h.dealt, Math.hypot(h.vx, h.vy), Math.atan2(h.vy, h.vx), h.rgb);
    sfx.hit();
  }, (b) => { // bomb blast: sparks fly out as gun bullets
    for (let k = 0; k < b.sparks; k++) bullets.spawn(Kind.Gun, b.x, b.y, Math.random() * Math.PI * 2, 3 + Math.random() * 7, b.damage, 1, b.color);
    fragments.explodeModel([-2, 0, 2, 0], b.x, b.y, 0, 1, 1, 0.7, 0.3, 1.6, 1);
    sfx.boom();
  }, (x, y, kind, dir) => { // fire / sonic leave a trail of faint puffs
    if (kind === Kind.Fireball) fragments.spawn(x, y, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, Math.random() * 6.28, 0, 2 + Math.random() * 2, 0.55, 0.3, 0.12, 0.5 + Math.random() * 0.4);
    else fragments.spawn(x, y, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, dir + Math.PI / 2, 0, 3 + Math.random() * 2, 0.2, 0.55, 0.45, 0.5 + Math.random() * 0.4);
  }, (e, dealt, kind) => { // continuous damage: fire, sonic, virus (shown only with "all damage types")
    numbers.add(sim.x[e], sim.y[e], dealt, 0, 0, colorOf(kind === Kind.Fireball ? 'tFire' : kind === Kind.Sonic ? 'tSonic' : 'tStinger'), true);
  });
  sim.onShockHit = (i, dealt) => numbers.add(sim.x[i], sim.y[i], dealt, 0, 0, colorOf('tShockwave'), true);
  numbers.clear(); moneyNums.clear();
  combat = { sim, bullets, fx, towers: towers.towers, buildings, pointer, numbers };
  const waves = buildWaves();
  waveRunner = new WaveRunner(waves, (w) => {
    const d = waves[w];
    sim.spawn(d.type, d.hp * map.hp_mult, d.speed * map.speed_mult, d.value * map.value_mult, WAVE_COLORS[d.type]);
    sfx.appear();
  });
  kills = 0;
  money = map.money;
  quota = {};
  for (const name of map.towers) quota[keyByName[name]] = (quota[keyByName[name]] ?? 0) + 1;
  levelTowers = new Set(Object.keys(quota));
  state.towerKey = null; toolbar?.setSelected(null);
  world = new THREE.Group();
  terrain = buildTerrain(graph, name); world.add(terrain.group);
  const flat = view.ground2d, air = view.air2d;
  buildings.meshes.forEach((mesh) => { mesh.renderOrder = 6; flat.add(mesh); });
  enemyBatches = ENEMY_NAMES.map((n) => new LineModelBatch(n === 'boss' ? crown() : symbolOnly(models.enemies[n]), MAX_ENEMIES));
  enemyBalls = new EnemyBalls(MAX_ENEMIES); world.add(enemyBalls.mesh);
  enemyBatches.forEach((b, i) => { b.mesh.renderOrder = 10 + i; view.top2d.add(b.mesh); });
  towers.meshes.forEach((m) => { m.renderOrder = 5; flat.add(m); });
  towers.groundY = (x, y) => terrain.heightAt(x, y); world.add(towers.group);
  hpBars = new HpBars(MAX_ENEMIES); hpBars.mesh.renderOrder = 9; flat.add(hpBars.mesh);
  bullets.meshes.forEach((m) => { m.renderOrder = 8; flat.add(m); });
  fx.mesh.renderOrder = 7; flat.add(fx.mesh);
  hpText.mesh.renderOrder = 12; world.add(hpText.mesh); numbers.mesh.renderOrder = 13; world.add(numbers.mesh); moneyNums.mesh.renderOrder = 14; world.add(moneyNums.mesh);
  air.add(fragments.mesh); fragments.mesh.renderOrder = 20;
  scene.add(world);
}

/** Progress statistics only count in real play, not in sandbox. */
const tracking = () => !state.freeBuild && campaignNames.has(state.map); // generated/custom levels do not count toward progress
function announce(list: Achievement[]) { for (const a of list) toaster.show(a.title, a.desc); }
function earn(v: number) { money += v; sfx.money(); if (tracking()) { save.data.stats.creditsEarned += v; save.dirty(); } }

/** Where flying money goes: the credits counter, unprojected into the scene at the depth of the launch point. */
function moneyDest(x: number, y: number): THREE.Vector3 {
  const ref = new THREE.Vector3(x, 12, y), p = hud.creditsPoint();
  return p ? view.unprojectAtDepthOf(ref, p.x, p.y) : ref.clone().add(new THREE.Vector3(200, 0, -200));
}
const moneyStart = (x: number, y: number) => new THREE.Vector3(x, 12, y);

function killEnemy(i: number) {
  const type = sim.type[i];
  fragments.explodeModel(models.enemies[ENEMY_NAMES[type]], sim.x[i], sim.y[i], (sim.angle[i] * Math.PI) / 180, ENEMY_SCALE[type],
    Math.min(1, sim.col[3 * i] + 0.25), Math.min(1, sim.col[3 * i + 1] + 0.25), Math.min(1, sim.col[3 * i + 2] + 0.25), type === 9 ? 1.6 : 1, type === 9 ? 3 : 2);
  // the reward flies to the credits counter and is paid on arrival (too many in flight: pay at once)
  const big = type === 9;
  if (!moneyNums.spawn(moneyStart(sim.x[i], sim.y[i]), sim.value[i], moneyDest(sim.x[i], sim.y[i]), big)) earn(sim.value[i]);
  for (const mt of towers.moneyTowersNear(sim.x[i], sim.y[i])) if (!moneyNums.spawn(moneyStart(mt.x, mt.y), mt.value, moneyDest(mt.x, mt.y))) earn(mt.value);
  sim.remove(i);
  kills++;
  sfx.kill(type === 9);
  if (tracking()) {
    const k = ++save.data.stats.kills; save.dirty();
    if (k === 1 || k === 100 || k === 1000 || k === 10000) announce(checkAchievements());
  }
}

function endLevel(result: 'over' | 'won') {
  phase = result;
  sim.n = 0; bullets.clear(); // survivors vanish without paying out (original: waarde = 0)
  const goal = campaign.find(([n]) => n === state.map)?.[1] ?? mapsByName[state.map]?.goal ?? null;
  const lines = [`Score: ${kills} kills${goal ? ` (goal ${goal})` : ''}`];
  let hasNext = false;
  if (tracking()) {
    const prev = save.data.levels[state.map]?.best ?? 0, rowsBefore = unlockedRows(save.best());
    save.recordLevel(state.map, kills, result === 'won', goal);
    const rowsAfter = unlockedRows(save.best());
    if (result === 'won' && kills > prev) lines.push(prev > 1 ? `New best! (was ${prev})` : 'First completion!');
    if (rowsAfter > rowsBefore) lines.push(`<b>Row ${rowsAfter} unlocked!</b>`);
    const earned = checkAchievements({ won: result === 'won', buildingUntouched: !buildings.damaged });
    announce(earned);
    for (const e of earned) lines.push(`<b>Achievement: ${e.title}</b>`);
    save.flush();
    const i = campaign.findIndex(([n]) => n === state.map) + 1;
    hasNext = result === 'won' && i < campaign.length && i < rowsAfter * ROW_SIZE;
  } else if (!state.freeBuild && !campaignNames.has(state.map)) { // generated / imported level: own best score, no unlocks or achievements
    const prev = save.data.custom[state.map]?.best ?? 0;
    save.recordCustom(state.map, kills, result === 'won');
    if (result === 'won' && kills > prev) lines.push(prev > 1 ? `New best! (was ${prev})` : 'First completion!');
    save.flush();
  } else lines.push('(sandbox: score not saved)');
  overlay.show(result === 'won' ? 'LEVEL COMPLETE' : 'BUILDING DESTROYED', lines, hasNext);
  if (result === 'won') sfx.win(); else sfx.lose();
}

function spawnStress(n: number) {
  for (let k = 0; k < n; k++) {
    const type = Math.floor(Math.random() * 10);
    const speed = (type === 2 || type === 3 || type === 6 ? 0.8 : 0.4) * (0.7 + Math.random() * 0.6);
    // scatter over the whole network so a burst does not pile up on one pixel
    const edge = Math.floor(Math.random() * graph.eb.length);
    if (sim.spawn(type, 100, speed, 1, WAVE_COLORS[type], Math.random() * 0.95, edge) < 0) break;
  }
}

// ---- input ----
const pointer = { x: -1000, y: -1000, down: false, inside: false };
const toField = (e: PointerEvent) => { const f = view.toField(e.clientX, e.clientY); pointer.x = f.x; pointer.y = f.y; };
renderer.domElement.addEventListener('pointermove', toField);
renderer.domElement.addEventListener('pointerenter', () => { pointer.inside = true; });
renderer.domElement.addEventListener('pointerleave', () => { pointer.inside = false; });
let drag: { x: number; y: number; moved: boolean; button: number } | null = null;
addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (!drag.moved && Math.hypot(dx, dy) < 5) return;
  drag.moved = true; drag.x = e.clientX; drag.y = e.clientY;
  if (drag.button === 2) view.orbitBy(dx, dy); else view.panBy(dx, dy);
});
renderer.domElement.addEventListener('wheel', (e) => { e.preventDefault(); view.zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY); }, { passive: false });
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
renderer.domElement.addEventListener('pointerdown', (e) => {
  toField(e);
  if (e.button === 1) { e.preventDefault(); drag = { x: e.clientX, y: e.clientY, moved: true, button: 1 }; return; } // middle-drag pans
  if (e.button === 2) { drag = { x: e.clientX, y: e.clientY, moved: false, button: 2 }; return; } // right-click cancels the pending tower / selection; right-drag orbits the camera
  pointer.down = true;
  if (phase !== 'playing' || state.tool !== 'tower') return;
  if (state.towerKey) {
    const key = state.towerKey, cost = towerInfo[key].cost[0];
    if (!state.freeBuild && ((quota[key] ?? 0) <= 0 || money < cost)) return;
    if (towers.place(key, pointer.x, pointer.y) && !state.freeBuild) {
      money -= cost; quota[key]--;
      sfx.build(0);
      const d = save.data; d.stats.towersBuilt++; d.towersBuilt[key] = (d.towersBuilt[key] ?? 0) + 1; save.dirty();
      announce(checkAchievements());
      if (quota[key] <= 0) selectTower(null); // last one of its kind placed
    }
  } else {
    const picked = towers.pickAt(pointer.x, pointer.y); // click a placed tower to select it, empty ground to deselect
    if (picked && picked === towers.selected) upgradeSelected(); // clicking the selected tower again tries to upgrade it
    else towers.select(picked);
    if (!picked && sim.n > 0 && distanceFromNetwork(graph, pointer.x, pointer.y) < 7) { // click on the path: (de)select the nearest enemy
      let best = 0, bd = Infinity;
      for (let i = 0; i < sim.n; i++) { const d = Math.hypot(sim.x[i] - pointer.x, sim.y[i] - pointer.y); if (d < bd) { bd = d; best = i; } }
      sim.selected[best] ^= 1;
    }
  }
});
addEventListener('pointerup', () => {
  pointer.down = false;
  if (drag && drag.button === 2 && !drag.moved) { selectTower(null); towers.select(null); }
  drag = null;
});
addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); waveRunner.nextWave(); }
  if (e.code === 'Home') view.resetView();
  if (e.code === 'Escape') { selectTower(null); towers.select(null); }
  if (e.code === 'KeyU') upgradeSelected();
});

function upgradeSelected() {
  const t = towers.selected;
  if (!t) return;
  const cost = towers.upgradeCost(t);
  if (cost === null) return; // already at the maximum level
  if (!state.freeBuild && money < cost) { hud.flashCredits(); sfx.denied(); return; } // not enough credits: the counter flashes red, nothing else happens
  if (towers.upgrade(t) && !state.freeBuild) {
    money -= cost; sfx.build(t.level);
    const d = save.data; d.stats.upgrades++; d.maxTowerLevel = Math.max(d.maxTowerLevel, t.level); save.dirty();
    announce(checkAchievements());
  }
}

function selectTower(key: string | null) {
  if (key && !state.freeBuild && (quota[key] ?? 0) <= 0) key = null; // none left on this level
  state.towerKey = key;
  if (key) { state.tool = 'tower'; ui.syncTool(); towers.select(null); }
  toolbar!.setSelected(key);
}
toolbar = createToolbar(frameEl, selectTower);
const hud = createHud(frameEl, () => { if (phase === 'playing') waveRunner.nextWave(); },
  () => ({ w: renderer.domElement.clientWidth, h: renderer.domElement.clientHeight }),
  (px) => { const tb = document.getElementById('toolbar'); if (tb) tb.style.right = `${px}px`; }); // keep the toolbar clear of the HUD
hudLayout = hud.layout;
const overlay = createOverlay(frameEl, {
  onRestart: () => loadMap(state.map),
  onMenu: () => openLevels(),
  onNext: () => { const i = campaign.findIndex(([n]) => n === state.map) + 1; if (i < campaign.length) startLevel(campaign[i][0]); },
});
const menuBtn = document.createElement('button'); menuBtn.id = 'menuBtn'; menuBtn.textContent = '< levels';
menuBtn.onclick = () => { leaveLevel(); openLevels(); }; frameEl.append(menuBtn);
sfx.enabled = save.data.settings.sound;
const soundBtn = document.createElement('button'); soundBtn.id = 'soundBtn'; frameEl.append(soundBtn);
const syncSound = () => { soundBtn.textContent = sfx.enabled ? 'sound: on' : 'sound: off'; };
const toggleSound = () => { sfx.enabled = !sfx.enabled; syncSound(); if (sfx.enabled) sfx.click(); };
soundBtn.onclick = toggleSound; syncSound();
addEventListener('keydown', (e) => { if (e.code === 'KeyM') toggleSound(); });
addEventListener('pointerdown', (e) => { if ((e.target as HTMLElement).closest?.('button')) sfx.click(); }, true); // every button ticks
const panelEl = document.getElementById('panel')!;
let panelOpen = params.has('debug'); // the MVP control panel is hidden; press ` (backquote) or add ?debug to open it
const syncPanel = () => { panelEl.style.visibility = screen === 'game' && panelOpen ? '' : 'hidden'; };
addEventListener('keydown', (e) => { if (e.code === 'Backquote') { panelOpen = !panelOpen; syncPanel(); } });
type Screen = 'title' | 'levels' | 'achievements' | 'game';
let screen: Screen = playName || (params.get('map') && mapsByName[params.get('map')!]) ? 'game' : 'title';
const toaster = createToaster(frameEl);
const achScreen = createAchievements(frameEl, () => showScreen(achFrom));
let achFrom: Screen = 'title';
function openAchievements(from: Screen) { achFrom = from; showScreen('achievements'); }
const titleScreen = createTitle(frameEl, () => openLevels(), () => openAchievements('title'));
const levelScreen = createLevelSelect(frameEl, {
  onPlay: (name) => startLevel(name),
  onBack: () => showScreen('title'),
  onAchievements: () => openAchievements('levels'),
  data: () => ({ best: save.best(), custom: customEntries() }),
  onImport: (text) => importLevels(text),
  onRemove: (name) => { removeMine(name); delete mapsByName[name]; },
  onReset: () => { save.reset(); Object.assign(state, { damageNumbers: true, allDamage: false, hpMode: 'always' }); levelScreen.show(); },
  onUnlockAll: () => { // debug: every level at its goal (does not award achievements)
    for (const [n, g] of campaign) { const l = save.data.levels[n] ??= { best: 0, attempts: 0, wins: 0, goalReached: false }; if (l.best < g) l.best = g; l.goalReached = true; }
    save.flush(); levelScreen.show();
  },
});
function showScreen(s: Screen) {
  screen = s;
  titleScreen[s === 'title' ? 'show' : 'hide']();
  if (s === 'levels') levelScreen.show(); else levelScreen.hide();
  if (s === 'achievements') achScreen.show(); else achScreen.hide();
  syncPanel();
  for (const e of [menuBtn, soundBtn, document.getElementById('toolbar'), document.getElementById('credits'), document.getElementById('hud'), document.getElementById('card')]) if (e) (e as HTMLElement).style.visibility = s === 'game' ? '' : 'hidden';
}
function openLevels() { showScreen('levels'); }
function startLevel(name: string) { state.map = name; loadMap(name); ui.syncMap(); showScreen('game'); }
/** Leaving a started, unfinished level counts as a failed attempt (score 1), like the original. */
function leaveLevel() {
  if (phase === 'playing' && waveRunner.started && tracking()) {
    save.recordLevel(state.map, 0, false, null); announce(checkAchievements()); save.flush();
  } else if (phase === 'playing' && waveRunner.started && !state.freeBuild && !campaignNames.has(state.map)) {
    save.recordCustom(state.map, 0, false); save.flush(); // abandoning a generated level counts as a failed attempt too
  }
}
const card = createCard(frameEl);
resize();

const ui = createUi(document.getElementById('panel')!, state, {
  onMap: loadMap,
  onSpawn: spawnStress,
  onKillAll: () => { for (let i = sim.n - 1; i >= 0; i--) killEnemy(i); },
  onNextWave: () => waveRunner.nextWave(),
  onClearTowers: () => loadMap(state.map), // restart: fresh enemies, towers, quota and credits
});
loadMap(state.map);
showScreen(screen);
if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__byteality = { fragments, models, get sim() { return sim; }, get waves() { return waveRunner; }, get towers() { return towers; }, get bullets() { return bullets; }, get buildings() { return buildings; }, pointer, scene, renderer, numbers, sfx, finish: () => { levelSteps = levelMap.steps; }, get phase() { return phase; }, get levelSteps() { return levelSteps; } };

// ---- main loop: fixed 60 Hz simulation, render every frame ----
let acc = 0, last = performance.now(), spawnAcc = 0, fpsEma = 60, lastWave = 0;
const t0 = last;
function frame(now: number) {
  const dt = Math.min(0.25, (now - last) / 1000); last = now;
  if (screen !== 'game') { requestAnimationFrame(frame); return; }
  fpsEma += (1 / Math.max(dt, 1e-4) - fpsEma) * 0.05;
  fragments.time = (now - t0) / 1000;

  spawnAcc += state.autoSpawn * dt;
  if (spawnAcc >= 1) { spawnStress(Math.floor(spawnAcc)); spawnAcc -= Math.floor(spawnAcc); }

  acc += dt;
  while (acc >= STEP) {
    fx.step(); numbers.step(); moneyNums.step(earn);
    if (phase === 'playing') {
      waveRunner.step();
      if (waveRunner.started) levelSteps++;
      sim.step(towers.slowers());
      towers.step(combat);
      bullets.step(sim);
      for (let i = sim.n - 1; i >= 0; i--) if (sim.hp[i] <= 0) killEnemy(i); // reap enemies killed by towers
      buildings.attack(sim);
      if (!buildings.alive) endLevel('over');
      else if (waveRunner.started && levelSteps >= levelMap.steps) endLevel('won');
    }
    acc -= STEP;
  }

  if (pointer.down && state.tool === 'eraser') {
    const r2 = state.eraserRadius * state.eraserRadius;
    for (let i = sim.n - 1; i >= 0; i--) {
      const dx = sim.x[i] - pointer.x, dy = sim.y[i] - pointer.y;
      if (dx * dx + dy * dy < r2) killEnemy(i);
    }
  }

  for (const b of enemyBatches) b.begin();
  for (let i = 0; i < sim.n; i++) {
    enemyBatches[sim.type[i]].push(sim.x[i], sim.y[i], (sim.angle[i] * Math.PI) / 180, ENEMY_SCALE[sim.type[i]], Math.min(1, sim.col[3 * i] + 0.4), Math.min(1, sim.col[3 * i + 1] + 0.4), Math.min(1, sim.col[3 * i + 2] + 0.4), 1);
  }
  for (const b of enemyBatches) b.end();
  enemyBalls.update(sim.n, sim.x, sim.y, sim.col);
  hpBars.update(sim.n, sim.x, sim.y, sim.hp, sim.maxHp);
  if (tracking() && waveRunner.currentWave > save.data.maxWave) { save.data.maxWave = waveRunner.currentWave; save.dirty(); if (save.data.maxWave === 20 || save.data.maxWave === 100) announce(checkAchievements()); }
  if (waveRunner.currentWave !== lastWave) { if (waveRunner.currentWave > 0) sfx.wave(); lastWave = waveRunner.currentWave; }
  const st = save.data.settings; // persist the display and sound settings when they change
  if (st.hpMode !== state.hpMode || st.damageNumbers !== state.damageNumbers || st.allDamage !== state.allDamage || st.sound !== sfx.enabled) {
    st.hpMode = state.hpMode; st.damageNumbers = state.damageNumbers; st.allDamage = state.allDamage; st.sound = sfx.enabled; save.dirty();
  }
  numbers.enabled = state.damageNumbers; numbers.all = state.allDamage; hpText.mode = state.hpMode;
  bullets.render(); fx.render(); buildings.render(); numbers.render(); moneyNums.render(); hpText.render(sim, pointer);
  const ghost = state.tool === 'tower' && state.towerKey && pointer.inside
    ? { key: state.towerKey, x: pointer.x, y: pointer.y, affordable: state.freeBuild || ((quota[state.towerKey] ?? 0) > 0 && money >= towerInfo[state.towerKey].cost[0]) } : null;
  towers.render(ghost, pointer.inside && state.tool === 'tower' ? pointer : null, pointer);
  // the card follows the cursor: a hovered tower (when not placing one) takes precedence over the selected tower
  const hovered = pointer.inside && state.tool === 'tower' && !state.towerKey && phase === 'playing' ? towers.pickAt(pointer.x, pointer.y) : null;
  const shown = hovered ?? towers.selected;
  card.update(shown ? { info: shown.info, level: shown.level, upgradeCost: towers.upgradeCost(shown), money, free: state.freeBuild, selected: shown === towers.selected } : null);
  toolbar!.update((k) => ({ show: state.freeBuild || levelTowers.has(k), left: state.freeBuild ? null : quota[k] ?? 0, afford: state.freeBuild || money >= towerInfo[k].cost[0] }));
  fragments.flush();
  terrain.update((now - t0) / 1000);
  view.render();

  const w = waveRunner.currentWave, wd = waveRunner.waves[w];
  hud.update({
    credits: money,    timeLeft: waveRunner.started ? Math.max(0, (levelMap.steps - levelSteps) / 60) : null, totalTime: levelMap.steps / 60,
    wave: w, waveName: WAVE_TYPE_NAMES[wd.type] ?? '', waveRgb: (WAVE_COLORS[wd.type] ?? [255, 255, 255]).map((v) => v / 255) as [number, number, number],
    waveIn: waveRunner.started && phase === 'playing' ? waveRunner.secondsLeft : null,
    kills, goal: campaign.find(([n]) => n === state.map)?.[1] ?? levelMap.goal ?? null,
  });
  const waveLine = !waveRunner.started ? 'press SPACE to start'
    : `${w} ${WAVE_TYPE_NAMES[wd.type]}\nnext in  ${waveRunner.secondsLeft.toFixed(1)} s\nrate     ${(60 / wd.interval).toFixed(1)}/s x${wd.amount}`;
  const left = Math.max(0, Math.ceil((levelMap.steps - levelSteps) / 60)), timeLine = waveRunner.started ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : '-';
  ui.setStats(`fps      ${fpsEma.toFixed(0)}\ntime     ${timeLine}\nenemies  ${sim.n}\ncredits  ${Math.floor(money)}${state.freeBuild ? ' (sandbox)' : ''}\nkills    ${kills}\nleaked   ${sim.leaked}\nfragments ${fragments.spawned}\nwave     ${waveLine}`);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

