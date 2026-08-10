import { chooseAiDecisionAsync } from './ai';
import { GAME_CONFIG } from './config';
import { createFixedMap } from './map';
import { distance } from './math';
import { stepAlien, tryJump } from './movement';
import { bounceProjectile, stepProjectile, sweepCollision } from './physics';
import { SeededRandom } from './random';
import type { MatchLoadResult } from './storage';
import { TerrainMask } from './terrain';
import type { TerrainSnapshot } from './terrain';
import { advanceTurn, findWinner, startTurn, tickHumanTurn } from './turn-manager';
import type {
  AlienState,
  Clock,
  GameCommand,
  GameEvent,
  MatchState,
  ProjectileState,
  Vec2,
} from './types';
import { createProjectile, resolveExplosion } from './weapons';
import { clampCamera } from '../ui/camera';
import type { Camera } from '../ui/camera';

export interface MatchRepositoryPort {
  load(): Promise<MatchLoadResult>;
  save(match: MatchState): Promise<void>;
  clear(): Promise<void>;
}

export interface GameRenderer {
  render(match: MatchState, terrain: ReturnType<TerrainMask['snapshot']>, camera: Camera): void;
}

export interface GameDependencies {
  readonly repository: MatchRepositoryPort;
  readonly clock: Clock;
  readonly isVisible: () => boolean;
  readonly renderer?: GameRenderer;
  readonly viewport?: Vec2;
  readonly onPersistenceError?: (operation: 'load' | 'save' | 'clear', error: unknown) => void;
  readonly yieldToBrowser?: () => Promise<void>;
  readonly chooseAiDecision?: typeof chooseAiDecisionAsync;
}

/**
 * The sole owner of a running match. Input stays as commands, renderer stays
 * read-only, and phase progression is delegated to the turn manager.
 */
export class GameController {
  private currentState: MatchState | null = null;
  private terrain: TerrainMask | null = null;
  private accumulatedSeconds = 0;
  private saveAfterSettling = false;
  private persistence: Promise<void> = Promise.resolve();
  private moveDirection: -1 | 0 | 1 = 0;
  private viewport: Vec2;
  private cameraTarget: Vec2 | null = null;
  private terrainSnapshot: TerrainSnapshot | null = null;
  private cpuTurnTask: Promise<void> | null = null;

  private constructor(private readonly dependencies: GameDependencies) {
    this.viewport = dependencies.viewport === undefined
      ? { x: GAME_CONFIG.worldWidth, y: GAME_CONFIG.worldHeight }
      : { ...dependencies.viewport };
  }

  static create(dependencies: GameDependencies): GameController {
    return new GameController(dependencies);
  }

  get state(): MatchState | null {
    return this.currentState;
  }

  startNewMatch(seed: number): void {
    if (!Number.isInteger(seed)) throw new RangeError('Match seed must be an integer');
    const map = createFixedMap();
    const random = new SeededRandom(seed);
    this.terrain = map.terrain;
    this.terrainSnapshot = map.terrain.snapshot();
    const next: MatchState = {
      schemaVersion: 1,
      seed,
      turnNumber: 0,
      activeTeam: 'human',
      activeAlienIndex: { human: 0, cpu: 0 },
      phase: 'ready',
      selectedWeapon: 'bazooka',
      wind: GAME_CONFIG.windMinPixelsPerSecondSquared
        + random.next() * (GAME_CONFIG.windMaxPixelsPerSecondSquared - GAME_CONFIG.windMinPixelsPerSecondSquared),
      humanTurnSecondsRemaining: GAME_CONFIG.humanTurnSeconds,
      dynamicSecondsRemaining: GAME_CONFIG.dynamicTimeoutSeconds,
      aliens: [
        ...map.spawns.human.map((position, index) => alien('human', index, position)),
        ...map.spawns.cpu.map((position, index) => alien('cpu', index, position)),
      ],
      projectile: null,
      terrainBytes: this.terrainSnapshot.bytes,
      terrainWidth: map.terrain.width,
      terrainHeight: map.terrain.height,
      camera: initialCamera(this.viewport),
      events: [],
      winner: null,
    };
    const first = activeAlien(next);
    this.currentState = first === undefined ? next : focusCamera(next, first.position, 1);
    this.cameraTarget = first?.position ?? null;
    this.accumulatedSeconds = 0;
    this.saveAfterSettling = false;
    this.moveDirection = 0;
    this.cpuTurnTask = null;
  }

  async resume(): Promise<MatchLoadResult> {
    let recovered: MatchLoadResult;
    try {
      recovered = await this.dependencies.repository.load();
    } catch (error) {
      this.currentState = null;
      this.terrain = null;
      this.terrainSnapshot = null;
      this.dependencies.onPersistenceError?.('load', error);
      return { status: 'error' };
    }
    if (recovered.status !== 'loaded') {
      this.currentState = null;
      this.terrain = null;
      this.terrainSnapshot = null;
      return recovered;
    }

    this.currentState = {
      ...recovered.match,
      camera: clampCamera({ ...recovered.match.camera, viewport: { ...this.viewport } }, worldBounds()),
    };
    this.terrain = TerrainMask.fromSnapshot({
      width: recovered.match.terrainWidth,
      height: recovered.match.terrainHeight,
      bytes: recovered.match.terrainBytes,
    });
    this.terrainSnapshot = this.terrain.snapshot();
    this.accumulatedSeconds = 0;
    this.saveAfterSettling = false;
    this.moveDirection = 0;
    this.cameraTarget = activeAlien(this.currentState)?.position ?? null;
    this.cpuTurnTask = null;
    return recovered;
  }

  setViewport(viewport: Vec2): void {
    if (!Number.isFinite(viewport.x) || !Number.isFinite(viewport.y) || viewport.x <= 0 || viewport.y <= 0) {
      throw new RangeError('Viewport dimensions must be positive and finite');
    }
    this.viewport = { ...viewport };
    this.moveDirection = 0;
    if (this.currentState !== null) {
      this.currentState = {
        ...this.currentState,
        camera: clampCamera({ ...this.currentState.camera, viewport: { ...viewport } }, worldBounds()),
      };
    }
  }

  async clearDamagedSave(): Promise<boolean> {
    try {
      await this.dependencies.repository.clear();
      return true;
    } catch (error) {
      this.dependencies.onPersistenceError?.('clear', error);
      return false;
    }
  }

  dispatch(command: GameCommand): void {
    const match = this.currentState;
    const terrain = this.terrain;
    if (match === null) return;
    if (command.type === 'camera-pan') {
      this.currentState = { ...match, camera: clampCamera({
        ...match.camera,
        center: {
          x: match.camera.center.x + command.delta.x,
          y: match.camera.center.y + command.delta.y,
        },
      }, worldBounds()) };
      return;
    }
    if (command.type === 'camera-zoom') {
      this.currentState = { ...match, camera: clampCamera({
        ...match.camera,
        zoom: match.camera.zoom * command.factor,
      }, worldBounds()) };
      return;
    }
    if (terrain === null || match.activeTeam !== 'human' || !isHumanControllable(match.phase)) return;

    const active = activeAlien(match);
    if (active === undefined) return;

    switch (command.type) {
      case 'move':
        this.moveDirection = command.direction;
        return;
      case 'jump':
        this.currentState = withAlien(match, tryJump(active, terrain, match.phase));
        return;
      case 'aim':
        this.currentState = withAlien(match, { ...active, aimRadians: command.angleRadians });
        if (match.phase === 'ready') this.currentState = startTurn(this.currentState, 'aiming');
        return;
      case 'select-weapon':
        this.currentState = { ...match, selectedWeapon: command.weapon };
        return;
      case 'fire':
        this.moveDirection = 0;
        this.fire(active, command.power);
        return;
    }
  }

  async tick(elapsedSeconds: number): Promise<void> {
    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) {
      throw new RangeError('Elapsed seconds must be finite and non-negative');
    }
    if (this.currentState === null || this.terrain === null) return;
    if (!this.dependencies.isVisible()) {
      this.accumulatedSeconds = 0;
      return;
    }

    this.accumulatedSeconds += elapsedSeconds;
    const maximumSeconds = GAME_CONFIG.fixedStepSeconds * GAME_CONFIG.maxSubsteps;
    if (this.accumulatedSeconds > maximumSeconds) this.accumulatedSeconds = maximumSeconds;

    let substeps = 0;
    while (this.accumulatedSeconds >= GAME_CONFIG.fixedStepSeconds && substeps < GAME_CONFIG.maxSubsteps) {
      this.fixedStep();
      this.accumulatedSeconds -= GAME_CONFIG.fixedStepSeconds;
      substeps += 1;
    }
    if (substeps === GAME_CONFIG.maxSubsteps) this.accumulatedSeconds = 0;
    await this.persistAfterSettling();
  }

  async pause(): Promise<void> {
    this.accumulatedSeconds = 0;
    await this.persistIfStable();
  }

  render(): void {
    if (this.currentState === null || this.terrainSnapshot === null || this.dependencies.renderer === undefined) return;
    this.dependencies.renderer.render(this.currentState, this.terrainSnapshot, this.currentState.camera);
    if (this.currentState.events.length > 0) this.currentState = { ...this.currentState, events: [] };
  }

  canActivatePwaUpdate(): boolean {
    return this.currentState === null || this.currentState.phase === 'complete';
  }

  private fixedStep(): void {
    const match = this.currentState;
    const terrain = this.terrain;
    if (match === null || terrain === null || match.phase === 'complete') return;

    if (isHumanControllable(match.phase) && activeAlien(match) === undefined) {
      this.moveDirection = 0;
      this.currentState = transitionToSettling(match);
      return;
    }

    if (match.phase === 'ready' && match.activeTeam === 'cpu') {
      this.beginCpuTurn(match, terrain);
      return;
    }

    if (match.phase === 'projectile') {
      this.stepActiveProjectile(match, terrain);
      return;
    }

    if (match.phase === 'settling') {
      this.settle(match, terrain);
      return;
    }

    const moved = this.stepAliens(match, terrain);
    this.currentState = tickHumanTurn(moved, GAME_CONFIG.fixedStepSeconds, true);
    if (this.currentState.phase === 'complete') this.finishSettling(this.currentState);
  }

  private beginCpuTurn(match: MatchState, terrain: TerrainMask): void {
    if (this.cpuTurnTask !== null) return;
    const turnNumber = match.turnNumber;
    this.cpuTurnTask = this.takeCpuTurn(match, terrain, turnNumber)
      .finally(() => { this.cpuTurnTask = null; });
  }

  private async takeCpuTurn(match: MatchState, terrain: TerrainMask, turnNumber: number): Promise<void> {
    const decision = await (this.dependencies.chooseAiDecision ?? chooseAiDecisionAsync)({
      match,
      terrain,
      clock: this.dependencies.clock,
      yieldToBrowser: this.dependencies.yieldToBrowser,
    }, {
      maxSimulations: GAME_CONFIG.aiMaxSimulations,
      maxMilliseconds: GAME_CONFIG.aiMaxMilliseconds,
    });
    const current = this.currentState;
    if (current === null || current.turnNumber !== turnNumber
      || current.activeTeam !== 'cpu' || current.phase !== 'ready') return;
    const active = activeAlien(current);
    if (active === undefined || decision.command.type === 'pass') {
      this.currentState = startTurn(current, 'aiming');
      this.currentState = startTurn(this.currentState, 'projectile');
      this.currentState = startTurn(this.currentState, 'settling');
      return;
    }

    let repositioned = current;
    if (decision.command.repositionDirection !== undefined) {
      repositioned = withAlien(current, stepAlien(
        active,
        decision.command.repositionDirection,
        terrain,
        (decision.command.repositionDistance ?? 0) / GAME_CONFIG.walkSpeedPixelsPerSecond,
      ));
    }
    const shooter = activeAlien(repositioned);
    if (shooter === undefined) return;
    this.currentState = withAlien(repositioned, { ...shooter, aimRadians: decision.command.angleRadians });
    this.currentState = { ...this.currentState, selectedWeapon: decision.command.weapon };
    this.fire(activeAlien(this.currentState)!, decision.command.power);
  }

  private fire(shooter: AlienState, power: number): void {
    const match = this.currentState;
    if (match === null) return;
    let next = match.phase === 'ready' ? startTurn(match, 'aiming') : match;
    const projectile = createProjectile(next.selectedWeapon, shooter.position, shooter.aimRadians, power);
    const launched: ProjectileState = {
      ...projectile,
      id: `projectile-${next.turnNumber}`,
      ownerId: shooter.id,
    };
    next = startTurn(next, 'projectile');
    this.currentState = {
      ...next,
      projectile: launched,
      events: [...next.events, {
        type: 'shot',
        projectileId: launched.id,
        position: { ...shooter.position },
        aimRadians: shooter.aimRadians,
      }],
    };
  }

  private stepActiveProjectile(match: MatchState, terrain: TerrainMask): void {
    if (match.projectile === null) {
      this.currentState = startTurn(match, 'settling');
      return;
    }
    let projectile = stepProjectile(match.projectile, {
      gravity: GAME_CONFIG.gravityPixelsPerSecondSquared,
      wind: match.wind,
    }, GAME_CONFIG.fixedStepSeconds);
    const hit = sweepCollision(
      match.projectile.position,
      projectile.position,
      position => collidesAt(position, terrain, match.aliens, projectile.ownerId, projectile.ageSeconds),
    );
    if (hit !== null) {
      projectile = projectile.weapon === 'grenade'
        ? bounceProjectile({ ...projectile, position: hit.lastFree }, position => collidesAt(
          position,
          terrain,
          match.aliens,
          projectile.ownerId,
          projectile.ageSeconds,
        ), hit.impact)
        : { ...projectile, position: hit.impact };
    }
    const terminal = projectile.weapon === 'grenade' && projectile.fuseRemaining <= 0
      || projectile.weapon === 'bazooka' && hit !== null
      || outsideWorld(projectile.position)
      || match.dynamicSecondsRemaining <= GAME_CONFIG.fixedStepSeconds;
    if (!terminal) {
      this.currentState = focusCamera({
        ...match,
        projectile,
        dynamicSecondsRemaining: Math.max(0, match.dynamicSecondsRemaining - GAME_CONFIG.fixedStepSeconds),
      }, projectile.position);
      return;
    }

    const resolved = resolveExplosion(terrain, match.aliens, projectile.position);
    const events = explosionEvents(match.aliens, resolved.aliens, projectile.position);
    this.terrainSnapshot = terrain.snapshot();
    const next = startTurn({
      ...match,
      aliens: [...resolved.aliens],
      projectile: null,
      terrainBytes: this.terrainSnapshot.bytes,
      events: [...match.events, ...events],
    }, 'settling');
    this.cameraTarget = projectile.position;
    this.currentState = focusCamera(next, projectile.position, 1);
  }

  private settle(match: MatchState, terrain: TerrainMask): void {
    const settled = this.stepAliens(match, terrain);
    const dynamicSecondsRemaining = Math.max(0, settled.dynamicSecondsRemaining - GAME_CONFIG.fixedStepSeconds);
    this.currentState = this.cameraTarget === null
      ? { ...settled, dynamicSecondsRemaining }
      : focusCamera({ ...settled, dynamicSecondsRemaining }, this.cameraTarget);
    if (dynamicSecondsRemaining === 0 || allAliensStable(this.currentState, terrain)) {
      this.finishSettling(this.currentState);
    }
  }

  private finishSettling(match: MatchState): void {
    const winner = findWinner(match);
    if (winner !== null) {
      this.currentState = { ...match, winner, phase: 'complete' };
    } else {
      this.currentState = advanceTurn({ ...match, phase: 'complete' });
      const nextActive = activeAlien(this.currentState);
      if (nextActive !== undefined) {
        this.cameraTarget = nextActive.position;
        this.currentState = focusCamera(this.currentState, nextActive.position, 1);
      }
    }
    this.saveAfterSettling = true;
  }

  private stepAliens(match: MatchState, terrain: TerrainMask): MatchState {
    const active = activeAlien(match);
    const aliens = match.aliens.map(alien => alien.health > 0
      ? stepAlien(
        alien,
        active?.id === alien.id && match.activeTeam === 'human' && isHumanControllable(match.phase)
          ? this.moveDirection
          : 0,
        terrain,
      )
      : alien);
    const events = defeatedEvents(match.aliens, aliens);
    return { ...match, aliens, events: [...match.events, ...events] };
  }

  private async persistAfterSettling(): Promise<void> {
    if (!this.saveAfterSettling) return;
    this.saveAfterSettling = false;
    await this.persistIfStable();
  }

  private async persistIfStable(): Promise<void> {
    if (this.currentState === null || !isStable(this.currentState)) return;
    const saved = { ...this.currentState, events: [] };
    const next = this.persistence.then(() => this.dependencies.repository.save(saved));
    this.persistence = next.catch(() => undefined);
    try {
      await next;
    } catch (error) {
      this.dependencies.onPersistenceError?.('save', error);
    }
  }
}

function alien(team: 'human' | 'cpu', index: number, position: Vec2): AlienState {
  return {
    id: `${team}-${index}`,
    team,
    position: { ...position },
    velocity: { x: 0, y: 0 },
    health: GAME_CONFIG.startingHealth,
    aimRadians: team === 'human' ? 0 : Math.PI,
    jumpsUsed: 0,
  };
}

function initialCamera(viewport: Vec2 | undefined): MatchState['camera'] {
  const actualViewport = viewport ?? { x: GAME_CONFIG.worldWidth, y: GAME_CONFIG.worldHeight };
  return clampCamera({
    center: { x: GAME_CONFIG.worldWidth / 2, y: GAME_CONFIG.worldHeight / 2 },
    zoom: 1,
    viewport: actualViewport,
  }, worldBounds());
}

function focusCamera(match: MatchState, target: Vec2, amount = 0.18): MatchState {
  const camera = clampCamera({
    ...match.camera,
    center: {
      x: match.camera.center.x + (target.x - match.camera.center.x) * amount,
      y: match.camera.center.y + (target.y - match.camera.center.y) * amount,
    },
  }, worldBounds());
  return { ...match, camera };
}

function worldBounds(): { width: number; height: number } {
  return { width: GAME_CONFIG.worldWidth, height: GAME_CONFIG.worldHeight };
}

function activeAlien(match: MatchState): AlienState | undefined {
  const candidate = match.aliens.filter(alien => alien.team === match.activeTeam)[match.activeAlienIndex[match.activeTeam]];
  return candidate?.health > 0 ? candidate : undefined;
}

function transitionToSettling(match: MatchState): MatchState {
  let next = match;
  if (next.phase === 'ready') next = startTurn(next, 'aiming');
  if (next.phase === 'aiming') next = startTurn(next, 'projectile');
  if (next.phase === 'projectile') next = startTurn(next, 'settling');
  return next;
}

function withAlien(match: MatchState, replacement: AlienState): MatchState {
  return { ...match, aliens: match.aliens.map(alien => alien.id === replacement.id ? replacement : alien) };
}

function isHumanControllable(phase: MatchState['phase']): boolean {
  return phase === 'ready' || phase === 'aiming';
}

function outsideWorld(position: Vec2): boolean {
  return position.x < 0 || position.x > GAME_CONFIG.worldWidth || position.y < 0 || position.y > GAME_CONFIG.worldHeight;
}

function collidesAt(
  position: Vec2,
  terrain: TerrainMask,
  aliens: readonly AlienState[],
  ownerId: string,
  ageSeconds: number,
): boolean {
  if (terrain.isSolid(Math.round(position.x), Math.round(position.y))) return true;
  return aliens.some(alien => alien.health > 0
    && (alien.id !== ownerId || ageSeconds > 0.25)
    && distance(position, alien.position) <= GAME_CONFIG.alienRadius);
}

function allAliensStable(match: MatchState, terrain: TerrainMask): boolean {
  return match.aliens.every(alien => alien.health <= 0 || (
    terrain.hasSupport(alien.position, GAME_CONFIG.alienRadius)
    && Math.abs(alien.velocity.x) < 0.01
    && Math.abs(alien.velocity.y) < 0.01
  ));
}

function explosionEvents(before: readonly AlienState[], after: readonly AlienState[], position: Vec2): GameEvent[] {
  const events: GameEvent[] = [{ type: 'explosion', position: { ...position }, radius: GAME_CONFIG.explosionRadius }];
  after.forEach((alien, index) => {
    const previous = before[index]!;
    const damage = previous.health - alien.health;
    if (damage > 0) events.push({ type: 'damage', alienId: alien.id, amount: damage });
    if (previous.health > 0 && alien.health === 0) events.push({ type: 'defeated', alienId: alien.id });
  });
  return events;
}

function defeatedEvents(before: readonly AlienState[], after: readonly AlienState[]): GameEvent[] {
  return after.flatMap((alien, index) => before[index]!.health > 0 && alien.health === 0
    ? [{ type: 'defeated', alienId: alien.id } as const]
    : []);
}

function isStable(match: MatchState): boolean {
  return match.phase === 'ready' || (match.phase === 'complete' && match.winner !== null);
}
