import { GAME_CONFIG } from './config';
import { distance } from './math';
import { simulateProjectile } from './physics';
import { SeededRandom } from './random';
import type { TerrainProbe } from './terrain';
import { createProjectile, damageAtDistance } from './weapons';
import type { AlienState, Clock, MatchState, Vec2, WeaponKind } from './types';

const MAX_SIMULATION_STEPS = 600;
const YIELD_INTERVAL = 40;
const MAX_PERTURBATION_ATTEMPTS = 4;
const ANGLE_ERROR_RADIANS = Math.PI / 360;
const POWER_ERROR = 0.005;
const REPOSITION_DISTANCES = [
  GAME_CONFIG.walkSpeedPixelsPerSecond / 6,
  GAME_CONFIG.walkSpeedPixelsPerSecond / 2,
] as const;
const MAX_REPOSITION_DISTANCE = REPOSITION_DISTANCES.at(-1)!;

export type AiTerrainProbe = TerrainProbe;

export interface AiInput {
  readonly match: MatchState;
  readonly terrain: AiTerrainProbe;
  readonly clock: Clock;
  /** A cooperative hook for a host that can yield between deterministic batches. */
  readonly yieldToBrowser?: () => Promise<void>;
}

export interface AiLimits {
  readonly maxSimulations: number;
  readonly maxMilliseconds: number;
}

export type AiCommand =
  | {
    readonly type: 'fire';
    readonly weapon: WeaponKind;
    readonly angleRadians: number;
    readonly power: number;
    readonly repositionDirection?: -1 | 1;
    readonly repositionDistance?: number;
  }
  | { readonly type: 'pass' };

export interface AiDecision {
  readonly command: AiCommand;
  readonly simulations: number;
  readonly predictedDamage: Readonly<{ enemy: number; friendly: number; self: number }>;
}

interface Candidate {
  readonly weapon: WeaponKind;
  readonly angleRadians: number;
  readonly power: number;
  readonly repositionDirection?: -1 | 1;
  readonly repositionDistance?: number;
}

interface ScoredCandidate {
  readonly candidate: Candidate;
  readonly origin: Vec2;
  readonly score: number;
  readonly damage: AiDecision['predictedDamage'];
}

/**
 * Chooses one terminal CPU action with a fixed candidate grid. The search has
 * a deterministic simulation count. The wall budget only guards cooperative
 * yielding, so device speed never changes the ranked candidate prefix.
 */
export function chooseAiDecision(input: AiInput, limits: AiLimits): AiDecision {
  assertLimits(limits);

  const shooter = activeCpuAlien(input.match);
  if (shooter === null || input.match.activeTeam !== 'cpu') return pass(0);

  const search = new Search(input, limits, shooter);
  let ranked = search.run(shooter.position);

  if (!hasPositiveScore(ranked)) {
    const repositions = safeRepositions(shooter, input.terrain);
    if (repositions.length > 0 && !search.exhausted()) {
      ranked = search.runRepositions(repositions);
    }
  }

  return finalizeDecision(input, search, ranked);
}

export async function chooseAiDecisionAsync(input: AiInput, limits: AiLimits): Promise<AiDecision> {
  assertLimits(limits);
  const shooter = activeCpuAlien(input.match);
  if (shooter === null || input.match.activeTeam !== 'cpu') return pass(0);

  const search = new Search(input, limits, shooter);
  let ranked = await search.runAsync(shooter.position);
  if (!hasPositiveScore(ranked)) {
    const repositions = safeRepositions(shooter, input.terrain);
    if (repositions.length > 0 && !search.exhausted()) {
      ranked = await search.runRepositionsAsync(repositions);
    }
  }
  return finalizeDecision(input, search, ranked);
}

function finalizeDecision(input: AiInput, search: Search, ranked: readonly ScoredCandidate[]): AiDecision {
  const positive = ranked.filter(candidate => candidate.score > 0);
  if (positive.length === 0) return pass(search.simulations);

  // A safe damaging shot is always preferable to a damaging friendly-fire shot.
  const safe = positive.filter(isSafe);
  const options = safe.length > 0 ? safe : positive;
  const bestFivePercent = options
    .slice()
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.max(1, Math.ceil(options.length * 0.05)));
  const nearestDistance = Math.min(...bestFivePercent.map(option => option.candidate.repositionDistance ?? 0));
  const selectionPool = bestFivePercent.filter(option => (option.candidate.repositionDistance ?? 0) === nearestDistance);
  const random = new SeededRandom(input.match.seed + input.match.turnNumber);
  const firstIndex = Math.floor(random.next() * selectionPool.length);
  for (let offset = 0; offset < selectionPool.length && !search.exhausted(); offset += 1) {
    const chosen = selectionPool[(firstIndex + offset) % selectionPool.length]!;
    for (let attempt = 0; attempt < MAX_PERTURBATION_ATTEMPTS && !search.exhausted(); attempt += 1) {
      const errorScale = 1 / (attempt + 1);
      const perturbed: Candidate = {
        ...chosen.candidate,
        angleRadians: chosen.candidate.angleRadians
          + signedError(random, ANGLE_ERROR_RADIANS) * errorScale,
        power: clamp(
          chosen.candidate.power + signedError(random, POWER_ERROR) * errorScale,
          0,
          1,
        ),
      };
      const validated = search.evaluate(perturbed, chosen.origin);
      if (validated.score <= 0 || (safe.length > 0 && !isSafe(validated))) continue;

      return {
        command: {
          type: 'fire',
          weapon: perturbed.weapon,
          angleRadians: perturbed.angleRadians,
          power: perturbed.power,
          ...(perturbed.repositionDirection === undefined
            ? {}
            : {
              repositionDirection: perturbed.repositionDirection,
              repositionDistance: perturbed.repositionDistance,
            }),
        },
        simulations: search.simulations,
        predictedDamage: validated.damage,
      };
    }
  }

  return pass(search.simulations);
}

class Search {
  public simulations = 0;

  constructor(
    private readonly input: AiInput,
    private readonly limits: AiLimits,
    private readonly shooter: AlienState,
  ) {}

  run(origin: Vec2, repositionDirection?: -1 | 1): ScoredCandidate[] {
    const scored: ScoredCandidate[] = [];

    for (const candidate of candidateGrid(repositionDirection)) {
      if (this.exhausted()) break;
      scored.push(this.evaluate(candidate, origin));
    }

    return scored;
  }

  async runAsync(origin: Vec2, repositionDirection?: -1 | 1): Promise<ScoredCandidate[]> {
    const scored: ScoredCandidate[] = [];
    for (const candidate of candidateGrid(repositionDirection)) {
      if (this.exhausted()) break;
      scored.push(this.evaluate(candidate, origin));
      if (this.simulations % YIELD_INTERVAL === 0) await this.cooperativeYield();
    }
    return scored;
  }

  runRepositions(repositions: readonly Reposition[]): ScoredCandidate[] {
    const scored: ScoredCandidate[] = [];
    for (const base of candidateGrid()) {
      for (const reposition of repositions) {
        if (this.exhausted(MAX_PERTURBATION_ATTEMPTS)) return scored;
        scored.push(this.evaluate(
          {
            ...base,
            repositionDirection: reposition.direction,
            repositionDistance: reposition.distance,
          },
          reposition.position,
        ));
      }
    }
    return scored;
  }

  async runRepositionsAsync(repositions: readonly Reposition[]): Promise<ScoredCandidate[]> {
    const scored: ScoredCandidate[] = [];
    for (const base of candidateGrid()) {
      for (const reposition of repositions) {
        if (this.exhausted(MAX_PERTURBATION_ATTEMPTS)) return scored;
        scored.push(this.evaluate(
          {
            ...base,
            repositionDirection: reposition.direction,
            repositionDistance: reposition.distance,
          },
          reposition.position,
        ));
        if (this.simulations % YIELD_INTERVAL === 0) await this.cooperativeYield();
      }
    }
    return scored;
  }

  evaluate(candidate: Candidate, origin: Vec2): ScoredCandidate {
    const projectile = createProjectile(candidate.weapon, origin, candidate.angleRadians, candidate.power);
    const simulated = simulateProjectile(
      { ...projectile, ownerId: this.shooter.id },
      {
        gravity: GAME_CONFIG.gravityPixelsPerSecondSquared,
        wind: this.input.match.wind,
        fixedStepSeconds: GAME_CONFIG.fixedStepSeconds,
        worldWidth: GAME_CONFIG.worldWidth,
        worldHeight: GAME_CONFIG.worldHeight,
      },
      position => this.collides(position, origin),
      MAX_SIMULATION_STEPS,
    );
    this.simulations += 1;
    return scoreCandidate(candidate, origin, simulated.projectile.position, this.input.match.aliens, this.shooter);
  }

  exhausted(reserveSimulations = 0): boolean {
    return this.simulations >= Math.max(0, this.limits.maxSimulations - reserveSimulations);
  }

  private async cooperativeYield(): Promise<void> {
    const yieldWork = this.input.yieldToBrowser?.() ?? Promise.resolve();
    await new Promise<void>(resolve => {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let finished = false;
      const finish = (): void => {
        if (finished) return;
        finished = true;
        if (timeout !== undefined) clearTimeout(timeout);
        resolve();
      };
      timeout = setTimeout(finish, this.limits.maxMilliseconds);
      void yieldWork.then(finish, finish);
    });
  }

  private collides(position: Vec2, origin: Vec2): boolean {
    if (isSolid(this.input.terrain, position)) return true;

    return this.input.match.aliens.some(alien => {
      if (alien.health <= 0) return false;
      // A projectile starts within its owner's hit circle, but may later return to it.
      if (alien.id === this.shooter.id && distance(position, origin) < GAME_CONFIG.alienRadius * 1.5) {
        return false;
      }
      return distance(position, alien.position) <= GAME_CONFIG.alienRadius;
    });
  }
}

function candidateGrid(repositionDirection?: -1 | 1): readonly Candidate[] {
  const weapons: readonly WeaponKind[] = ['bazooka', 'grenade'];
  const angles = [-2.9, -2.75, -2.6, -2.45, -2.3, -2.15, -2, -1.85, -1.7];
  const powers = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];

  return weapons.flatMap(weapon => angles.flatMap(angleRadians => powers.map(power => ({
    weapon,
    angleRadians,
    power,
    ...(repositionDirection === undefined ? {} : { repositionDirection }),
  }))));
}

function scoreCandidate(
  candidate: Candidate,
  origin: Vec2,
  explosion: Vec2,
  aliens: readonly AlienState[],
  shooter: AlienState,
): ScoredCandidate {
  let enemy = 0;
  let friendly = 0;
  let self = 0;

  for (const alien of aliens) {
    if (alien.health <= 0) continue;
    const damage = damageAtDistance(
      GAME_CONFIG.maxDamage,
      GAME_CONFIG.explosionRadius,
      distance(explosion, alien.position),
    );
    if (alien.id === shooter.id) self += damage;
    else if (alien.team === shooter.team) friendly += damage;
    else enemy += damage;
  }

  const repositionBonus = (MAX_REPOSITION_DISTANCE - (candidate.repositionDistance ?? 0)) * 0.25;
  return {
    candidate,
    origin,
    damage: { enemy, friendly, self },
    score: enemy === 0 ? -friendly * 4 - self * 6 : enemy - friendly * 4 - self * 6 + repositionBonus,
  };
}

function activeCpuAlien(match: MatchState): AlienState | null {
  const cpu = match.aliens.filter(alien => alien.team === 'cpu');
  const active = cpu[match.activeAlienIndex.cpu];
  return active !== undefined && active.health > 0 ? active : null;
}

interface Reposition {
  readonly position: Vec2;
  readonly direction: -1 | 1;
  readonly distance: number;
}

function safeRepositions(
  shooter: AlienState,
  terrain: AiTerrainProbe,
): readonly Reposition[] {
  const repositions: Reposition[] = [];
  for (const distance of REPOSITION_DISTANCES) {
    for (const direction of [-1, 1] as const) {
      const position = { x: shooter.position.x + direction * distance, y: shooter.position.y };
      const withinWorld = position.x >= GAME_CONFIG.alienRadius
        && position.x <= GAME_CONFIG.worldWidth - GAME_CONFIG.alienRadius;
      if (withinWorld && !isSolid(terrain, position)
        && terrain.hasSupport?.(position, GAME_CONFIG.alienRadius) !== false) {
        repositions.push({ position, direction, distance });
      }
    }
  }
  return repositions;
}

function isSolid(terrain: AiTerrainProbe, position: Vec2): boolean {
  return terrain.isSolid(Math.round(position.x), Math.round(position.y));
}

function hasPositiveScore(candidates: readonly ScoredCandidate[]): boolean {
  return candidates.some(candidate => candidate.score > 0);
}

function isSafe(candidate: ScoredCandidate): boolean {
  return candidate.damage.friendly === 0 && candidate.damage.self === 0;
}

function pass(simulations: number): AiDecision {
  return { command: { type: 'pass' }, simulations, predictedDamage: { enemy: 0, friendly: 0, self: 0 } };
}

function signedError(random: SeededRandom, maximum: number): number {
  return (random.next() * 2 - 1) * maximum;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function assertLimits(limits: AiLimits): void {
  if (!Number.isInteger(limits.maxSimulations) || limits.maxSimulations < 0) {
    throw new RangeError('Maximum simulations must be a non-negative integer');
  }
  if (!Number.isFinite(limits.maxMilliseconds) || limits.maxMilliseconds < 0) {
    throw new RangeError('Maximum milliseconds must be non-negative and finite');
  }
}
