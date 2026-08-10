import { describe, expect, it } from 'vitest';
import { alien, matchFixture, projectile } from '../helpers/fixtures';
import type { MatchState } from '../../src/game/types';

describe('serializable state validation', () => {
  it('rejects a non-finite alien health value at the factory boundary', () => {
    expect(() => alien({ health: Number.NaN })).toThrow('Alien health must be finite');
  });

  it('rejects a non-finite projectile scalar at the factory boundary', () => {
    expect(() => projectile({ fuseRemaining: Number.POSITIVE_INFINITY }))
      .toThrow('Projectile fuseRemaining must be finite');
  });

  it.each<readonly [string, Partial<MatchState>]>([
    ['seed', { seed: Number.NaN }],
    ['wind', { wind: Number.POSITIVE_INFINITY }],
    ['human timer', { humanTurnSecondsRemaining: Number.NaN }],
    ['dynamic timer', { dynamicSecondsRemaining: Number.NEGATIVE_INFINITY }],
    ['camera', {
      camera: { center: { x: 0, y: 0 }, zoom: Number.NaN, viewport: { x: 1600, y: 900 } },
    }],
    ['terrain width', { terrainWidth: Number.POSITIVE_INFINITY }],
    ['terrain height', { terrainHeight: Number.NaN }],
  ])('rejects a non-finite match %s at the factory boundary', (_field, override) => {
    expect(() => matchFixture(override)).toThrow('must be finite');
  });
});
