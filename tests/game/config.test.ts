import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from '../../src/game/config';
import { ENV, matchFixture, projectile } from '../helpers/fixtures';

describe('game configuration', () => {
  it('creates the approved teams with their starting health', () => {
    const match = matchFixture();

    expect(match.aliens.filter(alien => alien.team === 'human')).toHaveLength(GAME_CONFIG.teamSize);
    expect(match.aliens.filter(alien => alien.team === 'cpu')).toHaveLength(GAME_CONFIG.teamSize);
    expect(match.aliens.map(alien => alien.health)).toEqual(
      Array.from({ length: GAME_CONFIG.teamSize * 2 }, () => GAME_CONFIG.startingHealth),
    );
    expect(GAME_CONFIG.teamSize).toBe(3);
    expect(GAME_CONFIG.startingHealth).toBe(100);
  });

  it('locks the approved match timing and world dimensions', () => {
    expect(GAME_CONFIG.humanTurnSeconds).toBe(35);
    expect(GAME_CONFIG.grenadeFuseSeconds).toBe(3);
    expect(GAME_CONFIG.worldWidth).toBe(1600);
    expect(GAME_CONFIG.worldHeight).toBe(900);
    expect(GAME_CONFIG.fixedStepSeconds).toBe(1 / 60);
    expect(GAME_CONFIG.maxSubsteps).toBe(8);
  });

  it('builds grenade and simulation fixtures from the balance configuration', () => {
    const grenade = projectile({ weapon: 'grenade' });
    const fuseSteps = GAME_CONFIG.grenadeFuseSeconds / ENV.fixedStepSeconds;

    expect(grenade.fuseRemaining).toBe(GAME_CONFIG.grenadeFuseSeconds);
    expect(ENV.fixedStepSeconds).toBe(GAME_CONFIG.fixedStepSeconds);
    expect(fuseSteps).toBe(180);
  });

  it('returns independent complete fixture state', () => {
    const first = matchFixture();
    const second = matchFixture();

    first.terrainBytes[0] = 0;
    first.aliens[0]!.health = 1;
    first.events.push({ type: 'damage', alienId: 'human-0', amount: 99 });

    expect(second.terrainBytes[0]).toBe(1);
    expect(second.aliens[0]!.health).toBe(100);
    expect(second.events).toEqual([]);
  });
});
