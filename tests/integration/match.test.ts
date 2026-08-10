import { describe, expect, it } from 'vitest';
import { GameController } from '../../src/game/game';
import type { MatchLoadResult } from '../../src/game/storage';
import type { Clock, MatchState } from '../../src/game/types';

class TestClock implements Clock {
  now = 0;

  nowMilliseconds(): number {
    return this.now;
  }
}

class RecordingRepository {
  readonly saved: MatchState[] = [];

  async load(): Promise<MatchLoadResult> {
    return { status: 'empty' };
  }

  async save(match: MatchState): Promise<void> {
    this.saved.push(match);
  }

  async clear(): Promise<void> {}
}

class DelayedRepository extends RecordingRepository {
  saveCalls = 0;
  private releaseSave: (() => void) | undefined;

  constructor(private readonly recovered: MatchState) {
    super();
  }

  override async load(): Promise<{ status: 'loaded'; match: MatchState }> {
    return { status: 'loaded', match: this.recovered };
  }

  override async save(match: MatchState): Promise<void> {
    this.saveCalls += 1;
    await new Promise<void>(resolve => { this.releaseSave = resolve; });
    await super.save(match);
  }

  release(): void {
    this.releaseSave?.();
  }
}

function testGame(seed = 7): { game: GameController; repository: RecordingRepository; clock: TestClock } {
  const repository = new RecordingRepository();
  const clock = new TestClock();
  const game = GameController.create({ repository, clock, isVisible: () => true });
  game.startNewMatch(seed);
  return { game, repository, clock };
}

function clampedCameraTarget(match: MatchState, target: { x: number; y: number }): { x: number; y: number } {
  const halfWidth = match.camera.viewport.x / (2 * match.camera.zoom);
  const halfHeight = match.camera.viewport.y / (2 * match.camera.zoom);
  return {
    x: Math.min(Math.max(target.x, halfWidth - 24), 1600 - halfWidth + 24),
    y: Math.min(Math.max(target.y, halfHeight - 24), 900 - halfHeight + 24),
  };
}

async function tickUntil(
  game: GameController,
  clock: TestClock,
  predicate: () => boolean,
  maximumTicks = 2_000,
): Promise<void> {
  for (let tick = 0; tick < maximumTicks && !predicate(); tick += 1) {
    clock.now += 1000 / 60;
    await game.tick(1 / 60);
  }
  expect(predicate()).toBe(true);
}

describe('integrated match controller', () => {
  it('drives a deterministic three-versus-three match to a winner using only commands and ticks', async () => {
    const source = testGame(36).game;
    const terminalScenario = structuredClone(source.state!);
    const bytes = new Uint8Array(1_600 * 900);
    bytes.fill(1, 800 * 1_600, 801 * 1_600);
    terminalScenario.terrainBytes = bytes;
    terminalScenario.terrainWidth = 1_600;
    terminalScenario.terrainHeight = 900;
    terminalScenario.aliens = terminalScenario.aliens.map((candidate, index) => ({
      ...candidate,
      position: candidate.team === 'human'
        ? { x: index === 0 ? 100 : 20 + index * 30, y: 782 }
        : { x: 500 + (index - 3) * 10, y: 782 },
      velocity: { x: 0, y: 0 },
      health: candidate.team === 'cpu' ? 1 : 100,
    }));
    const repository = {
      async load() { return { status: 'loaded' as const, match: terminalScenario }; },
      async save(_match: MatchState) {},
      async clear() {},
    };
    const clock = new TestClock();
    const game = GameController.create({ repository, clock, isVisible: () => true });
    await game.resume();

    game.dispatch({ type: 'aim', angleRadians: -0.22 });
    game.dispatch({ type: 'fire', power: 1 });
    for (let tick = 0; tick < 2_000 && game.state?.phase !== 'complete'; tick += 1) {
      clock.now += 1000 / 60;
      await game.tick(1 / 60);
    }

    expect({
      phase: game.state?.phase,
      winner: game.state?.winner,
      health: game.state?.aliens.map(alien => alien.health),
    }).toEqual({ phase: 'complete', winner: 'human', health: [100, 100, 100, 0, 0, 0] });
    expect(game.state?.aliens.filter(alien => alien.team === 'cpu').every(alien => alien.health === 0)).toBe(true);
  });
  it('wires CPU search batches to the cooperative browser yield dependency', async () => {
    const source = testGame(35).game;
    const cpuReady = structuredClone(source.state!);
    cpuReady.activeTeam = 'cpu';
    const repository = {
      async load() { return { status: 'loaded' as const, match: cpuReady }; },
      async save(_match: MatchState) {},
      async clear() {},
    };
    let yields = 0;
    const game = GameController.create({
      repository,
      clock: new TestClock(),
      isVisible: () => true,
      yieldToBrowser: async () => { yields += 1; },
    });
    await game.resume();

    await game.tick(1 / 60);
    await Promise.resolve();

    expect(yields).toBeGreaterThan(0);
  });

  it('preserves a viewport update that arrives while CPU reposition search is yielding', async () => {
    const source = testGame(37).game;
    const cpuReady = structuredClone(source.state!);
    cpuReady.activeTeam = 'cpu';
    const repository = {
      async load() { return { status: 'loaded' as const, match: cpuReady }; },
      async save(_match: MatchState) {},
      async clear() {},
    };
    let releaseSearch: (() => void) | undefined;
    const searchGate = new Promise<void>(resolve => { releaseSearch = resolve; });
    const game = GameController.create({
      repository,
      clock: new TestClock(),
      isVisible: () => true,
      viewport: { x: 844, y: 390 },
      chooseAiDecision: async () => {
        await searchGate;
        return {
          command: {
            type: 'fire', weapon: 'bazooka', angleRadians: -2.4, power: 0.6,
            repositionDirection: -1, repositionDistance: 15,
          },
          simulations: 40,
          predictedDamage: { enemy: 10, friendly: 0, self: 0 },
        };
      },
    });
    await game.resume();

    await game.tick(1 / 60);
    game.setViewport({ x: 390, y: 844 });
    releaseSearch!();
    for (let turn = 0; turn < 5 && game.state?.phase === 'ready'; turn += 1) await Promise.resolve();

    expect(game.state?.phase).toBe('projectile');
    expect(game.state?.camera.viewport).toEqual({ x: 390, y: 844 });
  });
  it('reuses one terrain snapshot across renders until an explosion mutates terrain', async () => {
    const terrainFrames: unknown[] = [];
    const renderer = { render: (_match: MatchState, terrain: unknown) => terrainFrames.push(terrain) };
    const repository = new RecordingRepository();
    const clock = new TestClock();
    const game = GameController.create({ repository, clock, isVisible: () => true, renderer });
    game.startNewMatch(34);

    game.render();
    game.render();
    expect(terrainFrames[1]).toBe(terrainFrames[0]);

    game.dispatch({ type: 'aim', angleRadians: Math.PI / 2 });
    game.dispatch({ type: 'fire', power: 0 });
    await tickUntil(game, clock, () => game.state?.events.some(event => event.type === 'explosion') === true, 600);
    game.render();

    expect(terrainFrames.at(-1)).not.toBe(terrainFrames[0]);
  });
  it('completes a simultaneous team knockout as a draw', async () => {
    const source = testGame(31).game;
    const drawBoundary = structuredClone(source.state!);
    drawBoundary.phase = 'settling';
    drawBoundary.dynamicSecondsRemaining = 0;
    drawBoundary.aliens = drawBoundary.aliens.map(candidate => ({ ...candidate, health: 0 }));
    const repository = {
      saved: [] as MatchState[],
      async load() { return { status: 'loaded' as const, match: drawBoundary }; },
      async save(match: MatchState) { this.saved.push(match); },
      async clear() {},
    };
    const clock = new TestClock();
    const game = GameController.create({ repository, clock, isVisible: () => true });
    await game.resume();

    await game.tick(1 / 60);

    expect(game.state?.phase).toBe('complete');
    expect(game.state?.winner).toBe('draw');
  });

  it('ends a controllable turn immediately when its active alien is defeated', async () => {
    const source = testGame(32).game;
    const deadActive = structuredClone(source.state!);
    deadActive.aliens[0] = { ...deadActive.aliens[0]!, health: 0 };
    const repository = {
      async load() { return { status: 'loaded' as const, match: deadActive }; },
      async save(_match: MatchState) {},
      async clear() {},
    };
    const clock = new TestClock();
    const game = GameController.create({ repository, clock, isVisible: () => true });
    await game.resume();

    game.dispatch({ type: 'fire', power: 1 });
    await game.tick(1 / 60);

    expect(game.state?.phase).not.toBe('ready');
    expect(game.state?.projectile).toBeNull();
  });

  it('sweeps the live projectile through thin terrain between fixed steps', async () => {
    const source = testGame(33).game;
    const activeShot = structuredClone(source.state!);
    const bytes = new Uint8Array(1_600 * 900);
    bytes[100 * 1_600 + 105] = 1;
    bytes[101 * 1_600 + 105] = 1;
    activeShot.terrainBytes = bytes;
    activeShot.terrainWidth = 1_600;
    activeShot.terrainHeight = 900;
    activeShot.phase = 'projectile';
    activeShot.projectile = {
      id: 'projectile-0',
      ownerId: 'human-0',
      weapon: 'bazooka',
      position: { x: 100, y: 100 },
      velocity: { x: 600, y: 0 },
      fuseRemaining: 0,
      ageSeconds: 1,
    };
    const repository = {
      async load() { return { status: 'loaded' as const, match: activeShot }; },
      async save(_match: MatchState) {},
      async clear() {},
    };
    const clock = new TestClock();
    const game = GameController.create({ repository, clock, isVisible: () => true });
    await game.resume();

    await game.tick(1 / 60);

    expect(game.state?.phase).toBe('settling');
    expect(game.state?.events.some(event => event.type === 'explosion')).toBe(true);
  });

  it('walks continuously while a movement command is held and stops after release', async () => {
    const { game, clock } = testGame();
    const startX = game.state!.aliens[0]!.position.x;

    game.dispatch({ type: 'move', direction: 1 });
    for (let tick = 0; tick < 30; tick += 1) {
      clock.now += 1000 / 60;
      await game.tick(1 / 60);
    }
    const heldX = game.state!.aliens[0]!.position.x;
    game.dispatch({ type: 'move', direction: 0 });
    for (let tick = 0; tick < 30; tick += 1) {
      clock.now += 1000 / 60;
      await game.tick(1 / 60);
    }

    expect(heldX - startX).toBeGreaterThan(20);
    expect(game.state!.aliens[0]!.position.x - heldX).toBeLessThan(8);
  });

  it('reconciles live viewport changes and starts focused on the active alien', () => {
    const repository = new RecordingRepository();
    const clock = new TestClock();
    const game = GameController.create({
      repository,
      clock,
      isVisible: () => true,
      viewport: { x: 844, y: 390 },
    });

    game.startNewMatch(7);
    expect(game.state!.camera.center.x).toBeLessThan(600);
    game.setViewport({ x: 390, y: 844 });

    expect(game.state!.camera.viewport).toEqual({ x: 390, y: 844 });
  });

  it('automatically follows a projectile after preserving the initial active view', async () => {
    const repository = new RecordingRepository();
    const clock = new TestClock();
    const game = GameController.create({
      repository,
      clock,
      isVisible: () => true,
      viewport: { x: 844, y: 390 },
    });
    game.startNewMatch(7);
    const initialCenter = game.state!.camera.center.x;
    game.dispatch({ type: 'aim', angleRadians: 0 });
    game.dispatch({ type: 'fire', power: 1 });

    for (let tick = 0; tick < 20; tick += 1) {
      clock.now += 1000 / 60;
      await game.tick(1 / 60);
    }

    expect(game.state!.camera.center.x).toBeGreaterThan(initialCenter);
  });

  it('centers the explosion and then the next active fighter', async () => {
    const clock = new TestClock();
    const game = GameController.create({
      repository: new RecordingRepository(),
      clock,
      isVisible: () => true,
      viewport: { x: 844, y: 390 },
    });
    game.startNewMatch(7);
    game.dispatch({ type: 'aim', angleRadians: -0.2 });
    game.dispatch({ type: 'fire', power: 0.35 });

    await tickUntil(game, clock, () => game.state?.phase === 'settling', 600);
    const explosion = game.state!.events.find(event => event.type === 'explosion');
    expect(explosion?.type).toBe('explosion');
    if (explosion?.type !== 'explosion') throw new Error('Expected explosion event');
    expect(game.state!.camera.center).toEqual(clampedCameraTarget(game.state!, explosion.position));

    await tickUntil(game, clock, () => game.state?.phase === 'ready' && game.state.activeTeam === 'cpu', 240);
    const nextActive = game.state!.aliens.filter(alien => alien.team === 'cpu')[game.state!.activeAlienIndex.cpu]!;
    expect(game.state!.camera.center).toEqual(clampedCameraTarget(game.state!, nextActive.position));
  });

  it('keeps a command-driven match deterministic through a complete human turn', async () => {
    const left = testGame(7);
    const right = testGame(7);
    const shot = { type: 'fire', power: 0.35 } as const;

    left.game.dispatch({ type: 'aim', angleRadians: -0.2 });
    right.game.dispatch({ type: 'aim', angleRadians: -0.2 });
    left.game.dispatch(shot);
    right.game.dispatch(shot);

    await tickUntil(left.game, left.clock, () => left.game.state?.activeTeam === 'cpu' && left.game.state.phase === 'ready', 600);
    await tickUntil(right.game, right.clock, () => right.game.state?.activeTeam === 'cpu' && right.game.state.phase === 'ready', 600);

    expect(left.game.state).toEqual(right.game.state);
  }, 10_000);

  it('saves only after a projectile has settled', async () => {
    const { game, repository, clock } = testGame();

    game.dispatch({ type: 'fire', power: 0 });
    clock.now += 1000 / 60;
    await game.tick(1 / 60);

    expect(game.state?.phase).toBe('projectile');
    expect(repository.saved).toHaveLength(0);

    await tickUntil(game, clock, () => repository.saved.length === 1);
    expect(game.state?.phase).not.toBe('projectile');
  });

  it('bounces a grenade on terrain and detonates only after its fuse expires', async () => {
    const { game, clock } = testGame();

    game.dispatch({ type: 'select-weapon', weapon: 'grenade' });
    game.dispatch({ type: 'aim', angleRadians: Math.PI / 2 });
    game.dispatch({ type: 'fire', power: 0 });
    for (let tick = 0; tick < 12; tick += 1) {
      clock.now += 1000 / 60;
      await game.tick(1 / 60);
    }

    expect(game.state?.phase).toBe('projectile');
    expect(game.state?.projectile?.fuseRemaining).toBeLessThan(3);
    expect(game.state?.projectile?.fuseRemaining).toBeGreaterThan(0);
    expect(game.state?.projectile?.velocity.y).toBeLessThan(0);

    await tickUntil(game, clock, () => game.state?.phase === 'settling', 240);
    expect(game.state?.events.some(event => event.type === 'explosion')).toBe(true);
  });

  it('saves a settled boundary exactly once while an earlier save is pending', async () => {
    const source = GameController.create({ repository: new RecordingRepository(), clock: new TestClock(), isVisible: () => true });
    source.startNewMatch(8);
    const settled = structuredClone(source.state!);
    settled.phase = 'settling';
    settled.dynamicSecondsRemaining = 0;
    const repository = new DelayedRepository(settled);
    const clock = new TestClock();
    const game = GameController.create({ repository, clock, isVisible: () => true });
    await game.resume();

    const first = game.tick(1 / 60);
    const second = game.tick(1 / 60);
    await Promise.resolve();
    await Promise.resolve();

    expect(repository.saveCalls).toBe(1);
    repository.release();
    await Promise.all([first, second]);
    expect(repository.saved).toHaveLength(1);
  });

  it('advances through a real human shot and CPU turn using only commands and ticks', async () => {
    const { game, clock } = testGame(12);

    game.dispatch({ type: 'aim', angleRadians: -0.2 });
    game.dispatch({ type: 'fire', power: 0.35 });

    await tickUntil(game, clock, () => game.state?.activeTeam === 'cpu' && game.state.phase === 'ready', 600);
    expect(game.state?.turnNumber).toBe(1);
  });

  it('pauses the human turn timer while hidden', async () => {
    const repository = new RecordingRepository();
    const clock = new TestClock();
    let visible = false;
    const game = GameController.create({ repository, clock, isVisible: () => visible });
    game.startNewMatch(4);
    const remaining = game.state!.humanTurnSecondsRemaining;

    clock.now += 10_000;
    await game.tick(10);
    expect(game.state!.humanTurnSecondsRemaining).toBe(remaining);

    visible = true;
    clock.now += 1000 / 60;
    await game.tick(1 / 60);
    expect(game.state!.humanTurnSecondsRemaining).toBeLessThan(remaining);
  });
});
