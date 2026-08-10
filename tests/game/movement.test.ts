import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from '../../src/game/config';
import { isOutsideWorld, stepAlien, tryJump } from '../../src/game/movement';
import { TerrainMask } from '../../src/game/terrain';
import { alien, supportedTerrain } from '../helpers/fixtures';

describe('alien movement', () => {
  it('accelerates walking toward the configured speed', () => {
    const next = stepAlien(alien({ velocity: { x: 0, y: 0 } }), 1, supportedTerrain);

    expect(next.velocity.x).toBeGreaterThan(0);
    expect(next.velocity.x).toBeLessThanOrEqual(GAME_CONFIG.walkSpeedPixelsPerSecond);
    expect(next.position.x).toBeGreaterThan(160);
  });

  it('stops a walking alien before a solid slope', () => {
    const solidAhead = {
      hasSupport: () => true,
      isSolid: (x: number) => x > 160,
    };

    const next = stepAlien(alien(), 1, solidAhead);

    expect(next.position.x).toBe(160);
    expect(next.velocity.x).toBe(0);
  });

  it('stops at the world edge', () => {
    const next = stepAlien(alien({ position: { x: GAME_CONFIG.worldWidth - 1, y: 720 } }), 1, supportedTerrain);

    expect(next.position.x).toBe(GAME_CONFIG.worldWidth - GAME_CONFIG.alienRadius);
    expect(next.velocity.x).toBe(0);
  });

  it.each([
    ['left', 10, -1, -1_000, GAME_CONFIG.alienRadius],
    [
      'right',
      GAME_CONFIG.worldWidth - 10,
      1,
      1_000,
      GAME_CONFIG.worldWidth - GAME_CONFIG.alienRadius,
    ],
  ] as const)(
    'stops and clamps an oversized %s edge crossing without defeat',
    (_edge, x, direction, horizontalVelocity, expectedX) => {
      const next = stepAlien(
        alien({ position: { x, y: 720 }, velocity: { x: horizontalVelocity, y: 0 }, health: 50 }),
        direction,
        supportedTerrain,
        1,
      );

      expect(next.position.x).toBe(expectedX);
      expect(next.velocity.x).toBe(0);
      expect(next.health).toBe(50);
    },
  );

  it('allows only one controlled jump per turn', () => {
    const first = tryJump(alien({ jumpsUsed: 0 }), supportedTerrain);

    expect(first.jumpsUsed).toBe(1);
    expect(first.velocity.y).toBe(GAME_CONFIG.jumpVelocityPixelsPerSecond);
    expect(tryJump(first, supportedTerrain)).toEqual(first);
  });

  it('rejects jumps when unsupported or outside a controllable phase', () => {
    const unsupported = { hasSupport: () => false, isSolid: () => false };
    const current = alien();

    expect(tryJump(current, unsupported)).toEqual(current);
    expect(tryJump(current, supportedTerrain, 'projectile')).toEqual(current);
  });

  it('detects alien positions outside the playable world', () => {
    expect(isOutsideWorld({ x: -1, y: 200 })).toBe(true);
    expect(isOutsideWorld({ x: 200, y: GAME_CONFIG.worldHeight + 1 })).toBe(true);
    expect(isOutsideWorld({ x: 200, y: 200 })).toBe(false);
  });

  it('defeats an alien that falls below the world', () => {
    const next = stepAlien(
      alien({ position: { x: 200, y: GAME_CONFIG.worldHeight + 1 }, health: 50 }),
      0,
      supportedTerrain,
    );

    expect(next.health).toBe(0);
  });

  it('defeats an alien on the tick that crosses below the world boundary', () => {
    const unsupportedTerrain = { hasSupport: () => false, isSolid: () => false };
    const current = alien({
      position: { x: 200, y: GAME_CONFIG.worldHeight - 0.5 },
      velocity: { x: 0, y: 60 },
      health: 50,
    });

    const next = stepAlien(current, 0, unsupportedTerrain);

    expect(current.position.y).toBeLessThanOrEqual(GAME_CONFIG.worldHeight);
    expect(next.position.y).toBeGreaterThan(GAME_CONFIG.worldHeight);
    expect(next.health).toBe(0);
  });

  it('lands a high-speed fall on a one-pixel platform without embedding', () => {
    const terrain = TerrainMask.empty(100, 100);
    for (let x = 20; x <= 80; x += 1) terrain.setSolid(x, 60, true);

    const next = stepAlien(
      alien({ position: { x: 50, y: 20 }, velocity: { x: 0, y: 500 } }),
      0,
      terrain,
      0.1,
    );

    expect(next.position.y).toBe(60 - GAME_CONFIG.alienRadius);
    expect(next.velocity.y).toBe(0);
  });

  it('sweeps the alien radius against a thin wall', () => {
    const terrain = TerrainMask.empty(180, 100);
    for (let x = 0; x < 180; x += 1) terrain.setSolid(x, 80, true);
    for (let y = 0; y < 80; y += 1) terrain.setSolid(80, y, true);

    const next = stepAlien(
      alien({ position: { x: 40, y: 62 }, velocity: { x: 1_000, y: 0 } }),
      1,
      terrain,
      0.1,
    );

    expect(next.position.x).toBeLessThanOrEqual(80 - GAME_CONFIG.alienRadius);
    expect(next.velocity.x).toBe(0);
  });
});
