import type { TurnPhase } from '../game/types';

export interface TerminalAction {
  readonly label: string;
}

export function terminalActionFor(phase: TurnPhase): TerminalAction | null {
  return phase === 'complete' ? { label: 'Новый матч' } : null;
}
