import { readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { mcpHelper, type AgentNpc, type Helper } from '@nabi/protocol';
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

/** One MCP call or web search; only its identity and status, never arguments or results. */
export interface CodexHelperItem {
  itemId: string;
  itemType: string;
  server: string | null;
  tool: string | null;
  status: string | null;
  createdAtMs: number;
}

const HELPER_RECENT_MS = 15 * 60_000;

/**
 * Helpers from a thread's recent items, newest first. A call is running when the
 * turn is in progress and it is either reported `inProgress` or the turn's last item.
 */
export function codexHelpers(
  items: CodexHelperItem[],
  turnInProgress: boolean,
  lastItemId: string | undefined,
): Helper[] {
  const helpers = new Map<string, Helper>();
  for (const item of items) {
    const identity =
      item.itemType === 'webSearch'
        ? { id: 'web', label: 'Web', category: 'web' as const, tool: 'search' }
        : item.server && item.tool
          ? mcpHelper(item.server, item.tool)
          : null;
    if (!identity) continue;
    const running =
      turnInProgress &&
      (item.status === 'inProgress' || item.itemId === lastItemId);
    const previous = helpers.get(identity.id);
    helpers.set(identity.id, {
      ...identity,
      state: running
        ? 'active'
        : previous?.state === 'active'
          ? 'active'
          : item.status === 'failed'
            ? 'failed'
            : 'recent',
      calls: (previous?.calls ?? 0) + 1,
      lastUsedAt: item.createdAtMs,
    });
  }
  return [...helpers.values()].sort(
    (a, b) =>
      Number(b.state === 'active') - Number(a.state === 'active') ||
      (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0),
  );
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
        'SELECT item_id AS itemId, item_type AS itemType FROM thread_items WHERE thread_id = ? AND turn_id = ? ORDER BY rollout_ordinal DESC LIMIT 1',
      );
      // json_extract keeps arguments and results inside SQLite; only names leave it.
      const helperItems = history?.prepare(
        `SELECT item_id AS itemId, item_type AS itemType,
           json_extract(item_json, '$.server') AS server,
           json_extract(item_json, '$.tool') AS tool,
           json_extract(item_json, '$.status') AS status,
           created_at_ms AS createdAtMs
         FROM thread_items
         WHERE thread_id = ? AND item_type IN ('mcpToolCall', 'webSearch') AND created_at_ms > ?
         ORDER BY rollout_ordinal LIMIT 200`,
      );
      return threads.map((thread) => {
        const turn = lastTurn?.get(thread.id) as
          { turnId: string; status: string } | undefined;
        const item = turn
          ? (lastItem?.get(thread.id, turn.turnId) as
              { itemId: string; itemType: string } | undefined)
          : undefined;
        const helpers = codexHelpers(
          (helperItems?.all(thread.id, now - HELPER_RECENT_MS) ??
            []) as unknown as CodexHelperItem[],
          turn?.status === 'inProgress',
          item?.itemId,
        );
        const activity = codexActivity(thread, turn, item?.itemType, now);
        const active = helpers.filter((helper) => helper.state === 'active');
        const cwd = displayPath(thread.cwd);
        return {
          id: `codex:${thread.id}`,
          name: `Codex · ${basename(cwd) || cwd} ${thread.id.slice(-4)}`,
          kind: this.kind,
          source: `Codex thread state (${thread.source})`,
          ...(activity.activity !== 'failed' && active.length > 0
            ? {
                activity: 'delegating' as const,
                confidence: 'high' as const,
                detail: `Waiting on ${active.map((helper) => helper.label).join(', ')}`,
              }
            : activity),
          helpers,
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
