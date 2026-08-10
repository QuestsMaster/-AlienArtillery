# Alien Artillery V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an installable landscape iPhone PWA with a complete offline 3-vs-3 turn-based artillery match against a bounded computer opponent.

**Architecture:** Pure TypeScript game rules run independently from Canvas rendering. A fixed-step simulation owns projectiles and alien movement; a byte-mask owns destructible terrain; a controller connects turns, AI, input, rendering, persistence, and PWA lifecycle. The production build generates its own versioned service worker after Vite emits hashed assets.

**Tech Stack:** Node.js 22.12+, npm, TypeScript 5.9, Vite 8.1, Vitest 4, HTML5 Canvas 2D, IndexedDB, Service Worker, Web App Manifest.

## Global Constraints

- Original aliens, art, names, maps, and sounds only; do not copy Worms assets or character silhouettes.
- One landscape map, one human player, one computer opponent, three aliens per team.
- Every alien starts with exactly 100 health; the human turn limit is exactly 35 seconds.
- V1 weapons are bazooka and three-second grenade with unlimited ammunition.
- Simulation uses a fixed time step; rendering never mutates game rules.
- Target iOS 17 or newer; support 844x390 and 852x393 landscape viewports plus safe-area insets.
- World size is 1600x900 mask pixels, physics step is 1/60 second, at most 8 physics substeps run per rendered frame, and a dynamic phase times out after 8 simulated seconds.
- First successful online load must make the complete game playable offline from the iPhone Home Screen.
- Match state is persisted only after a stable turn boundary and when the app moves to the background.
- No framework, game engine, server, account, advertising, store, online multiplayer, or procedural map in V1.
- Use test-driven development for every rules module and commit after every task.

---

## Subagent Execution Map

Use an isolated worktree per concurrently running implementation agent. Review each task first for spec compliance and then for code quality before integrating it.

```text
Wave 0: Task 1
Wave 1: Task 2
Wave 2 (parallel): Task 3 | Task 4 | Task 5
Wave 3: Task 6
Wave 4 (parallel): Task 7 | Task 8 | Task 9
Wave 5: Task 10
Wave 6: Task 11
```

Tasks in a parallel wave must not edit the same files. If an interface must change, stop that task and route the change through the owner of the earlier interface task before continuing.
Every task receives two fresh reviews before integration: specification compliance first, then code quality. The root agent alone integrates reviewed commits into the main worktree.

## File Responsibility Map

```text
index.html                         App shell and iPhone metadata
package.json                       Commands and pinned minor dependency ranges
vite.config.ts                     Relative production base and test configuration
src/main.ts                        Browser bootstrap only
src/styles.css                     Full-screen landscape shell and safe areas
src/game/types.ts                  Shared domain types; no runtime behavior
src/game/config.ts                 All balance and world constants
src/game/math.ts                   Vec2 and numeric helpers
src/game/random.ts                 Seeded deterministic PRNG
src/game/physics.ts                Fixed-step projectile integration
src/game/terrain.ts                Destructible byte mask and collision queries
src/game/map.ts                    One fixed island and six spawn points
src/game/movement.ts               Walking, jump, support, falling, world exit
src/game/turn-manager.ts           Turn phases, timer, rotation, win detection
src/game/weapons.ts                Bazooka/grenade creation, explosion, damage
src/game/ai.ts                     Bounded shot search and deliberate aim error
src/game/storage-codec.ts          Versioned JSON/binary-safe match codec
src/game/storage.ts                IndexedDB repository
src/ui/camera.ts                   World/screen transforms and camera bounds
src/ui/controls.ts                 Pointer/touch gestures to GameCommand values
src/ui/renderer.ts                 Canvas draw pipeline and simple original art
src/game/game.ts                   Match orchestration and state transitions
src/pwa/register.ts                SW registration and offline-ready notification
public/manifest.webmanifest        Home Screen metadata
public/icons/*.svg                 Original scalable app icons
scripts/generate-service-worker.mjs  Post-build asset inventory and SW generation
tests/**                           Unit and integration tests mirroring src modules
tests/helpers/fixtures.ts          Shared complete state/projectile/alien fixtures
```

### Task 1: Project Foundation and Test Harness

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`
- Create: `src/main.ts`, `src/styles.css`
- Create: `tests/smoke/app-shell.test.ts`
- Create: `.gitignore`

**Interfaces:**
- Consumes: none.
- Produces: `npm run dev`, `npm test -- --run`, `npm run build`; DOM nodes `#game`, `#hud`, and `#offline-status`.

- [ ] **Step 1: Write the shell smoke test**

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('app shell', () => {
  it('contains the canvas and offline status', () => {
    const html = readFileSync('index.html', 'utf8');
    expect(html).toContain('id="game"');
    expect(html).toContain('id="offline-status"');
  });
});
```

- [ ] **Step 2: Run the test and verify the missing harness fails**

Run: `npm test -- --run tests/smoke/app-shell.test.ts`  
Expected: FAIL because `package.json` and Vitest are absent.

- [ ] **Step 3: Create the minimal Vite/TypeScript application**

Set `package.json` scripts to `dev: vite`, `test: vitest`, `build: vite build`, and `preview: vite preview`. Pin minor lines `vite: ~8.1.0`, `vitest: ~4.1.0`, `typescript: ~5.9.0`, and `@types/node: ~24.0.0`; declare `engines.node: ">=22.12.0"`. Configure Vite with `base: './'`. `src/main.ts` must acquire the canvas and throw `Missing #game canvas` if it is absent. CSS must use `100dvh`, `touch-action: none`, `overscroll-behavior: none`, and `env(safe-area-inset-*)`.

- [ ] **Step 4: Install and verify the foundation**

Run: `npm install && npm test -- --run && npm run build`  
Expected: all tests PASS and `dist/index.html` exists.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tsconfig.json vite.config.ts index.html src tests .gitignore
git commit -m "chore: scaffold Alien Artillery PWA"
```

### Task 2: Domain Contracts, Configuration, and Deterministic Randomness

**Files:**
- Create: `src/game/types.ts`, `src/game/config.ts`, `src/game/math.ts`, `src/game/random.ts`
- Create: `tests/helpers/fixtures.ts`
- Create: `tests/game/math.test.ts`, `tests/game/random.test.ts`, `tests/game/config.test.ts`

**Interfaces:**
- Consumes: TypeScript/Vitest harness from Task 1.
- Produces: `Vec2`, `TeamId`, `WeaponKind`, `TurnPhase`, `AlienState`, `ProjectileState`, `MatchState`, `GameCommand`, `GameEvent`, `Clock`; `GAME_CONFIG`; `add`, `scale`, `distance`, `clamp`; `SeededRandom.next(): number`; complete factories `alien`, `projectile`, and `matchFixture`.

- [ ] **Step 1: Write failing contract tests**

```ts
import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from '../../src/game/config';
import { SeededRandom } from '../../src/game/random';

it('locks the approved match constants', () => {
  expect(GAME_CONFIG.teamSize).toBe(3);
  expect(GAME_CONFIG.startingHealth).toBe(100);
  expect(GAME_CONFIG.humanTurnSeconds).toBe(35);
  expect(GAME_CONFIG.grenadeFuseSeconds).toBe(3);
});

it('repeats seeded random sequences', () => {
  const a = new SeededRandom(42);
  const b = new SeededRandom(42);
  expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()]);
});
```

- [ ] **Step 2: Verify the tests fail**

Run: `npm test -- --run tests/game/config.test.ts tests/game/random.test.ts`  
Expected: FAIL with missing modules.

- [ ] **Step 3: Define exact shared contracts**

```ts
export type Vec2 = Readonly<{ x: number; y: number }>;
export type TeamId = 'human' | 'cpu';
export type WeaponKind = 'bazooka' | 'grenade';
export type TurnPhase = 'ready' | 'aiming' | 'projectile' | 'settling' | 'complete';
export type GameCommand =
  | { type: 'move'; direction: -1 | 0 | 1 }
  | { type: 'jump' }
  | { type: 'aim'; angleRadians: number }
  | { type: 'fire'; power: number }
  | { type: 'select-weapon'; weapon: WeaponKind }
  | { type: 'camera-pan'; delta: Vec2 }
  | { type: 'camera-zoom'; factor: number };

export type GameEvent =
  | { type: 'shot'; projectileId: string }
  | { type: 'explosion'; position: Vec2; radius: number }
  | { type: 'damage'; alienId: string; amount: number }
  | { type: 'defeated'; alienId: string };

export interface Clock { nowMilliseconds(): number }
```

Define serializable `AlienState`, `ProjectileState`, and `MatchState` with stable string IDs, finite numeric values, a `schemaVersion: 1`, a PRNG seed, current team/index/phase, selected weapon, wind, aliens, projectile or `null`, terrain bytes, camera, queued `GameEvent` values, and winner or `null`. Test factories accept `Partial<T>` overrides but always return a complete valid object.

`tests/helpers/fixtures.ts` exports `ORIGIN`, `ENV`, `alien`, `projectile`, `matchFixture`, `supportedTerrain`, `matchWithHumanHealth`, `nextWithCpuTurnComplete`, `openFieldInput`, and `blockedInput`. Each later test imports the named fixture instead of defining an incomplete object. Task 10 defines its controller-specific `testGame` and `lethalShots` helpers inside `tests/integration/match.test.ts`.

Centralize these initial values in `GAME_CONFIG`: world `1600x900`, fixed step `1/60`, max frame substeps `8`, alien radius `18`, walk speed `90 px/s`, jump velocity `-260 px/s`, gravity `420 px/s²`, wind range `-40..40 px/s²`, bazooka speed `220..620 px/s`, grenade restitution `0.55`, explosion radius `54 px`, maximum damage `60`, dynamic timeout `8 s`, camera zoom `0.65..2`, and AI search ceiling `240` simulations with a `250 ms` wall-clock failsafe.

- [ ] **Step 4: Implement helpers and run all contract tests**

Use a 32-bit Mulberry32 PRNG; `next()` returns `[0, 1)`. Reject a non-finite vector in exported constructors.  
Run: `npm test -- --run tests/game/math.test.ts tests/game/random.test.ts tests/game/config.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/game tests/game
git commit -m "feat: define deterministic game contracts"
```

### Task 3: Fixed-Step Projectile Physics

**Files:**
- Create: `src/game/physics.ts`
- Create: `tests/game/physics.test.ts`

**Interfaces:**
- Consumes: `Vec2`, `ProjectileState`, `GAME_CONFIG`, math helpers.
- Produces: `PhysicsEnvironment`, `CollisionProbe`, `stepProjectile(projectile, environment, dt)`, `simulateProjectile(initial, environment, probe, maxSteps)`.

- [ ] **Step 1: Write failing deterministic-trajectory tests**

```ts
it('applies gravity and bazooka wind at a fixed step', () => {
  const next = stepProjectile(projectile({ velocity: { x: 10, y: -5 } }),
    { gravity: 20, wind: 2 }, 0.05);
  expect(next.velocity.x).toBeCloseTo(10.1);
  expect(next.velocity.y).toBeCloseTo(-4);
});

it('stops simulation at the first terrain hit', () => {
  const result = simulateProjectile(projectile(), ENV, p => p.x >= 5, 600);
  expect(result.reason).toBe('collision');
  expect(result.steps).toBeLessThan(600);
});
```

- [ ] **Step 2: Verify failure**

Run: `npm test -- --run tests/game/physics.test.ts`  
Expected: FAIL with missing `physics.ts`.

- [ ] **Step 3: Implement the pure simulation**

Use semi-implicit Euler integration. Bazooka receives full wind acceleration; grenade receives `GAME_CONFIG.grenadeWindFactor`. Return reasons `'collision' | 'fuse' | 'out-of-bounds' | 'step-limit'`. Grenade collision reflects velocity along the estimated surface normal and multiplies it by configured restitution; its fuse continues during bounces.

- [ ] **Step 4: Verify deterministic and bounded behavior**

Run: `npm test -- --run tests/game/physics.test.ts`  
Expected: PASS, including identical trajectories across repeated calls and termination at `maxSteps`.

- [ ] **Step 5: Commit**

```bash
git add src/game/physics.ts tests/game/physics.test.ts
git commit -m "feat: add fixed-step projectile physics"
```

### Task 4: Destructible Terrain and Fixed Map

**Files:**
- Create: `src/game/terrain.ts`, `src/game/map.ts`
- Create: `tests/game/terrain.test.ts`, `tests/game/map.test.ts`

**Interfaces:**
- Consumes: `Vec2`, world dimensions from `GAME_CONFIG`.
- Produces: `TerrainMask`, `TerrainSnapshot`, `createFixedMap()`, six spawn points.

- [ ] **Step 1: Write failing mask tests**

```ts
it('carves a circular hole without changing outside pixels', () => {
  const mask = TerrainMask.filled(20, 20);
  const removed = mask.carveCircle({ x: 10, y: 10 }, 3);
  expect(removed).toBeGreaterThan(20);
  expect(mask.isSolid(10, 10)).toBe(false);
  expect(mask.isSolid(0, 0)).toBe(true);
});

it('provides three valid spawns per team', () => {
  const map = createFixedMap();
  expect(map.spawns.human).toHaveLength(3);
  expect(map.spawns.cpu).toHaveLength(3);
  for (const p of [...map.spawns.human, ...map.spawns.cpu]) {
    expect(map.terrain.hasSupport(p, 18)).toBe(true);
  }
});
```

- [ ] **Step 2: Verify failure**

Run: `npm test -- --run tests/game/terrain.test.ts tests/game/map.test.ts`  
Expected: FAIL with missing modules.

- [ ] **Step 3: Implement mask and map**

Store one byte per world pixel in `Uint8Array`. Out-of-range reads are empty. Implement `isSolid`, `setSolid`, `carveCircle`, `hasSupport(position, footRadius)`, `findSurfaceBelow(position, maxDistance)`, `snapshot`, and `fromSnapshot`. Build exactly one island from deterministic filled ellipses and carved cavities; do not use random generation.

- [ ] **Step 4: Verify terrain invariants**

Run: `npm test -- --run tests/game/terrain.test.ts tests/game/map.test.ts`  
Expected: PASS, including edge carving, cavity carving, snapshot round-trip, and all six supported spawns.

- [ ] **Step 5: Commit**

```bash
git add src/game/terrain.ts src/game/map.ts tests/game/terrain.test.ts tests/game/map.test.ts
git commit -m "feat: add destructible island terrain"
```

### Task 5: Alien Movement and Turn State Machine

**Files:**
- Create: `src/game/movement.ts`, `src/game/turn-manager.ts`
- Create: `tests/game/movement.test.ts`, `tests/game/turn-manager.test.ts`

**Interfaces:**
- Consumes: `AlienState`, `MatchState`, `TerrainMask`, `GAME_CONFIG`.
- Produces: `stepAlien`, `tryJump`, `isOutsideWorld`, `startTurn`, `tickHumanTurn`, `advanceTurn`, `findWinner`.

- [ ] **Step 1: Write failing lifecycle tests**

```ts
it('allows only one controlled jump per turn', () => {
  const first = tryJump(alien({ jumpsUsed: 0 }), supportedTerrain);
  expect(first.jumpsUsed).toBe(1);
  expect(tryJump(first, supportedTerrain)).toEqual(first);
});

it('rotates past defeated aliens', () => {
  const next = advanceTurn(matchWithHumanHealth([0, 50, 0]));
  expect(next.activeTeam).toBe('cpu');
  const again = advanceTurn(nextWithCpuTurnComplete(next));
  expect(again.activeAlienIndex.human).toBe(1);
});
```

- [ ] **Step 2: Verify failure**

Run: `npm test -- --run tests/game/movement.test.ts tests/game/turn-manager.test.ts`  
Expected: FAIL with missing modules.

- [ ] **Step 3: Implement movement and turn transitions**

Walking accelerates toward configured speed and stops at solid slopes or map edges. A jump is accepted only in `'ready' | 'aiming'`, with support and `jumpsUsed === 0`. `tickHumanTurn` subtracts seconds only while visible and ends at zero. Phase order is `ready -> aiming -> projectile -> settling -> complete`; illegal transitions throw `Invalid turn transition`.

- [ ] **Step 4: Verify movement, timeout, rotation, and victory**

Run: `npm test -- --run tests/game/movement.test.ts tests/game/turn-manager.test.ts`  
Expected: PASS, including instant defeat below world bounds and winner detection when a team has no living aliens.

- [ ] **Step 5: Commit**

```bash
git add src/game/movement.ts src/game/turn-manager.ts tests/game/movement.test.ts tests/game/turn-manager.test.ts
git commit -m "feat: add alien movement and turn lifecycle"
```

### Task 6: Weapons, Explosions, and Damage

**Files:**
- Create: `src/game/weapons.ts`
- Create: `tests/game/weapons.test.ts`

**Interfaces:**
- Consumes: physics APIs from Task 3, `TerrainMask` from Task 4, domain state from Task 2.
- Produces: `createProjectile`, `damageAtDistance`, `resolveExplosion` returning `{ terrain, aliens, removedPixels }`.

- [ ] **Step 1: Write failing weapon tests**

```ts
it('gives a grenade an exact three-second fuse', () => {
  expect(createProjectile('grenade', ORIGIN, Math.PI / 4, 0.5).fuseRemaining)
    .toBe(3);
});

it('applies maximum center damage and zero edge damage', () => {
  expect(damageAtDistance(60, 50, 0)).toBe(60);
  expect(damageAtDistance(60, 50, 50)).toBe(0);
});
```

- [ ] **Step 2: Verify failure**

Run: `npm test -- --run tests/game/weapons.test.ts`  
Expected: FAIL with missing `weapons.ts`.

- [ ] **Step 3: Implement both weapons and one explosion pipeline**

Clamp power to `[0, 1]`; derive velocity from angle and configured min/max speed. `resolveExplosion` must carve terrain first, then compute radial damage from pre-knockback positions, clamp health to `[0, 100]`, add radial impulse to living aliens, and leave defeated aliens available for the settling animation.

- [ ] **Step 4: Verify rules and integrations**

Run: `npm test -- --run tests/game/weapons.test.ts tests/game/physics.test.ts tests/game/terrain.test.ts`  
Expected: PASS, including direct hit, edge hit, friendly fire, and terrain removal.

- [ ] **Step 5: Commit**

```bash
git add src/game/weapons.ts tests/game/weapons.test.ts
git commit -m "feat: add bazooka grenade and explosions"
```

### Task 7: Bounded Computer Opponent

**Files:**
- Create: `src/game/ai.ts`
- Create: `tests/game/ai.test.ts`

**Interfaces:**
- Consumes: `simulateProjectile`, weapon creation, terrain probe, `MatchState`, `SeededRandom`, injectable `Clock`.
- Produces: `AiDecision`, `chooseAiDecision(input, limits)` where limits contain `maxSimulations` and `maxMilliseconds`.

- [ ] **Step 1: Write failing bounded-search tests**

```ts
it('returns a legal shot within the simulation budget', () => {
  const result = chooseAiDecision(openFieldInput(), { maxSimulations: 240, maxMilliseconds: 250 });
  expect(result.command.type).toBe('fire');
  expect(result.simulations).toBeLessThanOrEqual(240);
});

it('always returns a turn-ending fallback', () => {
  const result = chooseAiDecision(blockedInput(), { maxSimulations: 12, maxMilliseconds: 250 });
  expect(['fire', 'pass']).toContain(result.command.type);
});
```

- [ ] **Step 2: Verify failure**

Run: `npm test -- --run tests/game/ai.test.ts`  
Expected: FAIL with missing `ai.ts`.

- [ ] **Step 3: Implement target scoring and deliberate error**

Score predicted enemy damage positively, friendly damage negatively, self-damage most negatively, and shorter repositioning positively. Search a fixed grid of weapon/angle/power candidates and yield to the browser after every 40 simulations. Use the match PRNG to choose among the best five percent and perturb angle/power within configured error bounds. If no candidate scores above zero, attempt one safe horizontal move and a second bounded search; otherwise return `{ type: 'pass' }`. Use the injected `Clock` for the wall limit so tests never depend on real timing.

- [ ] **Step 4: Verify deterministic, imperfect, terminating AI**

Run: `npm test -- --run tests/game/ai.test.ts`  
Expected: PASS for same-seed reproducibility, budget limits, friendly-fire avoidance when a safe shot exists, and fallback termination.

- [ ] **Step 5: Commit**

```bash
git add src/game/ai.ts tests/game/ai.test.ts
git commit -m "feat: add bounded artillery opponent"
```

### Task 8: Camera, Touch Controls, and Canvas Renderer

**Files:**
- Create: `src/ui/camera.ts`, `src/ui/controls.ts`, `src/ui/renderer.ts`
- Create: `tests/ui/camera.test.ts`, `tests/ui/controls.test.ts`

**Interfaces:**
- Consumes: domain contracts, map dimensions, terrain snapshots.
- Produces: `Camera`, `screenToWorld`, `worldToScreen`, `commandAt`, `TouchControls`, `CanvasRenderer.render(match, terrain, camera)`.

- [ ] **Step 1: Write failing pure UI tests**

```ts
it('round-trips screen and world coordinates', () => {
  const camera = { center: { x: 500, y: 300 }, zoom: 1.5, viewport: { x: 844, y: 390 } };
  expect(screenToWorld(worldToScreen({ x: 610, y: 280 }, camera), camera))
    .toEqual({ x: 610, y: 280 });
});

it('maps the bottom-left zone to movement', () => {
  expect(commandAt({ x: 40, y: 340 }, { width: 844, height: 390 })).toEqual({ type: 'move', direction: -1 });
});
```

- [ ] **Step 2: Verify failure**

Run: `npm test -- --run tests/ui/camera.test.ts tests/ui/controls.test.ts`  
Expected: FAIL with missing UI modules.

- [ ] **Step 3: Implement responsive controls and original Canvas art**

Clamp zoom to configured min/max and camera center to padded world bounds. Pointer zones: movement/jump lower left, weapon slots lower center, aim/fire lower right; a pointer captured by a HUD control never starts a pan or pinch. Free-space one-finger drag pans and two-pointer distance changes zoom. Portrait orientation renders only a `Поверните iPhone` overlay and suppresses game commands. Renderer draw order is background, terrain, aliens, projectile, queued shot/explosion/damage/defeat effects, trajectory preview, HUD, touch controls. Draw aliens from rounded primitives with antennae and team palettes; no copied silhouettes or assets.

- [ ] **Step 4: Verify math and manual resize behavior**

Run: `npm test -- --run tests/ui/camera.test.ts tests/ui/controls.test.ts && npm run build`  
Expected: PASS and build succeeds. Then run `npm run dev -- --host 0.0.0.0`, resize to 844x390 and 852x393, and confirm no control crosses the safe-area padding.

- [ ] **Step 5: Commit**

```bash
git add src/ui tests/ui
git commit -m "feat: add touch UI camera and renderer"
```

### Task 9: Versioned Match Persistence

**Files:**
- Create: `src/game/storage-codec.ts`, `src/game/storage.ts`
- Create: `tests/game/storage-codec.test.ts`, `tests/game/storage.test.ts`

**Interfaces:**
- Consumes: `MatchState`, `TerrainSnapshot`.
- Produces: `encodeMatch`, `decodeMatch`, `MatchRepository.load/save/clear`.

- [ ] **Step 1: Write failing round-trip and corruption tests**

```ts
it('round-trips a destroyed terrain snapshot', () => {
  const encoded = encodeMatch(matchFixture({ terrainBytes: new Uint8Array([1, 0, 1]) }));
  expect(decodeMatch(encoded)).toEqual(matchFixture({ terrainBytes: new Uint8Array([1, 0, 1]) }));
});

it('rejects an unknown schema', () => {
  expect(() => decodeMatch('{"schemaVersion":99}')).toThrow('Unsupported save schema');
});
```

- [ ] **Step 2: Verify failure**

Run: `npm test -- --run tests/game/storage-codec.test.ts tests/game/storage.test.ts`  
Expected: FAIL with missing modules.

- [ ] **Step 3: Implement strict codec and IndexedDB repository**

Encode bytes as base64, preserve finite numbers only, validate team sizes, IDs, health range, phase, weapon, dimensions, and winner. Repository uses database `alien-artillery`, store `matches`, key `current`, and writes one atomic record. Return `{ status: 'empty' | 'loaded' | 'invalid', match?: MatchState }`; an invalid record remains until the caller explicitly clears it.

- [ ] **Step 4: Verify persistence behavior**

Run: `npm test -- --run tests/game/storage-codec.test.ts tests/game/storage.test.ts`  
Expected: PASS for empty, valid, invalid, overwrite, and clear paths using a deterministic fake repository adapter.

- [ ] **Step 5: Commit**

```bash
git add src/game/storage-codec.ts src/game/storage.ts tests/game/storage-codec.test.ts tests/game/storage.test.ts
git commit -m "feat: persist versioned offline matches"
```

### Task 10: Integrated Match Controller

**Files:**
- Create: `src/game/game.ts`
- Modify: `src/main.ts`
- Create: `tests/integration/match.test.ts`, `tests/integration/recovery.test.ts`

**Interfaces:**
- Consumes: all rules, AI, renderer, controls, and storage modules.
- Produces: `GameController.create(dependencies)`, `startNewMatch(seed)`, `resume`, `dispatch`, `tick`, `pause`, `render`.

- [ ] **Step 1: Write failing end-to-end state tests**

```ts
it('completes a deterministic match without a stuck phase', async () => {
  const game = testGame({ seed: 7, scriptedHumanShots: lethalShots });
  await game.runUntilWinner(20_000);
  expect(game.state.winner).toBe('human');
  expect(game.state.phase).toBe('complete');
});

it('saves only after settling', async () => {
  const game = testGame();
  game.state.phase = 'projectile';
  await game.tick(1 / 60);
  expect(game.repository.save).not.toHaveBeenCalled();
  await game.runUntilPhase('ready');
  expect(game.repository.save).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Verify failure**

Run: `npm test -- --run tests/integration/match.test.ts tests/integration/recovery.test.ts`  
Expected: FAIL with missing `GameController`.

- [ ] **Step 3: Implement the controller and browser bootstrap**

Use an accumulator with `GAME_CONFIG.fixedStepSeconds`; cap work to eight substeps and discard excess accumulated real time to prevent a background-return spiral. Accept human commands only during the human controllable phases. Begin AI work only on a CPU ready phase. Pause the human timer on `visibilitychange`. Emit and consume `GameEvent` values for every required visual effect. Save after settling and on `pagehide`/hidden visibility only when state is stable. On invalid recovery, show buttons for `New match` and `Clear damaged save` instead of throwing. Expose `canActivatePwaUpdate(): boolean`, true only when there is no active match or the match phase is `complete`.

- [ ] **Step 4: Run the complete rules and integration suite**

Run: `npm test -- --run && npm run build`  
Expected: all tests PASS, deterministic match completes, invalid recovery presents a recoverable state, and production build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts src/game/game.ts tests/integration
git commit -m "feat: integrate complete alien artillery match"
```

### Task 11: Installable Offline PWA and Release Acceptance

**Files:**
- Create: `public/manifest.webmanifest`, `public/icons/icon.svg`, `public/icons/maskable.svg`
- Create: `src/pwa/register.ts`, `scripts/generate-service-worker.mjs`
- Modify: `package.json`, `index.html`, `src/main.ts`
- Create: `tests/pwa/manifest.test.ts`, `tests/pwa/offline-build.test.ts`
- Create: `README.md`, `docs/testing/iphone-acceptance.md`, `docs/deployment.md`

**Interfaces:**
- Consumes: production build from Task 10.
- Produces: installable PWA, generated `dist/sw.js`, visible offline-ready status, exact iPhone acceptance checklist.

- [ ] **Step 1: Write failing manifest and build-inventory tests**

```ts
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

it('declares a standalone landscape application', () => {
  const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'));
  expect(manifest.display).toBe('standalone');
  expect(manifest.orientation).toBe('landscape');
  expect(manifest.start_url).toBe('./');
});

it('lists every production asset in the generated worker', () => {
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
  const files = walk('dist').filter(p => !p.endsWith('sw.js'));
  const worker = readFileSync('dist/sw.js', 'utf8');
  for (const file of files) expect(worker).toContain(JSON.stringify('./' + relative('dist', file).replaceAll('\\\\', '/')));
});
```

- [ ] **Step 2: Verify failure**

Run: `npm test -- --run tests/pwa/manifest.test.ts tests/pwa/offline-build.test.ts`  
Expected: FAIL because manifest and generated service worker do not exist.

- [ ] **Step 3: Implement install and cache generation**

Change build script to `vite build && node scripts/generate-service-worker.mjs`. The generator recursively lists `dist` after Vite, excludes `sw.js`, writes a versioned cache name derived from sorted file paths plus byte sizes, and emits install/activate/fetch/message handlers. Use cache-first for same-origin assets and navigation fallback to cached `./index.html`; do not call `skipWaiting()` during install and never delete old caches before the new precache succeeds. `register.ts` registers `import.meta.env.BASE_URL + 'sw.js'`, waits for `navigator.serviceWorker.ready`, then changes `#offline-status` to `Готово к офлайн-игре`. When a worker is waiting, send `ACTIVATE_UPDATE` only if `game.canActivatePwaUpdate()` is true; otherwise show `Обновление будет применено после матча`. The worker calls `skipWaiting()` only after that message and deletes obsolete caches only in its activation handler.

- [ ] **Step 4: Verify automated release gates**

Run: `npm test -- --run && npm run build && npm test -- --run tests/pwa/offline-build.test.ts`  
Expected: all tests PASS; `dist/manifest.webmanifest`, both icons, and `dist/sw.js` exist; worker inventory includes every emitted asset.

- [ ] **Step 5: Perform Mac and iPhone acceptance**

Document and execute. `docs/deployment.md` must describe a GitHub Pages HTTPS deployment from `dist`; creating a remote repository or publishing remains a user-approved external action at execution time.

```text
1. Serve dist over HTTPS.
2. Open in iPhone Safari, wait for “Готово к офлайн-игре”.
3. Add to Home Screen and launch in landscape.
4. Start a match, fire both weapons, close the app during the next stable turn, reopen, and verify recovery.
5. Enable Airplane Mode, relaunch from the Home Screen, and complete a match.
6. Verify all six aliens, 35-second timer, wind, destruction, falls, CPU termination, camera pan/zoom, and winner screen.
7. Disable Airplane Mode, publish a new build, and verify the active saved match remains loadable.
```

- [ ] **Step 6: Commit**

```bash
git add public src/pwa scripts package.json package-lock.json index.html tests/pwa README.md docs/testing docs/deployment.md
git commit -m "feat: ship installable offline PWA"
```

## Final Verification Gate

- [ ] Run `npm test -- --run` and record the test count with zero failures.
- [ ] Run `npm run build` and verify exit code 0.
- [ ] Run `git status --short` and verify no uncommitted files.
- [ ] Review every requirement in `docs/superpowers/specs/2026-08-08-alien-artillery-design.md` against Tasks 1–11.
- [ ] Record real iPhone model, iOS version, Safari installation result, offline result, and any deferred visual tuning in `docs/testing/iphone-acceptance.md`.
