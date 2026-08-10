export type Vec2 = Readonly<{ x: number; y: number }>;

export type TeamId = 'human' | 'cpu';

export type MatchOutcome = TeamId | 'draw';

export type WeaponKind = 'bazooka' | 'grenade';

export type TurnPhase = 'ready' | 'aiming' | 'projectile' | 'settling' | 'complete';

export type GameCommand =
  | { type: 'move'; direction: -1 | 0 | 1 }
  | { type: 'jump' }
  | { type: 'aim'; angleRadians: number }
  | { type: 'fire'; power: number }
  | { type: 'select-weapon'; weapon: WeaponKind }
  | { type: 'camera-pan'; delta: Vec2 }
  | { type: 'camera-zoom'; factor: number };

export type GameEvent =
  | { type: 'shot'; projectileId: string; position: Vec2; aimRadians: number }
  | { type: 'explosion'; position: Vec2; radius: number }
  | { type: 'damage'; alienId: string; amount: number }
  | { type: 'defeated'; alienId: string };

export interface Clock {
  nowMilliseconds(): number;
}

export interface AlienState {
  id: string;
  team: TeamId;
  position: Vec2;
  velocity: Vec2;
  health: number;
  aimRadians: number;
  jumpsUsed: number;
}

export interface ProjectileState {
  id: string;
  ownerId: string;
  weapon: WeaponKind;
  position: Vec2;
  velocity: Vec2;
  fuseRemaining: number;
  ageSeconds: number;
}

export interface CameraState {
  center: Vec2;
  zoom: number;
  viewport: Vec2;
}

export interface MatchState {
  schemaVersion: 1;
  seed: number;
  turnNumber: number;
  activeTeam: TeamId;
  activeAlienIndex: Record<TeamId, number>;
  phase: TurnPhase;
  selectedWeapon: WeaponKind;
  wind: number;
  humanTurnSecondsRemaining: number;
  dynamicSecondsRemaining: number;
  aliens: AlienState[];
  projectile: ProjectileState | null;
  terrainBytes: Uint8Array;
  terrainWidth: number;
  terrainHeight: number;
  camera: CameraState;
  events: GameEvent[];
  winner: MatchOutcome | null;
}

export function assertFiniteAlienState(state: AlienState): AlienState {
  assertFiniteVector('Alien position', state.position);
  assertFiniteVector('Alien velocity', state.velocity);
  assertFiniteNumber('Alien health', state.health);
  assertFiniteNumber('Alien aimRadians', state.aimRadians);
  assertFiniteNumber('Alien jumpsUsed', state.jumpsUsed);
  return state;
}

export function assertFiniteProjectileState(state: ProjectileState): ProjectileState {
  assertFiniteVector('Projectile position', state.position);
  assertFiniteVector('Projectile velocity', state.velocity);
  assertFiniteNumber('Projectile fuseRemaining', state.fuseRemaining);
  assertFiniteNumber('Projectile ageSeconds', state.ageSeconds);
  return state;
}

export function assertFiniteMatchState(state: MatchState): MatchState {
  assertFiniteNumber('Match seed', state.seed);
  assertFiniteNumber('Match turnNumber', state.turnNumber);
  assertFiniteNumber('Match active human index', state.activeAlienIndex.human);
  assertFiniteNumber('Match active cpu index', state.activeAlienIndex.cpu);
  assertFiniteNumber('Match wind', state.wind);
  assertFiniteNumber('Match human turn timer', state.humanTurnSecondsRemaining);
  assertFiniteNumber('Match dynamic timer', state.dynamicSecondsRemaining);
  assertFiniteNumber('Match terrain width', state.terrainWidth);
  assertFiniteNumber('Match terrain height', state.terrainHeight);
  assertFiniteVector('Match camera center', state.camera.center);
  assertFiniteNumber('Match camera zoom', state.camera.zoom);
  assertFiniteVector('Match camera viewport', state.camera.viewport);
  state.aliens.forEach(assertFiniteAlienState);
  if (state.projectile !== null) assertFiniteProjectileState(state.projectile);
  state.events.forEach(assertFiniteGameEvent);
  return state;
}

function assertFiniteGameEvent(event: GameEvent): void {
  switch (event.type) {
    case 'shot':
      assertFiniteVector('Shot position', event.position);
      assertFiniteNumber('Shot aimRadians', event.aimRadians);
      return;
    case 'defeated':
      return;
    case 'explosion':
      assertFiniteVector('Explosion position', event.position);
      assertFiniteNumber('Explosion radius', event.radius);
      return;
    case 'damage':
      assertFiniteNumber('Damage amount', event.amount);
  }
}

function assertFiniteVector(name: string, value: Vec2): void {
  assertFiniteNumber(`${name} x`, value.x);
  assertFiniteNumber(`${name} y`, value.y);
}

function assertFiniteNumber(name: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be finite`);
  }
}
