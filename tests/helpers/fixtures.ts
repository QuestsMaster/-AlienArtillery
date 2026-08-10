import { GAME_CONFIG } from '../../src/game/config';
import { vec2 } from '../../src/game/math';
import {
  assertFiniteAlienState,
  assertFiniteMatchState,
  assertFiniteProjectileState,
} from '../../src/game/types';
import type { AlienState, GameEvent, MatchState, ProjectileState, Vec2 } from '../../src/game/types';

export const ORIGIN = vec2(0, 0);

export const ENV = {
  gravity: GAME_CONFIG.gravityPixelsPerSecondSquared,
  wind: 0,
  fixedStepSeconds: GAME_CONFIG.fixedStepSeconds,
};

export interface TerrainFixture {
  hasSupport(position: Vec2, footRadius: number): boolean;
  isSolid(x: number, y: number): boolean;
}

export const supportedTerrain: TerrainFixture = {
  hasSupport: () => true,
  isSolid: () => false,
};

export function alien(overrides: Partial<AlienState> = {}): AlienState {
  return assertFiniteAlienState({
    id: overrides.id ?? 'human-0',
    team: overrides.team ?? 'human',
    position: copyVector(overrides.position ?? { x: 160, y: 720 }),
    velocity: copyVector(overrides.velocity ?? ORIGIN),
    health: overrides.health ?? GAME_CONFIG.startingHealth,
    aimRadians: overrides.aimRadians ?? 0,
    jumpsUsed: overrides.jumpsUsed ?? 0,
  });
}

export function projectile(overrides: Partial<ProjectileState> = {}): ProjectileState {
  const weapon = overrides.weapon ?? 'bazooka';
  return assertFiniteProjectileState({
    id: overrides.id ?? 'projectile-0',
    ownerId: overrides.ownerId ?? 'human-0',
    weapon,
    position: copyVector(overrides.position ?? ORIGIN),
    velocity: copyVector(overrides.velocity ?? { x: 220, y: 0 }),
    fuseRemaining: overrides.fuseRemaining ?? (weapon === 'grenade' ? GAME_CONFIG.grenadeFuseSeconds : 0),
    ageSeconds: overrides.ageSeconds ?? 0,
  });
}

export function matchFixture(overrides: Partial<MatchState> = {}): MatchState {
  const initialAliens = createTeam('human', 180)
    .concat(createTeam('cpu', 1_130));
  const initial: MatchState = {
    schemaVersion: 1,
    seed: 1,
    turnNumber: 0,
    activeTeam: 'human',
    activeAlienIndex: { human: 0, cpu: 0 },
    phase: 'ready',
    selectedWeapon: 'bazooka',
    wind: 0,
    humanTurnSecondsRemaining: GAME_CONFIG.humanTurnSeconds,
    dynamicSecondsRemaining: GAME_CONFIG.dynamicTimeoutSeconds,
    aliens: initialAliens,
    projectile: null,
    terrainBytes: new Uint8Array([1]),
    terrainWidth: 1,
    terrainHeight: 1,
    camera: {
      center: { x: GAME_CONFIG.worldWidth / 2, y: GAME_CONFIG.worldHeight / 2 },
      zoom: 1,
      viewport: { x: GAME_CONFIG.worldWidth, y: GAME_CONFIG.worldHeight },
    },
    events: [],
    winner: null,
  };
  const match: MatchState = { ...initial, ...overrides };

  return assertFiniteMatchState({
    ...match,
    activeAlienIndex: { ...match.activeAlienIndex },
    aliens: match.aliens.map(candidate => alien(candidate)),
    projectile: match.projectile === null ? null : projectile(match.projectile),
    terrainBytes: new Uint8Array(match.terrainBytes),
    camera: {
      center: copyVector(match.camera.center),
      zoom: match.camera.zoom,
      viewport: copyVector(match.camera.viewport),
    },
    events: match.events.map(copyEvent),
  });
}

export function storedMatchFixture(overrides: Partial<MatchState> = {}): MatchState {
  return matchFixture({
    terrainBytes: new Uint8Array(GAME_CONFIG.worldWidth * GAME_CONFIG.worldHeight),
    terrainWidth: GAME_CONFIG.worldWidth,
    terrainHeight: GAME_CONFIG.worldHeight,
    ...overrides,
  });
}

export function matchWithHumanHealth(health: readonly number[]): MatchState {
  const match = matchFixture();
  return matchFixture({
    aliens: match.aliens.map(candidate => candidate.team === 'human'
      ? alien({ ...candidate, health: health[Number(candidate.id.at(-1))] ?? candidate.health })
      : candidate),
  });
}

export function nextWithCpuTurnComplete(match: MatchState): MatchState {
  return matchFixture({
    ...match,
    activeTeam: 'cpu',
    phase: 'complete',
  });
}

export interface AiInputFixture {
  match: MatchState;
  terrain: TerrainFixture;
  clock: { nowMilliseconds(): number };
}

export function openFieldInput(): AiInputFixture {
  return {
    match: matchFixture({ activeTeam: 'cpu' }),
    terrain: { hasSupport: () => true, isSolid: () => false },
    clock: { nowMilliseconds: () => 0 },
  };
}

export function blockedInput(): AiInputFixture {
  return {
    match: matchFixture({ activeTeam: 'cpu' }),
    terrain: { hasSupport: () => true, isSolid: () => true },
    clock: { nowMilliseconds: () => 0 },
  };
}

function copyVector(vector: Vec2): Vec2 {
  return { x: vector.x, y: vector.y };
}

function createTeam(team: AlienState['team'], startX: number): AlienState[] {
  return Array.from({ length: GAME_CONFIG.teamSize }, (_, index) => alien({
    id: `${team}-${index}`,
    team,
    position: { x: startX + index * 145, y: 720 - index * 40 },
  }));
}

function copyEvent(event: GameEvent): GameEvent {
  switch (event.type) {
    case 'shot':
      return { ...event, position: copyVector(event.position) };
    case 'defeated':
      return { ...event };
    case 'explosion':
      return { ...event, position: copyVector(event.position) };
    case 'damage':
      return { ...event };
  }
}
