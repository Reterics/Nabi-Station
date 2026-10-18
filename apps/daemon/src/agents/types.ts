import type { AgentNpc } from '@nabi/protocol';

/** An agent as an adapter sees it: everything except its place in the city. */
export type AgentObservation = Omit<AgentNpc, 'repoId'> & { cwd: string };

export interface AgentAdapter {
  kind: AgentNpc['kind'];
  discover(now: number): Promise<AgentObservation[]>;
}

/** Turn-complete sessions count as "your turn" for this long, then as idle. */
export const WAITING_INPUT_WINDOW_MS = 10 * 60_000;
