import { GAME_CONFIG } from './config';
import { findWinner } from './turn-manager';
import type {
  AlienState,
  CameraState,
  GameEvent,
  MatchState,
  MatchOutcome,
  ProjectileState,
  TeamId,
  TurnPhase,
  Vec2,
  WeaponKind,
} from './types';

const SAVE_SCHEMA_VERSION = 1;
const INVALID_STATE_ERROR = 'Invalid save state';
const UNSUPPORTED_SCHEMA_ERROR = 'Unsupported save schema';
const TEAMS: readonly TeamId[] = ['human', 'cpu'];
const PHASES: readonly TurnPhase[] = ['ready', 'aiming', 'projectile', 'settling', 'complete'];
const WEAPONS: readonly WeaponKind[] = ['bazooka', 'grenade'];
const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

interface BufferLike {
  readonly length: number;
  readonly [index: number]: number;
  toString(encoding: 'base64'): string;
}

interface BufferConstructorLike {
  from(value: Uint8Array): BufferLike;
  from(value: string, encoding: 'base64'): BufferLike;
}

export function encodeMatch(match: MatchState): string {
  validateMatch(match);
  return JSON.stringify({ ...match, terrainBytes: encodeBytes(match.terrainBytes) });
}

export function decodeMatch(encoded: string): MatchState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(encoded) as unknown;
  } catch {
    throw invalidState();
  }

  if (!isRecord(parsed)) throw invalidState();
  if (parsed.schemaVersion !== SAVE_SCHEMA_VERSION) throw new Error(UNSUPPORTED_SCHEMA_ERROR);

  return parseMatch(parsed);
}

function parseMatch(value: Record<string, unknown>): MatchState {
  ensureKeys(value, [
    'schemaVersion', 'seed', 'turnNumber', 'activeTeam', 'activeAlienIndex', 'phase', 'selectedWeapon',
    'wind', 'humanTurnSecondsRemaining', 'dynamicSecondsRemaining', 'aliens', 'projectile', 'terrainBytes',
    'terrainWidth', 'terrainHeight', 'camera', 'events', 'winner',
  ]);

  const match: MatchState = {
    schemaVersion: SAVE_SCHEMA_VERSION,
    seed: finiteInteger(value.seed),
    turnNumber: finiteInteger(value.turnNumber),
    activeTeam: team(value.activeTeam),
    activeAlienIndex: parseActiveAlienIndex(value.activeAlienIndex),
    phase: phase(value.phase),
    selectedWeapon: weapon(value.selectedWeapon),
    wind: finiteNumber(value.wind),
    humanTurnSecondsRemaining: nonNegativeNumber(value.humanTurnSecondsRemaining),
    dynamicSecondsRemaining: nonNegativeNumber(value.dynamicSecondsRemaining),
    aliens: array(value.aliens).map(parseAlien),
    projectile: value.projectile === null ? null : parseProjectile(object(value.projectile)),
    terrainBytes: decodeBytes(value.terrainBytes),
    terrainWidth: positiveInteger(value.terrainWidth),
    terrainHeight: positiveInteger(value.terrainHeight),
    camera: parseCamera(object(value.camera)),
    events: array(value.events).map(parseEvent),
    winner: value.winner === null ? null : outcome(value.winner),
  };

  validateMatch(match);
  return match;
}

function validateMatch(match: MatchState): void {
  if (match.schemaVersion !== SAVE_SCHEMA_VERSION) throw new Error(UNSUPPORTED_SCHEMA_ERROR);
  if (!Number.isInteger(match.seed) || !Number.isInteger(match.turnNumber) || match.turnNumber < 0) {
    throw invalidState();
  }
  if (!isTeam(match.activeTeam) || !isPhase(match.phase) || !isWeapon(match.selectedWeapon)) throw invalidState();
  validateActiveAlienIndex(match.activeAlienIndex);
  finiteNumber(match.wind);
  nonNegativeNumber(match.humanTurnSecondsRemaining);
  nonNegativeNumber(match.dynamicSecondsRemaining);
  if (match.wind < GAME_CONFIG.windMinPixelsPerSecondSquared
    || match.wind > GAME_CONFIG.windMaxPixelsPerSecondSquared
    || match.humanTurnSecondsRemaining > GAME_CONFIG.humanTurnSeconds
    || match.dynamicSecondsRemaining > GAME_CONFIG.dynamicTimeoutSeconds) throw invalidState();
  validateAliens(match.aliens);
  if (match.projectile !== null) validateProjectile(match.projectile);
  validateTerrain(match.terrainWidth, match.terrainHeight, match.terrainBytes);
  validateCamera(match.camera);
  match.events.forEach(validateEvent);
  if (match.winner !== null && !isOutcome(match.winner)) throw invalidState();
  validateInvariants(match);
}

function validateInvariants(match: MatchState): void {
  const terminalOutcome = findWinner(match);
  if (match.phase === 'complete') {
    if (terminalOutcome === null || match.winner !== terminalOutcome || match.projectile !== null) throw invalidState();
  } else if (terminalOutcome !== null || match.winner !== null) {
    throw invalidState();
  }
  if ((match.phase === 'projectile') !== (match.projectile !== null)) throw invalidState();

  for (const teamId of TEAMS) {
    const roster = match.aliens.filter(alien => alien.team === teamId);
    if (roster.some(alien => alien.health > 0) && roster[match.activeAlienIndex[teamId]]?.health === 0) {
      throw invalidState();
    }
  }
  const currentProjectileId = `projectile-${match.turnNumber}`;
  if (match.projectile !== null) {
    const activeOwner = match.aliens
      .filter(alien => alien.team === match.activeTeam)[match.activeAlienIndex[match.activeTeam]];
    if (match.projectile.id !== currentProjectileId
      || activeOwner?.health === 0
      || match.projectile.ownerId !== activeOwner?.id) throw invalidState();
  }
  for (const event of match.events) {
    if (event.type === 'shot' && event.projectileId !== currentProjectileId) throw invalidState();
    if ((event.type === 'damage' || event.type === 'defeated')
      && !match.aliens.some(alien => alien.id === event.alienId)) throw invalidState();
  }
}

function validateActiveAlienIndex(index: MatchState['activeAlienIndex']): void {
  if (!isRecord(index) || !hasOnlyKeys(index, ['human', 'cpu'])) throw invalidState();
  for (const value of Object.values(index)) {
    if (!Number.isInteger(value) || value < 0 || value >= GAME_CONFIG.teamSize) throw invalidState();
  }
}

function parseActiveAlienIndex(value: unknown): MatchState['activeAlienIndex'] {
  const index = object(value);
  ensureKeys(index, ['human', 'cpu']);
  return { human: finiteInteger(index.human), cpu: finiteInteger(index.cpu) };
}

function validateAliens(aliens: AlienState[]): void {
  if (aliens.length !== GAME_CONFIG.teamSize * TEAMS.length) throw invalidState();
  for (const teamId of TEAMS) {
    const roster = aliens.filter(alien => alien.team === teamId);
    if (roster.length !== GAME_CONFIG.teamSize) throw invalidState();
    roster.forEach((alien, index) => {
      if (alien.id !== `${teamId}-${index}`) throw invalidState();
      validateAlien(alien);
    });
  }
}

function parseAlien(value: unknown): AlienState {
  const alien = object(value);
  ensureKeys(alien, ['id', 'team', 'position', 'velocity', 'health', 'aimRadians', 'jumpsUsed']);
  return {
    id: string(alien.id),
    team: team(alien.team),
    position: vector(alien.position),
    velocity: vector(alien.velocity),
    health: finiteNumber(alien.health),
    aimRadians: finiteNumber(alien.aimRadians),
    jumpsUsed: finiteInteger(alien.jumpsUsed),
  };
}

function validateAlien(alien: AlienState): void {
  if (!isTeam(alien.team) || typeof alien.id !== 'string' || alien.id.length === 0
    || alien.health < 0 || alien.health > GAME_CONFIG.startingHealth
    || alien.jumpsUsed < 0 || alien.jumpsUsed > 1) throw invalidState();
  validateVector(alien.position);
  validateVector(alien.velocity);
  finiteNumber(alien.aimRadians);
}

function parseProjectile(value: Record<string, unknown>): ProjectileState {
  ensureKeys(value, ['id', 'ownerId', 'weapon', 'position', 'velocity', 'fuseRemaining', 'ageSeconds']);
  return {
    id: string(value.id),
    ownerId: string(value.ownerId),
    weapon: weapon(value.weapon),
    position: vector(value.position),
    velocity: vector(value.velocity),
    fuseRemaining: nonNegativeNumber(value.fuseRemaining),
    ageSeconds: nonNegativeNumber(value.ageSeconds),
  };
}

function validateProjectile(projectile: ProjectileState): void {
  if (projectile.id.length === 0 || projectile.ownerId.length === 0 || !isWeapon(projectile.weapon)) {
    throw invalidState();
  }
  validateVector(projectile.position);
  validateVector(projectile.velocity);
  nonNegativeNumber(projectile.fuseRemaining);
  nonNegativeNumber(projectile.ageSeconds);
}

function parseCamera(value: Record<string, unknown>): CameraState {
  ensureKeys(value, ['center', 'zoom', 'viewport']);
  return { center: vector(value.center), zoom: finiteNumber(value.zoom), viewport: vector(value.viewport) };
}

function validateCamera(camera: CameraState): void {
  validateVector(camera.center);
  validateVector(camera.viewport);
  if (camera.viewport.x <= 0 || camera.viewport.y <= 0 || camera.zoom < GAME_CONFIG.minZoom || camera.zoom > GAME_CONFIG.maxZoom) {
    throw invalidState();
  }
}

function parseEvent(value: unknown): GameEvent {
  const event = object(value);
  const type = string(event.type);
  switch (type) {
    case 'shot':
      ensureKeys(event, ['type', 'projectileId', 'position', 'aimRadians']);
      return {
        type,
        projectileId: string(event.projectileId),
        position: vector(event.position),
        aimRadians: finiteNumber(event.aimRadians),
      };
    case 'explosion':
      ensureKeys(event, ['type', 'position', 'radius']);
      return { type, position: vector(event.position), radius: nonNegativeNumber(event.radius) };
    case 'damage':
      ensureKeys(event, ['type', 'alienId', 'amount']);
      return { type, alienId: string(event.alienId), amount: nonNegativeNumber(event.amount) };
    case 'defeated':
      ensureKeys(event, ['type', 'alienId']);
      return { type, alienId: string(event.alienId) };
    default:
      throw invalidState();
  }
}

function validateEvent(event: GameEvent): void {
  parseEvent(event);
}

function validateTerrain(width: number, height: number, bytes: Uint8Array): void {
  if (width !== GAME_CONFIG.worldWidth || height !== GAME_CONFIG.worldHeight
    || !Number.isSafeInteger(width * height) || !(bytes instanceof Uint8Array)
    || bytes.length !== width * height || bytes.some(byte => byte !== 0 && byte !== 1)) throw invalidState();
}

function encodeBytes(bytes: Uint8Array): string {
  const BufferConstructor = (globalThis as typeof globalThis & { Buffer?: BufferConstructorLike }).Buffer;
  if (BufferConstructor !== undefined) return BufferConstructor.from(bytes).toString('base64');
  const chunks: string[] = [];
  let chunk = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index]!;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    chunk += BASE64[first >> 2]
      + BASE64[((first & 3) << 4) | ((second ?? 0) >> 4)]
      + (second === undefined ? '=' : BASE64[((second & 15) << 2) | ((third ?? 0) >> 6)])
      + (third === undefined ? '=' : BASE64[third & 63]);
    if (chunk.length >= 32_768) {
      chunks.push(chunk);
      chunk = '';
    }
  }
  chunks.push(chunk);
  return chunks.join('');
}

function decodeBytes(value: unknown): Uint8Array {
  if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw invalidState();
  }
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  if ((padding === 2 && (BASE64.indexOf(value.at(-3)!) & 15) !== 0)
    || (padding === 1 && (BASE64.indexOf(value.at(-2)!) & 3) !== 0)) throw invalidState();
  const BufferConstructor = (globalThis as typeof globalThis & { Buffer?: BufferConstructorLike }).Buffer;
  if (BufferConstructor !== undefined) {
    const decoded = BufferConstructor.from(value, 'base64');
    const result = new Uint8Array(decoded.length);
    for (let index = 0; index < decoded.length; index += 1) result[index] = decoded[index]!;
    return result;
  }
  const bytes = new Uint8Array(value.length / 4 * 3 - padding);
  let output = 0;
  for (let index = 0; index < value.length; index += 4) {
    const first = BASE64.indexOf(value[index]!);
    const second = BASE64.indexOf(value[index + 1]!);
    const third = value[index + 2] === '=' ? 0 : BASE64.indexOf(value[index + 2]!);
    const fourth = value[index + 3] === '=' ? 0 : BASE64.indexOf(value[index + 3]!);
    bytes[output++] = (first << 2) | (second >> 4);
    if (value[index + 2] !== '=') bytes[output++] = ((second & 15) << 4) | (third >> 2);
    if (value[index + 3] !== '=') bytes[output++] = ((third & 3) << 6) | fourth;
  }
  return bytes;
}

function vector(value: unknown): Vec2 {
  const result = object(value);
  ensureKeys(result, ['x', 'y']);
  return { x: finiteNumber(result.x), y: finiteNumber(result.y) };
}

function validateVector(value: Vec2): void {
  finiteNumber(value.x);
  finiteNumber(value.y);
}

function team(value: unknown): TeamId {
  if (!isTeam(value)) throw invalidState();
  return value;
}

function outcome(value: unknown): MatchOutcome {
  if (!isOutcome(value)) throw invalidState();
  return value;
}

function phase(value: unknown): TurnPhase {
  if (!isPhase(value)) throw invalidState();
  return value;
}

function weapon(value: unknown): WeaponKind {
  if (!isWeapon(value)) throw invalidState();
  return value;
}

function isTeam(value: unknown): value is TeamId {
  return typeof value === 'string' && (TEAMS as readonly string[]).includes(value);
}

function isOutcome(value: unknown): value is MatchOutcome {
  return value === 'draw' || isTeam(value);
}

function isPhase(value: unknown): value is TurnPhase {
  return typeof value === 'string' && (PHASES as readonly string[]).includes(value);
}

function isWeapon(value: unknown): value is WeaponKind {
  return typeof value === 'string' && (WEAPONS as readonly string[]).includes(value);
}

function finiteNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw invalidState();
  return value;
}

function finiteInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) throw invalidState();
  return value;
}

function positiveInteger(value: unknown): number {
  const result = finiteInteger(value);
  if (result <= 0) throw invalidState();
  return result;
}

function nonNegativeNumber(value: unknown): number {
  const result = finiteNumber(value);
  if (result < 0) throw invalidState();
  return result;
}

function string(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) throw invalidState();
  return value;
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw invalidState();
  return value;
}

function object(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw invalidState();
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function ensureKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  if (!hasOnlyKeys(value, keys)) throw invalidState();
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every(key => keys.includes(key));
}

function invalidState(): Error {
  return new Error(INVALID_STATE_ERROR);
}
