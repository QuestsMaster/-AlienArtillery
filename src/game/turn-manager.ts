import { GAME_CONFIG } from './config';
import type { AlienState, MatchOutcome, MatchState, TeamId, TurnPhase } from './types';

const NEXT_PHASE: Readonly<Record<TurnPhase, TurnPhase>> = {
  ready: 'aiming',
  aiming: 'projectile',
  projectile: 'settling',
  settling: 'complete',
  complete: 'ready',
};

export function startTurn(match: MatchState, nextPhase?: TurnPhase): MatchState {
  const phase = nextPhase ?? (match.phase === 'complete' ? 'ready' : match.phase);
  if (phase === match.phase || NEXT_PHASE[match.phase] !== phase) {
    throw new Error('Invalid turn transition');
  }
  if (phase !== 'ready') return { ...match, phase };

  const selectedAlien = activeAlien(match);
  const aliens = match.aliens.map(alien => alien.id === selectedAlien?.id
    ? { ...alien, jumpsUsed: 0 }
    : alien);

  return {
    ...match,
    phase,
    aliens,
    humanTurnSecondsRemaining: match.activeTeam === 'human'
      ? GAME_CONFIG.humanTurnSeconds
      : match.humanTurnSecondsRemaining,
    dynamicSecondsRemaining: GAME_CONFIG.dynamicTimeoutSeconds,
  };
}

export function tickHumanTurn(match: MatchState, elapsedSeconds: number, visible: boolean): MatchState {
  if (!visible || match.activeTeam !== 'human' || elapsedSeconds <= 0) return match;

  const humanTurnSecondsRemaining = Math.max(0, match.humanTurnSecondsRemaining - elapsedSeconds);
  return {
    ...match,
    humanTurnSecondsRemaining,
    phase: humanTurnSecondsRemaining === 0 ? 'complete' : match.phase,
  };
}

export function advanceTurn(match: MatchState): MatchState {
  const winner = findWinner(match);
  if (winner !== null) return { ...match, winner, phase: 'complete' };

  const outgoingTeam = match.activeTeam;
  const activeTeam = otherTeam(outgoingTeam);
  const activeAlienIndex = {
    ...match.activeAlienIndex,
    [outgoingTeam]: nextLivingIndex(
      match.aliens,
      outgoingTeam,
      match.activeAlienIndex[outgoingTeam],
    ),
    [activeTeam]: retainedLivingIndex(
      match.aliens,
      activeTeam,
      match.activeAlienIndex[activeTeam],
    ),
  };
  const next = {
    ...match,
    turnNumber: match.turnNumber + 1,
    activeTeam,
    activeAlienIndex,
    phase: 'complete' as const,
  };

  return startTurn(next);
}

export function findWinner(match: Pick<MatchState, 'aliens'>): MatchOutcome | null {
  const humanAlive = match.aliens.some(alien => alien.team === 'human' && alien.health > 0);
  const cpuAlive = match.aliens.some(alien => alien.team === 'cpu' && alien.health > 0);
  if (!humanAlive && !cpuAlive) return 'draw';
  if (humanAlive && cpuAlive) return null;
  return humanAlive ? 'human' : 'cpu';
}

function activeAlien(match: MatchState): AlienState | undefined {
  const index = match.activeAlienIndex[match.activeTeam];
  const candidate = match.aliens.filter(alien => alien.team === match.activeTeam)[index];
  return candidate?.health > 0 ? candidate : undefined;
}

function nextLivingIndex(
  aliens: readonly AlienState[],
  team: TeamId,
  currentIndex: number,
): number {
  const members = aliens.filter(alien => alien.team === team);
  for (let offset = 1; offset <= members.length; offset += 1) {
    const index = (currentIndex + offset) % members.length;
    if (members[index]?.health > 0) return index;
  }
  return 0;
}

function retainedLivingIndex(
  aliens: readonly AlienState[],
  team: TeamId,
  currentIndex: number,
): number {
  const members = aliens.filter(alien => alien.team === team);
  if (members[currentIndex]?.health > 0) return currentIndex;
  return nextLivingIndex(aliens, team, currentIndex);
}

function otherTeam(team: TeamId): TeamId {
  return team === 'human' ? 'cpu' : 'human';
}
