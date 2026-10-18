import type { AgentNpc } from '@nabi/protocol';

export const activityLabel = (activity: string) =>
  activity.replaceAll('-', ' ');

export function agentMark(kind: string): string {
  switch (kind) {
    case 'claude-code':
      return 'C';
    case 'codex':
      return 'X';
    case 'cursor':
      return 'R';
    default:
      return 'G';
  }
}

export function agentKindName(kind: string): string {
  switch (kind) {
    case 'claude-code':
      return 'Claude Code';
    case 'codex':
      return 'Codex';
    case 'cursor':
      return 'Cursor';
    default:
      return 'Generic';
  }
}

export const truncate = (text: string, length: number) =>
  text.length > length ? `${text.slice(0, length - 1)}…` : text;

/** What a session is doing right now: the live observation, not just a state name. */
export function sessionLine(agent: AgentNpc): string {
  if (agent.activity === 'delegating' && agent.detail) return agent.detail;
  if (agent.activity === 'waiting-input') return 'Your turn: waiting for input';
  if (agent.activity === 'waiting-permission')
    return 'Needs permission to continue';
  if (agent.detail && agent.activity !== 'idle')
    return `${activityLabel(agent.activity)} · ${agent.detail}`;
  return activityLabel(agent.activity);
}
