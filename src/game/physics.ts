import { GAME_CONFIG } from './config';
import { vec2 } from './math';
import type { ProjectileState, Vec2 } from './types';

export interface PhysicsEnvironment {
  readonly gravity: number;
  readonly wind: number;
  readonly fixedStepSeconds?: number;
  readonly worldWidth?: number;
  readonly worldHeight?: number;
}

export type CollisionProbe = (position: Vec2) => boolean;

export type SimulationReason = 'collision' | 'fuse' | 'out-of-bounds' | 'step-limit';

export interface ProjectileSimulation {
  readonly projectile: ProjectileState;
  readonly reason: SimulationReason;
  readonly steps: number;
  readonly trajectory: readonly ProjectileState[];
}

export interface SweepHit {
  readonly impact: Vec2;
  readonly lastFree: Vec2;
}

export function stepProjectile(
  projectile: ProjectileState,
  environment: PhysicsEnvironment,
  dt: number,
): ProjectileState {
  assertPositiveFinite('Step duration', dt);
  assertFinite('Gravity', environment.gravity);
  assertFinite('Wind', environment.wind);

  const windFactor = projectile.weapon === 'grenade' ? GAME_CONFIG.grenadeWindFactor : 1;
  const velocity = vec2(
    projectile.velocity.x + environment.wind * windFactor * dt,
    projectile.velocity.y + environment.gravity * dt,
  );

  return {
    ...projectile,
    position: vec2(
      projectile.position.x + velocity.x * dt,
      projectile.position.y + velocity.y * dt,
    ),
    velocity,
    fuseRemaining: projectile.weapon === 'grenade'
      ? projectile.fuseRemaining - dt
      : projectile.fuseRemaining,
    ageSeconds: projectile.ageSeconds + dt,
  };
}

export function simulateProjectile(
  initial: ProjectileState,
  environment: PhysicsEnvironment,
  probe: CollisionProbe,
  maxSteps: number,
): ProjectileSimulation {
  assertNonNegativeInteger('Maximum steps', maxSteps);
  const dt = environment.fixedStepSeconds ?? GAME_CONFIG.fixedStepSeconds;
  assertPositiveFinite('Fixed step duration', dt);

  let projectile = copyProjectile(initial);
  const trajectory = [projectile];

  for (let steps = 1; steps <= maxSteps; steps += 1) {
    const previous = projectile;
    projectile = stepProjectile(projectile, environment, dt);
    trajectory.push(projectile);

    if (projectile.weapon === 'grenade' && projectile.fuseRemaining <= 0) {
      return result(projectile, 'fuse', steps, trajectory);
    }

    const hit = sweepCollision(previous.position, projectile.position, probe);
    if (hit !== null) {
      if (projectile.weapon === 'bazooka') {
        projectile = { ...projectile, position: hit.impact };
        trajectory[trajectory.length - 1] = projectile;
        return result(projectile, 'collision', steps, trajectory);
      }

      projectile = bounceProjectile({ ...projectile, position: hit.lastFree }, probe, hit.impact);
      trajectory[trajectory.length - 1] = projectile;
    }

    if (isOutOfBounds(projectile.position, environment)) {
      return result(projectile, 'out-of-bounds', steps, trajectory);
    }
  }

  return result(projectile, 'step-limit', maxSteps, trajectory);
}

export function bounceProjectile(
  projectile: ProjectileState,
  probe: CollisionProbe,
  collisionPosition: Vec2 = projectile.position,
): ProjectileState {
  const normal = estimateSurfaceNormal(collisionPosition, projectile.velocity, probe);
  const inwardSpeed = projectile.velocity.x * normal.x + projectile.velocity.y * normal.y;
  const reflected = vec2(
    projectile.velocity.x - 2 * inwardSpeed * normal.x,
    projectile.velocity.y - 2 * inwardSpeed * normal.y,
  );

  return {
    ...projectile,
    velocity: vec2(
      reflected.x * GAME_CONFIG.grenadeRestitution,
      reflected.y * GAME_CONFIG.grenadeRestitution,
    ),
  };
}

export function sweepCollision(
  from: Vec2,
  to: Vec2,
  probe: CollisionProbe,
  maximumSpacing = 0.5,
): SweepHit | null {
  const span = Math.hypot(to.x - from.x, to.y - from.y);
  const steps = Math.max(1, Math.ceil(span / maximumSpacing));
  let lastFree = from;
  for (let step = 1; step <= steps; step += 1) {
    const amount = step / steps;
    const position = vec2(
      from.x + (to.x - from.x) * amount,
      from.y + (to.y - from.y) * amount,
    );
    if (probe(position)) return { impact: position, lastFree };
    lastFree = position;
  }
  return null;
}

function estimateSurfaceNormal(position: Vec2, velocity: Vec2, probe: CollisionProbe): Vec2 {
  const sampleDistance = 1;
  const horizontal = Number(probe(vec2(position.x + sampleDistance, position.y)))
    - Number(probe(vec2(position.x - sampleDistance, position.y)));
  const vertical = Number(probe(vec2(position.x, position.y + sampleDistance)))
    - Number(probe(vec2(position.x, position.y - sampleDistance)));
  const magnitude = Math.hypot(horizontal, vertical);

  if (magnitude > 0) {
    return vec2(-horizontal / magnitude, -vertical / magnitude);
  }

  const speed = Math.hypot(velocity.x, velocity.y);
  return speed > 0 ? vec2(-velocity.x / speed, -velocity.y / speed) : vec2(0, -1);
}

function isOutOfBounds(position: Vec2, environment: PhysicsEnvironment): boolean {
  const worldWidth = environment.worldWidth ?? GAME_CONFIG.worldWidth;
  const worldHeight = environment.worldHeight ?? GAME_CONFIG.worldHeight;

  return position.x < 0 || position.x > worldWidth || position.y < 0 || position.y > worldHeight;
}

function result(
  projectile: ProjectileState,
  reason: SimulationReason,
  steps: number,
  trajectory: readonly ProjectileState[],
): ProjectileSimulation {
  return { projectile, reason, steps, trajectory };
}

function copyProjectile(projectile: ProjectileState): ProjectileState {
  return {
    ...projectile,
    position: vec2(projectile.position.x, projectile.position.y),
    velocity: vec2(projectile.velocity.x, projectile.velocity.y),
  };
}

function assertFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be finite`);
  }
}

function assertPositiveFinite(name: string, value: number): void {
  assertFinite(name, value);
  if (value <= 0) {
    throw new RangeError(`${name} must be positive`);
  }
}

function assertNonNegativeInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer`);
  }
}
