import { describe, expect, it } from 'vitest';
import { createProjectile, damageAtDistance, resolveExplosion } from '../../src/game/weapons';
import { TerrainMask } from '../../src/game/terrain';
import { ORIGIN, alien } from '../helpers/fixtures';

describe('weapons', () => {
  it('gives a grenade an exact three-second fuse', () => {
    expect(createProjectile('grenade', ORIGIN, Math.PI / 4, 0.5).fuseRemaining)
      .toBe(3);
  });

  it('derives a clamped-power launch velocity from the aiming angle', () => {
    const maximumPower = createProjectile('bazooka', ORIGIN, 0, 2);
    const minimumPower = createProjectile('bazooka', ORIGIN, Math.PI / 2, -1);

    expect(maximumPower.velocity).toEqual({ x: 620, y: 0 });
    expect(minimumPower.velocity.x).toBeCloseTo(0);
    expect(minimumPower.velocity.y).toBe(220);
  });

  it('applies maximum center damage and zero edge damage', () => {
    expect(damageAtDistance(60, 50, 0)).toBe(60);
    expect(damageAtDistance(60, 50, 50)).toBe(0);
  });

  it('carves terrain and applies friendly-fire damage from pre-knockback positions', () => {
    const terrain = TerrainMask.filled(20, 20);
    const centered = alien({ id: 'human-0', position: { x: 10, y: 10 }, velocity: { x: 1, y: 2 } });
    const edge = alien({
      id: 'cpu-0',
      team: 'cpu',
      position: { x: 14, y: 10 },
      velocity: { x: 3, y: 4 },
      health: 130,
    });
    const defeated = alien({ id: 'human-1', position: { x: 10, y: 10 }, health: 50, velocity: { x: 5, y: 6 } });

    const result = resolveExplosion(terrain, [centered, edge, defeated], { x: 10, y: 10 }, 4, 60);

    expect(result.terrain).toBe(terrain);
    expect(result.removedPixels).toBe(49);
    expect(terrain.isSolid(10, 10)).toBe(false);
    expect(result.aliens).toHaveLength(3);
    expect(result.aliens[0]).toMatchObject({ health: 40, position: { x: 10, y: 10 } });
    expect(result.aliens[1]).toMatchObject({ health: 100, velocity: { x: 3, y: 4 } });
    expect(result.aliens[2]).toMatchObject({ health: 0, velocity: { x: 5, y: 6 } });
    expect(Number.isFinite(result.aliens[0]!.velocity.x)).toBe(true);
    expect(Number.isFinite(result.aliens[0]!.velocity.y)).toBe(true);
    expect(result.aliens[0]!.velocity).toEqual({ x: 1, y: -58 });
    expect(centered).toEqual(alien({ id: 'human-0', position: { x: 10, y: 10 }, velocity: { x: 1, y: 2 } }));
  });

  it('applies the same in-radius damage to human and CPU fighters', () => {
    const terrain = TerrainMask.empty(30, 30);
    const human = alien({ id: 'human-0', team: 'human', position: { x: 12, y: 15 } });
    const cpu = alien({ id: 'cpu-0', team: 'cpu', position: { x: 18, y: 15 } });

    const result = resolveExplosion(terrain, [human, cpu], { x: 15, y: 15 }, 10, 60);

    expect(result.aliens[0]!.health).toBe(result.aliens[1]!.health);
    expect(result.aliens[0]!.health).toBeLessThan(100);
  });

  it('rejects non-finite public numeric inputs before deriving weapon state', () => {
    const terrain = TerrainMask.empty(2, 2);

    expect(() => createProjectile('bazooka', ORIGIN, 0, Number.NaN))
      .toThrow('Launch power must be finite');
    expect(() => damageAtDistance(60, Number.POSITIVE_INFINITY, 0))
      .toThrow('Explosion radius must be finite');
    expect(() => resolveExplosion(terrain, [], ORIGIN, 1, Number.NaN))
      .toThrow('Maximum damage must be finite');
  });
});
