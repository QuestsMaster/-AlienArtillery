import { describe, expect, it } from 'vitest';
import { advanceTurn, findWinner, startTurn, tickHumanTurn } from '../../src/game/turn-manager';
import type { TurnPhase } from '../../src/game/types';
import { matchFixture, matchWithHumanHealth, nextWithCpuTurnComplete } from '../helpers/fixtures';

describe('turn manager', () => {
  it('starts a turn in the ready phase and resets the active alien jump', () => {
    const match = matchFixture({
      phase: 'complete',
      humanTurnSecondsRemaining: 0,
      aliens: matchFixture().aliens.map((candidate, index) => index === 0
        ? { ...candidate, jumpsUsed: 1 }
        : candidate),
    });

    const next = startTurn(match);

    expect(next.phase).toBe('ready');
    expect(next.humanTurnSecondsRemaining).toBe(35);
    expect(next.aliens[0]!.jumpsUsed).toBe(0);
  });

  it('moves through the approved phase order', () => {
    const ready = matchFixture();
    const aiming = startTurn(ready, 'aiming');
    const projectile = startTurn(aiming, 'projectile');
    const settling = startTurn(projectile, 'settling');
    const complete = startTurn(settling, 'complete');

    expect(complete.phase).toBe('complete');
  });

  it('rejects an illegal phase transition', () => {
    expect(() => startTurn(matchFixture(), 'projectile')).toThrow('Invalid turn transition');
  });

  it.each<TurnPhase>(['ready', 'aiming', 'projectile', 'settling', 'complete'])(
    'rejects a same-phase %s transition',
    phase => {
      expect(() => startTurn(matchFixture({ phase }), phase))
        .toThrowError(/^Invalid turn transition$/);
    },
  );

  it('subtracts human time only while the tab is visible and completes at zero', () => {
    const initial = matchFixture({ humanTurnSecondsRemaining: 1 });

    expect(tickHumanTurn(initial, 0.5, false)).toEqual(initial);
    const timed = tickHumanTurn(initial, 1.5, true);
    expect(timed.humanTurnSecondsRemaining).toBe(0);
    expect(timed.phase).toBe('complete');
  });

  it('rotates past defeated aliens', () => {
    const next = advanceTurn(matchWithHumanHealth([0, 50, 0]));

    expect(next.activeTeam).toBe('cpu');
    const again = advanceTurn(nextWithCpuTurnComplete(next));
    expect(again.activeAlienIndex.human).toBe(1);
  });

  it('hands the initial human turn to cpu-0', () => {
    const next = advanceTurn(matchFixture());

    expect(next.activeTeam).toBe('cpu');
    expect(next.activeAlienIndex).toEqual({ human: 1, cpu: 0 });
  });

  it('advances each outgoing roster cyclically for its following turn', () => {
    const cpuZero = advanceTurn(matchFixture());
    const humanOne = advanceTurn({ ...cpuZero, phase: 'complete' });
    const cpuOne = advanceTurn({ ...humanOne, phase: 'complete' });

    expect(humanOne.activeTeam).toBe('human');
    expect(humanOne.activeAlienIndex).toEqual({ human: 1, cpu: 1 });
    expect(cpuOne.activeTeam).toBe('cpu');
    expect(cpuOne.activeAlienIndex).toEqual({ human: 2, cpu: 1 });
  });

  it('skips a defeated incoming alien at the retained roster index', () => {
    const match = matchFixture();
    const next = advanceTurn(matchFixture({
      aliens: match.aliens.map(candidate => candidate.id === 'cpu-0'
        ? { ...candidate, health: 0 }
        : candidate),
    }));

    expect(next.activeTeam).toBe('cpu');
    expect(next.activeAlienIndex.cpu).toBe(1);
  });

  it('returns the surviving team when its opponent has no living aliens', () => {
    const match = matchFixture({
      aliens: matchFixture().aliens.map(candidate => candidate.team === 'cpu'
        ? { ...candidate, health: 0 }
        : candidate),
    });

    expect(findWinner(match)).toBe('human');
  });

  it('returns a draw when simultaneous damage defeats both teams', () => {
    const match = matchFixture({
      aliens: matchFixture().aliens.map(candidate => ({ ...candidate, health: 0 })),
    });

    expect(findWinner(match)).toBe('draw');
  });
});
