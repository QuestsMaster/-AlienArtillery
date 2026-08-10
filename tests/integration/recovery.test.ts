import { describe, expect, it } from 'vitest';
import { GameController } from '../../src/game/game';
import type { Clock, MatchState } from '../../src/game/types';

class StaticClock implements Clock {
  nowMilliseconds(): number {
    return 0;
  }
}

class InvalidRepository {
  cleared = false;

  async load(): Promise<{ status: 'invalid' }> {
    return { status: 'invalid' };
  }

  async save(_match: MatchState): Promise<void> {}

  async clear(): Promise<void> {
    this.cleared = true;
  }
}

class LoadedRepository {
  constructor(private readonly match: MatchState) {}

  async load(): Promise<{ status: 'loaded'; match: MatchState }> {
    return { status: 'loaded', match: this.match };
  }

  async save(_match: MatchState): Promise<void> {}

  async clear(): Promise<void> {}
}

describe('match recovery', () => {
  it('turns an IndexedDB load rejection into a recoverable startup result', async () => {
    const warnings: string[] = [];
    const repository = {
      async load(): Promise<never> { throw new Error('open failed'); },
      async save(_match: MatchState) {},
      async clear() {},
    };
    const game = GameController.create({
      repository,
      clock: new StaticClock(),
      isVisible: () => true,
      onPersistenceError: operation => warnings.push(operation),
    });

    await expect(game.resume()).resolves.toEqual({ status: 'error' });
    expect(game.state).toBeNull();
    expect(warnings).toEqual(['load']);
  });

  it('keeps the match playable and reports save and clear failures', async () => {
    const warnings: string[] = [];
    const repository = {
      async load() { return { status: 'empty' as const }; },
      async save(_match: MatchState): Promise<never> { throw new Error('write failed'); },
      async clear(): Promise<never> { throw new Error('delete failed'); },
    };
    const game = GameController.create({
      repository,
      clock: new StaticClock(),
      isVisible: () => true,
      onPersistenceError: operation => warnings.push(operation),
    });
    game.startNewMatch(25);

    await expect(game.pause()).resolves.toBeUndefined();
    await expect(game.clearDamagedSave()).resolves.toBe(false);

    expect(game.state?.phase).toBe('ready');
    expect(warnings).toEqual(['save', 'clear']);
  });
  it('presents invalid recovery as a recoverable state and can clear the damaged save', async () => {
    const repository = new InvalidRepository();
    const game = GameController.create({ repository, clock: new StaticClock(), isVisible: () => true });

    await expect(game.resume()).resolves.toEqual({ status: 'invalid' });
    expect(game.state).toBeNull();
    expect(game.canActivatePwaUpdate()).toBe(true);

    await game.clearDamagedSave();
    expect(repository.cleared).toBe(true);
  });

  it('keeps a PWA update inactive during an unfinished match', () => {
    const repository = new InvalidRepository();
    const game = GameController.create({ repository, clock: new StaticClock(), isVisible: () => true });

    game.startNewMatch(1);

    expect(game.canActivatePwaUpdate()).toBe(false);
  });

  it('restores a normal saved match into a playable controller', async () => {
    const source = GameController.create({
      repository: new InvalidRepository(),
      clock: new StaticClock(),
      isVisible: () => true,
    });
    source.startNewMatch(23);
    const saved = structuredClone(source.state!);
    const game = GameController.create({
      repository: new LoadedRepository(saved),
      clock: new StaticClock(),
      isVisible: () => true,
    });

    await expect(game.resume()).resolves.toEqual({ status: 'loaded', match: saved });
    game.dispatch({ type: 'aim', angleRadians: -0.4 });

    expect(game.state?.phase).toBe('aiming');
    expect(game.state?.seed).toBe(23);
  });

  it('reconciles a restored camera with the current device viewport', async () => {
    const source = GameController.create({
      repository: new InvalidRepository(),
      clock: new StaticClock(),
      isVisible: () => true,
      viewport: { x: 1_600, y: 900 },
    });
    source.startNewMatch(24);
    const saved = structuredClone(source.state!);
    const game = GameController.create({
      repository: new LoadedRepository(saved),
      clock: new StaticClock(),
      isVisible: () => true,
      viewport: { x: 852, y: 393 },
    });

    await game.resume();

    expect(game.state?.camera.viewport).toEqual({ x: 852, y: 393 });
  });
});
