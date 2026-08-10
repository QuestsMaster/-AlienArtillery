import { afterEach, describe, expect, it, vi } from 'vitest';
import { chooseAiDecision, chooseAiDecisionAsync } from '../../src/game/ai';
import type { AiCommand, AiInput } from '../../src/game/ai';
import { GAME_CONFIG } from '../../src/game/config';
import { distance } from '../../src/game/math';
import { simulateProjectile } from '../../src/game/physics';
import { createProjectile, damageAtDistance } from '../../src/game/weapons';
import type { AlienState, Vec2 } from '../../src/game/types';
import { alien, blockedInput, matchFixture, openFieldInput } from '../helpers/fixtures';

describe('bounded computer opponent', () => {
  afterEach(() => vi.useRealTimers());
  it('returns a legal shot within the simulation budget', () => {
    const result = chooseAiDecision(openFieldInput(), { maxSimulations: 240, maxMilliseconds: 250 });

    expect(result.command.type).toBe('fire');
    expect(result.simulations).toBeLessThanOrEqual(240);
  });

  it('chooses the same imperfect shot for the same match seed', () => {
    const first = chooseAiDecision(openFieldInput(), { maxSimulations: 160, maxMilliseconds: 250 });
    const second = chooseAiDecision(openFieldInput(), { maxSimulations: 160, maxMilliseconds: 250 });

    expect(first).toEqual(second);
  });

  it('uses the original CPU roster index when an earlier CPU is defeated', () => {
    const match = matchFixture();
    const result = chooseAiDecision(
      {
        ...openFieldInput(),
        match: matchFixture({
          activeTeam: 'cpu',
          activeAlienIndex: { human: 0, cpu: 1 },
          aliens: match.aliens.map(alien => {
            if (alien.id === 'cpu-0') return { ...alien, health: 0 };
            if (alien.id === 'cpu-1') return { ...alien, position: { x: 1_130, y: 720 } };
            if (alien.id === 'cpu-2') return { ...alien, position: { x: 1_500, y: 720 } };
            return alien;
          }),
        }),
        terrain: {
          hasSupport: () => true,
          isSolid: (x: number) => x > 1_400,
        },
      },
      { maxSimulations: 240, maxMilliseconds: 250 },
    );

    expect(result.command.type).toBe('fire');
  });

  it('does not harm its team when a safe target shot is available', () => {
    const input = openFieldInput();
    const result = chooseAiDecision(input, { maxSimulations: 240, maxMilliseconds: 250 });

    expect(result.command.type).toBe('fire');
    expect(result.predictedDamage.friendly).toBe(0);
    expect(result.predictedDamage.self).toBe(0);
  });

  it('rejects perturbed shots that actually endanger a tightly placed teammate', () => {
    const base = matchFixture();
    const unsafeSeeds: number[] = [];
    let fired = 0;

    for (let seed = 1; seed <= 40; seed += 1) {
      const input: AiInput = {
        ...openFieldInput(),
        match: matchFixture({
          activeTeam: 'cpu',
          seed,
          aliens: base.aliens.map(candidate => {
            if (candidate.team === 'human') {
              return alien({
                ...candidate,
                health: candidate.id === 'human-2' ? 100 : 0,
                position: candidate.id === 'human-2' ? { x: 470, y: 640 } : candidate.position,
              });
            }
            if (candidate.id === 'cpu-0') return alien({ ...candidate, position: { x: 1_130, y: 720 } });
            if (candidate.id === 'cpu-1') return alien({ ...candidate, position: { x: 470, y: 712 } });
            return alien({ ...candidate, health: 0 });
          }),
        }),
      };
      const result = chooseAiDecision(input, { maxSimulations: 240, maxMilliseconds: 250 });
      if (result.command.type === 'pass') continue;

      fired += 1;
      const actual = simulateReturnedDamage(input, result.command);
      expect(result.predictedDamage).toEqual(actual);
      if (actual.friendly > 0 || actual.self > 0) unsafeSeeds.push(seed);
    }

    expect(fired).toBeGreaterThan(0);
    expect(unsafeSeeds).toEqual([]);
  });

  it('chooses the same count-bounded result under different production clock speeds', () => {
    let fastClock = 0;
    const fast = chooseAiDecision(
      { ...openFieldInput(), clock: { nowMilliseconds: () => fastClock++ } },
      { maxSimulations: 160, maxMilliseconds: 1 },
    );
    let slowClock = 0;
    const slow = chooseAiDecision(
      { ...openFieldInput(), clock: { nowMilliseconds: () => (slowClock += 1_000) } },
      { maxSimulations: 160, maxMilliseconds: 1 },
    );

    expect(slow).toEqual(fast);
  });

  it('always returns a turn-ending fallback', () => {
    const result = chooseAiDecision(blockedInput(), { maxSimulations: 12, maxMilliseconds: 250 });

    expect(['fire', 'pass']).toContain(result.command.type);
  });

  it('passes rather than firing when no living enemy can be damaged', () => {
    const match = matchFixture({
      activeTeam: 'cpu',
      aliens: matchFixture().aliens.map(alien => alien.team === 'human' ? { ...alien, health: 0 } : alien),
    });

    const result = chooseAiDecision(
      { ...openFieldInput(), match },
      { maxSimulations: 240, maxMilliseconds: 250 },
    );

    expect(result.command).toEqual({ type: 'pass' });
  });

  it('prefers the nearer safe reposition that opens the same shot', () => {
    const match = matchFixture();
    const result = chooseAiDecision(
      {
        ...openFieldInput(),
        match: matchFixture({
          activeTeam: 'cpu',
          aliens: match.aliens.map(candidate => candidate.team === 'human'
            ? {
              ...candidate,
              health: candidate.id === 'human-0' ? 100 : 0,
              position: candidate.id === 'human-0' ? { x: 1_015, y: 720 } : candidate.position,
            }
            : candidate),
        }),
        terrain: {
          hasSupport: (position: Vec2) => position.x < 1_130,
          isSolid: (x: number, y: number) => y < 720 && x > 1_120 && x < 1_130,
        },
      },
      { maxSimulations: 240, maxMilliseconds: 250 },
    );

    expect(result.command).toMatchObject({
      type: 'fire',
      repositionDirection: -1,
      repositionDistance: 15,
    });
  });

  it('awaits a genuine cooperative browser yield after a batch of forty simulations', async () => {
    let release: (() => void) | undefined;
    let settled = false;
    const input = {
      ...openFieldInput(),
      match: matchFixture({ activeTeam: 'cpu' }),
      yieldToBrowser: () => new Promise<void>(resolve => { release = resolve; }),
    };

    const decision = chooseAiDecisionAsync(input, { maxSimulations: 41, maxMilliseconds: 250 });
    void decision.then(() => { settled = true; });
    await Promise.resolve();

    expect(release).toBeTypeOf('function');
    expect(settled).toBe(false);
    release!();
    const result = await decision;

    expect(result.simulations).toBeLessThanOrEqual(41);
  });

  it('uses the wall budget only as a fallback for a browser yield that never resolves', async () => {
    vi.useFakeTimers();
    let settled = false;
    const decision = chooseAiDecisionAsync({
      ...openFieldInput(),
      yieldToBrowser: () => new Promise<void>(() => undefined),
    }, { maxSimulations: 41, maxMilliseconds: 5 });
    void decision.then(() => { settled = true; });

    await vi.advanceTimersByTimeAsync(6);
    await Promise.resolve();

    expect(settled).toBe(true);
    await expect(decision).resolves.toMatchObject({ simulations: 41 });
  });
});

function simulateReturnedDamage(
  input: AiInput,
  command: Extract<AiCommand, { type: 'fire' }>,
): { enemy: number; friendly: number; self: number } {
  const cpu = input.match.aliens.filter(candidate => candidate.team === 'cpu');
  const shooter = cpu[input.match.activeAlienIndex.cpu]!;
  const origin = command.repositionDirection === undefined
    ? shooter.position
    : {
      x: shooter.position.x + command.repositionDirection * command.repositionDistance!,
      y: shooter.position.y,
    };
  const projectile = createProjectile(command.weapon, origin, command.angleRadians, command.power);
  const simulation = simulateProjectile(
    { ...projectile, ownerId: shooter.id },
    {
      gravity: GAME_CONFIG.gravityPixelsPerSecondSquared,
      wind: input.match.wind,
      fixedStepSeconds: GAME_CONFIG.fixedStepSeconds,
      worldWidth: GAME_CONFIG.worldWidth,
      worldHeight: GAME_CONFIG.worldHeight,
    },
    position => isCollision(input, shooter, origin, position),
    600,
  );

  return damageAt(simulation.projectile.position, input.match.aliens, shooter);
}

function isCollision(input: AiInput, shooter: AlienState, origin: Vec2, position: Vec2): boolean {
  const terrainCollision = input.terrain.isSolid(Math.round(position.x), Math.round(position.y));
  if (terrainCollision) return true;

  return input.match.aliens.some(candidate => candidate.health > 0
    && !(candidate.id === shooter.id && distance(position, origin) < GAME_CONFIG.alienRadius * 1.5)
    && distance(position, candidate.position) <= GAME_CONFIG.alienRadius);
}

function damageAt(
  explosion: Vec2,
  aliens: readonly AlienState[],
  shooter: AlienState,
): { enemy: number; friendly: number; self: number } {
  const damage = { enemy: 0, friendly: 0, self: 0 };
  for (const candidate of aliens) {
    if (candidate.health <= 0) continue;
    const amount = damageAtDistance(
      GAME_CONFIG.maxDamage,
      GAME_CONFIG.explosionRadius,
      distance(explosion, candidate.position),
    );
    if (candidate.id === shooter.id) damage.self += amount;
    else if (candidate.team === shooter.team) damage.friendly += amount;
    else damage.enemy += amount;
  }
  return damage;
}
