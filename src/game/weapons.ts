import { GAME_CONFIG } from './config';
import { clamp, assertFiniteVec2, distance, vec2 } from './math';
import { TerrainMask } from './terrain';
import { assertFiniteAlienState } from './types';
import type { AlienState, ProjectileState, Vec2, WeaponKind } from './types';

export interface ExplosionResolution {
  readonly terrain: TerrainMask;
  readonly aliens: readonly AlienState[];
  readonly removedPixels: number;
}

export function createProjectile(
  weapon: WeaponKind,
  position: Vec2,
  angleRadians: number,
  power: number,
): ProjectileState {
  assertFiniteVec2(position);
  assertFinite('Launch angle', angleRadians);
  assertFinite('Launch power', power);

  const speed = GAME_CONFIG.bazookaMinSpeedPixelsPerSecond
    + (GAME_CONFIG.bazookaMaxSpeedPixelsPerSecond - GAME_CONFIG.bazookaMinSpeedPixelsPerSecond)
      * clamp(power, 0, 1);

  return {
    id: 'projectile',
    ownerId: 'unknown',
    weapon,
    position: vec2(position.x, position.y),
    velocity: vec2(Math.cos(angleRadians) * speed, Math.sin(angleRadians) * speed),
    fuseRemaining: weapon === 'grenade' ? GAME_CONFIG.grenadeFuseSeconds : 0,
    ageSeconds: 0,
  };
}

export function damageAtDistance(maxDamage: number, radius: number, distance: number): number {
  assertNonNegativeFinite('Maximum damage', maxDamage);
  assertNonNegativeFinite('Explosion radius', radius);
  assertNonNegativeFinite('Explosion distance', distance);

  if (radius === 0) return distance === 0 ? maxDamage : 0;
  return maxDamage * (1 - clamp(distance / radius, 0, 1));
}

export function resolveExplosion(
  terrain: TerrainMask,
  aliens: readonly AlienState[],
  center: Vec2,
  radius: number = GAME_CONFIG.explosionRadius,
  maxDamage: number = GAME_CONFIG.maxDamage,
): ExplosionResolution {
  assertFiniteVec2(center);
  assertNonNegativeFinite('Explosion radius', radius);
  assertNonNegativeFinite('Maximum damage', maxDamage);

  const removedPixels = terrain.carveCircle(center, radius);
  const resolvedAliens = aliens.map(alien => resolveAlienExplosion(alien, center, radius, maxDamage));

  return { terrain, aliens: resolvedAliens, removedPixels };
}

function resolveAlienExplosion(
  alien: AlienState,
  center: Vec2,
  radius: number,
  maxDamage: number,
): AlienState {
  assertFiniteAlienState(alien);
  const explosionDistance = distance(center, alien.position);
  const damage = damageAtDistance(maxDamage, radius, explosionDistance);
  const health = clamp(alien.health - damage, 0, GAME_CONFIG.startingHealth);

  if (health === 0 || damage === 0) return { ...alien, health };

  const direction = explosionDistance === 0
    ? vec2(0, -1)
    : vec2(
      (alien.position.x - center.x) / explosionDistance,
      (alien.position.y - center.y) / explosionDistance,
    );

  return {
    ...alien,
    health,
    velocity: vec2(
      alien.velocity.x + direction.x * damage,
      alien.velocity.y + direction.y * damage,
    ),
  };
}

function assertFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
}

function assertNonNegativeFinite(name: string, value: number): void {
  assertFinite(name, value);
  if (value < 0) throw new RangeError(`${name} must be non-negative`);
}
