import { GAME_CONFIG } from './config';
import type { TerrainProbe } from './terrain';
import type { AlienState, TurnPhase, Vec2 } from './types';

const WALK_ACCELERATION = GAME_CONFIG.walkSpeedPixelsPerSecond * 8;

export function stepAlien(
  alien: AlienState,
  direction: -1 | 0 | 1,
  terrain: TerrainProbe,
  seconds = GAME_CONFIG.fixedStepSeconds,
): AlienState {
  if (hasFallenBelowWorld(alien.position)) return { ...alien, health: 0 };

  const position = depenetrate(alien.position, terrain);
  const supported = terrain.hasSupport(position, GAME_CONFIG.alienRadius);
  const horizontalVelocity = approach(
    alien.velocity.x,
    direction * GAME_CONFIG.walkSpeedPixelsPerSecond,
    WALK_ACCELERATION * seconds,
  );
  const verticalVelocity = supported && alien.velocity.y >= 0
    ? 0
    : alien.velocity.y + GAME_CONFIG.gravityPixelsPerSecondSquared * seconds;
  const horizontal = sweepHorizontal(position, horizontalVelocity * seconds, terrain);
  const stoppedHorizontally = horizontal.x !== position.x + horizontalVelocity * seconds;
  const landingY = verticalVelocity >= 0
    ? firstSupportY(
      terrain,
      horizontal.x,
      position.y + GAME_CONFIG.alienRadius,
      position.y + verticalVelocity * seconds + GAME_CONFIG.alienRadius,
      GAME_CONFIG.alienRadius,
    )
    : null;
  const vertical = landingY === null
    ? sweepUpward(horizontal, verticalVelocity * seconds, terrain)
    : { x: horizontal.x, y: landingY - GAME_CONFIG.alienRadius };
  const candidate = vertical;
  if (hasFallenBelowWorld(candidate)) {
    return {
      ...alien,
      position: candidate,
      velocity: { x: stoppedHorizontally ? 0 : horizontalVelocity, y: verticalVelocity },
      health: 0,
    };
  }
  const atWorldEdge = candidate.x < GAME_CONFIG.alienRadius
    || candidate.x > GAME_CONFIG.worldWidth - GAME_CONFIG.alienRadius;
  const blocked = atWorldEdge;

  if (blocked) {
    return {
      ...alien,
      position: {
        x: clampWorldX(alien.position.x),
        y: alien.position.y,
      },
      velocity: { x: 0, y: landingY === null ? verticalVelocity : 0 },
    };
  }

  return {
    ...alien,
    position: candidate,
    velocity: {
      x: stoppedHorizontally ? 0 : horizontalVelocity,
      y: landingY === null ? verticalVelocity : 0,
    },
  };
}

export function tryJump(
  alien: AlienState,
  terrain: TerrainProbe,
  phase: TurnPhase = 'ready',
): AlienState {
  if ((phase !== 'ready' && phase !== 'aiming')
    || alien.jumpsUsed !== 0
    || !terrain.hasSupport(alien.position, GAME_CONFIG.alienRadius)) {
    return alien;
  }

  return {
    ...alien,
    velocity: { ...alien.velocity, y: GAME_CONFIG.jumpVelocityPixelsPerSecond },
    jumpsUsed: 1,
  };
}

export function isOutsideWorld(position: Vec2): boolean {
  return position.x < 0
    || position.x > GAME_CONFIG.worldWidth
    || position.y < 0
    || position.y > GAME_CONFIG.worldHeight;
}

function approach(value: number, target: number, maximumDelta: number): number {
  if (value < target) return Math.min(value + maximumDelta, target);
  if (value > target) return Math.max(value - maximumDelta, target);
  return target;
}

function clampWorldX(x: number): number {
  return Math.min(Math.max(x, GAME_CONFIG.alienRadius), GAME_CONFIG.worldWidth - GAME_CONFIG.alienRadius);
}

function hasFallenBelowWorld(position: Vec2): boolean {
  return position.y > GAME_CONFIG.worldHeight;
}

function depenetrate(position: Vec2, terrain: TerrainProbe): Vec2 {
  if (!circleBlocked(position, terrain)) return position;
  for (let offset = 1; offset <= GAME_CONFIG.alienRadius * 2; offset += 1) {
    const candidate = { x: position.x, y: position.y - offset };
    if (!circleBlocked(candidate, terrain)) return candidate;
  }
  return position;
}

function sweepHorizontal(position: Vec2, deltaX: number, terrain: TerrainProbe): Vec2 {
  const steps = Math.max(1, Math.ceil(Math.abs(deltaX)));
  let current = position;
  for (let step = 1; step <= steps; step += 1) {
    const candidate = { ...position, x: position.x + deltaX * step / steps };
    if (circleBlocked(candidate, terrain)) return current;
    current = candidate;
  }
  return current;
}

function sweepUpward(position: Vec2, deltaY: number, terrain: TerrainProbe): Vec2 {
  if (deltaY >= 0) return { ...position, y: position.y + deltaY };
  const steps = Math.max(1, Math.ceil(Math.abs(deltaY)));
  let current = position;
  for (let step = 1; step <= steps; step += 1) {
    const candidate = { ...position, y: position.y + deltaY * step / steps };
    if (circleBlocked(candidate, terrain)) return current;
    current = candidate;
  }
  return current;
}

function firstSupportY(
  terrain: TerrainProbe,
  centerX: number,
  startFootY: number,
  endFootY: number,
  radius: number,
): number | null {
  if (endFootY < startFootY) return null;
  for (let y = Math.ceil(startFootY); y <= Math.ceil(endFootY); y += 1) {
    if ([-0.65, 0, 0.65].some(offset => terrain.isSolid(Math.round(centerX + offset * radius), y))) {
      return y;
    }
  }
  return null;
}

function circleBlocked(position: Vec2, terrain: TerrainProbe): boolean {
  const radius = GAME_CONFIG.alienRadius - 1;
  for (let y = -radius; y <= 0; y += 1) {
    const halfWidth = Math.floor(Math.sqrt(radius * radius - y * y));
    if (terrain.isSolid(Math.round(position.x - halfWidth), Math.round(position.y + y))
      || terrain.isSolid(Math.round(position.x + halfWidth), Math.round(position.y + y))) {
      return true;
    }
  }
  return false;
}
