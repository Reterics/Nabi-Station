import { readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { AgentNpc } from '@nabi/protocol';
import { codexHome, displayPath } from '../paths';
import {
  WAITING_INPUT_WINDOW_MS,
  type AgentAdapter,
  type AgentObservation,
} from './types';

/** Threads untouched for longer are not shown: without a pid we cannot tell idle from closed. */
export const CODEX_LIVE_WINDOW_MS = 30 * 60_000;

export interface CodexThread {
  id: string;
  cwd: string;
  source: string;
  updatedAtMs: number;
}
export interface CodexTurn {
  status: string;
}

export function activityForItem(
  itemType: string | undefined,
): AgentNpc['activity'] {
  switch (itemType) {
    case 'fileChange':
      return 'editing';
    case 'commandExecution':
    case 'mcpToolCall':
      return 'running-tool';
    case 'webSearch':
    case 'imageView':
      return 'reading';
    default:
      return 'working';
  }
}

/** Pure mapping from the latest turn and item to an activity. */
export function codexActivity(
  thread: CodexThread,
  turn: CodexTurn | undefined,
  lastItemType: string | undefined,
  now: number,
): Pick<AgentNpc, 'activity' | 'confidence' | 'detail'> {
  switch (turn?.status) {
    case 'inProgress':
      return {
        activity: activityForItem(lastItemType),
        confidence: 'high',
        detail: lastItemType
          ? `Turn in progress: ${lastItemType}`
          : 'Turn in progress',
      };
    case 'failed':
      return {
        activity: 'failed',
        confidence: 'high',
        detail: 'Last turn failed',
      };
    case 'interrupted':
      return {
        activity: 'idle',
        confidence: 'medium',
        detail: 'Last turn interrupted',
      };
  }
  const detail = turn ? `Last turn ${turn.status}` : 'No turn history';
  return now - thread.updatedAtMs < WAITING_INPUT_WINDOW_MS
    ? { activity: 'waiting-input', confidence: 'medium', detail }
    : { activity: 'idle', confidence: 'low', detail };
}

/** Highest-versioned `<prefix>_<n>.sqlite`; the version changes with Codex's schema. */
export function latestVersioned(
  files: string[],
  prefix: string,
): string | undefined {
  const pattern = new RegExp(`^${prefix}_(\\d+)\\.sqlite$`);
  return files
    .map((file) => ({ file, version: Number(pattern.exec(file)?.[1] ?? NaN) }))
    .filter(({ version }) => !Number.isNaN(version))
    .sort((a, b) => b.version - a.version)[0]?.file;
}

const columns = (db: DatabaseSync, table: string) =>
  new Set(
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
      (column) => column.name,
    ),
  );

export class CodexAdapter implements AgentAdapter {
  readonly kind = 'codex' as const;
  constructor(private readonly home = codexHome()) {}

  async discover(now: number): Promise<AgentObservation[]> {
    let files: string[];
    try {
      files = await readdir(this.home);
    } catch {
      return [];
    }
    const stateFile = latestVersioned(files, 'state');
    if (!stateFile) return [];
    const historyFile = latestVersioned(files, 'thread_history');
    // node:sqlite is still flagged experimental; load it only when Codex is present.
    const { DatabaseSync } = await import('node:sqlite');
    const openReadOnly = (file: string) =>
      new DatabaseSync(join(this.home, file), { readOnly: true });

    const state = openReadOnly(stateFile);
    let threads: CodexThread[];
    try {
      const threadColumns = columns(state, 'threads');
      const updated = threadColumns.has('updated_at_ms')
        ? 'updated_at_ms'
        : 'updated_at * 1000';
      const archived = threadColumns.has('archived') ? 'AND archived = 0' : '';
      threads = (
        state
          .prepare(
            // Thread titles are generated from the user's prompt, so they are never read.
            `SELECT id, cwd, source, ${updated} AS updatedAtMs FROM threads
             WHERE ${updated} > ? ${archived} ORDER BY ${updated} DESC LIMIT 50`,
          )
          .all(now - CODEX_LIVE_WINDOW_MS) as unknown as CodexThread[]
      )
        // Subagent threads (source is JSON, e.g. a guardian review) belong to a parent session.
        .filter((thread) => !thread.source.startsWith('{'));
    } finally {
      state.close();
    }
    if (threads.length === 0) return [];

    const history = historyFile ? openReadOnly(historyFile) : undefined;
    try {
      const lastTurn = history?.prepare(
        'SELECT turn_id AS turnId, status FROM thread_turns WHERE thread_id = ? ORDER BY rollout_ordinal DESC LIMIT 1',
      );
      const lastItem = history?.prepare(
        'SELECT item_type AS itemType FROM thread_items WHERE thread_id = ? AND turn_id = ? ORDER BY rollout_ordinal DESC LIMIT 1',
      );
      return threads.map((thread) => {
        const turn = lastTurn?.get(thread.id) as
          { turnId: string; status: string } | undefined;
        const item = turn
          ? (lastItem?.get(thread.id, turn.turnId) as
              { itemType: string } | undefined)
          : undefined;
        const cwd = displayPath(thread.cwd);
        return {
          id: `codex:${thread.id}`,
          name: `Codex · ${basename(cwd) || cwd} ${thread.id.slice(-4)}`,
          kind: this.kind,
          source: `Codex thread state (${thread.source})`,
          ...codexActivity(thread, turn, item?.itemType, now),
          sessionId: thread.id,
          cwd,
          updatedAt: thread.updatedAtMs,
        };
      });
    } finally {
      history?.close();
    }
  }
}
