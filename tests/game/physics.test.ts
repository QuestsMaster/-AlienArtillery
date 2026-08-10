import { describe, expect, it } from 'vitest';
import { simulateProjectile, stepProjectile } from '../../src/game/physics';
import { ENV, projectile } from '../helpers/fixtures';

describe('fixed-step projectile physics', () => {
  it('applies gravity and bazooka wind at a fixed step', () => {
    const next = stepProjectile(
      projectile({ velocity: { x: 10, y: -5 } }),
      { gravity: 20, wind: 2 },
      0.05,
    );

    expect(next.velocity.x).toBeCloseTo(10.1);
    expect(next.velocity.y).toBeCloseTo(-4);
    expect(next.position).toEqual({ x: 0.505, y: -0.2 });
    expect(next.ageSeconds).toBeCloseTo(0.05);
  });

  it('scales wind acceleration for grenades', () => {
    const next = stepProjectile(
      projectile({ weapon: 'grenade', velocity: { x: 10, y: 0 } }),
      { gravity: 0, wind: 20 },
      0.1,
    );

    expect(next.velocity.x).toBeCloseTo(10.7);
  });

  it('stops a bazooka simulation at the first terrain hit', () => {
    const result = simulateProjectile(projectile(), ENV, position => position.x >= 5, 600);

    expect(result.reason).toBe('collision');
    expect(result.steps).toBeLessThan(600);
    expect(result.projectile.position.x).toBeGreaterThanOrEqual(5);
  });

  it('bounces a grenade off terrain and continues its fuse', () => {
    const result = simulateProjectile(
      projectile({
        weapon: 'grenade',
        position: { x: 0, y: 10 },
        velocity: { x: 0, y: 10 },
        fuseRemaining: 0.5,
      }),
      { gravity: 0, wind: 0, fixedStepSeconds: 0.1, worldHeight: 100 },
      position => position.y >= 11,
      2,
    );

    expect(result.reason).toBe('step-limit');
    expect(result.steps).toBe(2);
    expect(result.projectile.velocity.y).toBeCloseTo(-5.5);
    expect(result.projectile.fuseRemaining).toBeCloseTo(0.3);
  });

  it('detonates a grenade when its fuse expires', () => {
    const result = simulateProjectile(
      projectile({ weapon: 'grenade', velocity: { x: 0, y: 0 }, fuseRemaining: 0.1 }),
      { gravity: 0, wind: 0, fixedStepSeconds: 0.1 },
      () => false,
      10,
    );

    expect(result.reason).toBe('fuse');
    expect(result.steps).toBe(1);
  });

  it('stops when a projectile leaves the world bounds', () => {
    const result = simulateProjectile(
      projectile({ position: { x: 9, y: 5 }, velocity: { x: 20, y: 0 } }),
      { gravity: 0, wind: 0, fixedStepSeconds: 0.1, worldWidth: 10, worldHeight: 10 },
      () => false,
      10,
    );

    expect(result.reason).toBe('out-of-bounds');
    expect(result.steps).toBe(1);
  });

  it('returns the same trajectory for repeated deterministic simulations', () => {
    const initial = projectile({ velocity: { x: 12, y: -4 } });
    const environment = { gravity: 20, wind: -3, fixedStepSeconds: 0.05 };

    expect(simulateProjectile(initial, environment, () => false, 4))
      .toEqual(simulateProjectile(initial, environment, () => false, 4));
  });

  it('terminates after the configured maximum number of steps', () => {
    const result = simulateProjectile(
      projectile({ position: { x: 100, y: 100 }, velocity: { x: 0, y: 0 } }),
      { gravity: 0, wind: 0, fixedStepSeconds: 0.1 },
      () => false,
      3,
    );

    expect(result.reason).toBe('step-limit');
    expect(result.steps).toBe(3);
  });

  it('sweeps a high-speed projectile across a one-pixel obstacle', () => {
    const result = simulateProjectile(
      projectile({ position: { x: 0, y: 5 }, velocity: { x: 100, y: 0 } }),
      { gravity: 0, wind: 0, fixedStepSeconds: 0.1, worldWidth: 20, worldHeight: 10 },
      position => position.x >= 5 && position.x < 6,
      2,
    );

    expect(result.reason).toBe('collision');
    expect(result.steps).toBe(1);
    expect(result.projectile.position.x).toBeGreaterThanOrEqual(5);
    expect(result.projectile.position.x).toBeLessThan(6);
  });

  it('depenetrates a grenade before reflecting it from terrain', () => {
    const probe = (position: { y: number }) => position.y >= 1;
    const result = simulateProjectile(
      projectile({
        weapon: 'grenade',
        position: { x: 0, y: 0 },
        velocity: { x: 0, y: 10 },
        fuseRemaining: 1,
      }),
      { gravity: 0, wind: 0, fixedStepSeconds: 0.1 },
      probe,
      1,
    );

    expect(probe(result.projectile.position)).toBe(false);
    expect(result.projectile.velocity.y).toBeLessThan(0);
  });
});
