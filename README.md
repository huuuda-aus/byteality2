# ByteAlity Remake (MVP scaffold)

Vite + TypeScript + Three.js. Everything is drawn as additive-blended thin lines, as in the 2008 original.

```
npm install
npm run dev        # http://localhost:5173  (?map=the_maze selects a campaign map)
npm run build      # typecheck + production build
```

## What's in the MVP
- **Line-model rendering**: every enemy/tower model is one `LineSegments` instanced draw call (`src/lineBatch.ts`). 30 000 enemies are capped by `MAX_ENEMIES`, not by draw calls.
- **Enemies on graph paths** (`src/graph.ts`, `src/enemies.ts`): random branching at forks, same movement/turning rules as the original, fixed 60 Hz step, structure-of-arrays.
- **GPU fragments** (`src/fragments.ts`): dying enemies break into short line pieces + sparks. Spawn params go into a 262 144-entry ring buffer; position/rotation/fade are computed in the vertex shader, so cost per frame is ~0 on CPU.
- **Waves** (`src/waves.ts`): port of the original 20-tier wave table, overlapping waves, space = next wave. Enable with "run waves".
- **Towers & combat** (`src/towers.ts`, `src/combat.ts`, `src/bullets.ts`, `src/effects.ts`): placement, selection, upgrades, and shooting ported from `tower_shoot.gml` for all 29 towers. Swept bullet collision against an enemy spatial hash; kills pay `value` + Money-tower bonus.
- **Numbers** (`src/numbers.ts`): floating damage numbers (drift in the hit direction, 55-65 steps) and enemy HP text, ported from `damageparticles` / the enemy Draw event. Click on the path to select an enemy: it gets a box and every tower targets it first.
- **Screens** (`src/screens.ts`, `src/progress.ts`): title screen and level select (rows of 3, map thumbnails, status dots). Best scores are kept in localStorage; a row unlocks when total kills reach the sum of the goal scores of all earlier rows (the original's rule, generalised from rows of 4).
- **Buildings & level flow** (`src/buildings.ts`): buildings have HP, enemies within 99 px shoot them (1 HP per enemy per step), Heal towers repair them. The level lasts the map's time from the first wave; losing every building or running out the clock ends it with a score overlay.
- **Level economy**: kills launch their value as a number that flies to the credits counter (top right) and is paid on arrival; each map's tower quota (e.g. level 1: three Guns) and starting credits come from the map file; placing costs the tower's level-1 price, upgrades cost `cost[level+1]`, kills pay the enemy's value. The toolbar lists only that level's towers with remaining counts. A "sandbox" checkbox lifts all limits for testing.
- **Stress tools** (side panel): spawn +100 / +1k / +10k, auto-spawn per second, eraser (hold LMB) to blow enemies up.

## Data (`assets/`)
Generated from the decompiled original by `tools/` (see `reference/NOTES.md`):
`models.json` (line models), `towers.json` (stats), `maps.json` (120 campaign maps), `gm_constants.json`.
Note: edge indices in maps are **1-based** (GameMaker heritage); `buildGraph` converts.

## Rights
Models, stats and maps are derived from *ByteAlity Tower Defense* (Erik Leppen, 2008, freeware). Get the author's permission before publishing anything that reuses them, and replace the sounds/music/texture (not included) with your own.

## Next steps
1. Music, bloom pass.
2. Custom maps + editor (the original's tower tech levels only gate those), settings screen.
3. HUD (LCD digits, panels), wave bars, build/upgrade UI.
4. Audio, bloom pass, map editor.
