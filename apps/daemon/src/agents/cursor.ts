import { open, readdir, readFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { AgentNpc } from '@nabi/protocol';
import { cursorConfigDir, cursorUserDir, displayPath } from '../paths';
import {
  WAITING_INPUT_WINDOW_MS,
  type AgentAdapter,
  type AgentObservation,
} from './types';

/**
 * Sessions with no pid count as present for this long after the last write.
 * Same bound as Codex: a closed Cursor chat and an idle one look alike on disk.
 */
export const CURSOR_LIVE_WINDOW_MS = 30 * 60_000;
/** A transcript that ends on a user turn is "just prompted" only while it is fresh. */
const PROMPT_FRESH_MS = 2 * 60_000;
const TAIL_BYTES = 256 * 1024;

export interface CursorTool {
  name: string;
  path?: string;
}

export interface CursorTranscriptTail {
  /** Last tool call with no `turn_ended` after it. Tool results are not in the file. */
  pendingTool?: CursorTool;
  /** Status of the last `turn_ended` that nothing newer supersedes. */
  turnStatus?: string;
  /** The file ends on a user turn, so a prompt has been sent and not answered yet. */
  promptOpen?: boolean;
}

export interface CursorSignals {
  composerStatus?: string;
  pendingTool?: CursorTool;
  turnStatus?: string;
  promptOpen?: boolean;
  updatedAt: number;
}

const READING =
  /^(Read|Grep|Glob|SemanticSearch|WebSearch|WebFetch|ListMcpResources|FetchMcpResource|ReadLints)$/;
const EDITING = /^(Write|StrReplace|EditNotebook|Delete|Edit|MultiEdit)$/;
const RUNNING = /^(Shell|Bash|AwaitShell|PowerShell)$/;
const DELEGATING = /^(Task|Agent|Subagent)$/;

export function activityForCursorTool(name: string): AgentNpc['activity'] {
  if (READING.test(name)) return 'reading';
  if (EDITING.test(name)) return 'editing';
  if (RUNNING.test(name)) return 'running-tool';
  if (DELEGATING.test(name)) return 'delegating';
  return 'working';
}

const describeTool = (tool: CursorTool) => {
  const text = tool.path ? `${tool.name} ${tool.path}` : tool.name;
  return text.length > 180 ? `${text.slice(0, 177)}…` : text;
};

/**
 * Composer `status` comes from Cursor's state database. Transcript signals are
 * only tool names, paths and `turn_ended` status — message text is never read.
 */
export function cursorActivity(
  signals: CursorSignals,
  now: number,
): Pick<AgentNpc, 'activity' | 'confidence' | 'detail'> {
  const { pendingTool, composerStatus, turnStatus } = signals;
  if (composerStatus === 'generating') {
    return pendingTool
      ? {
          activity: activityForCursorTool(pendingTool.name),
          confidence: 'high',
          detail: describeTool(pendingTool),
        }
      : { activity: 'working', confidence: 'high', detail: 'Generating' };
  }
  if (composerStatus === 'aborted')
    return {
      activity: 'idle',
      confidence: 'medium',
      detail: 'Generation aborted',
    };
  if (turnStatus === 'error')
    return {
      activity: 'failed',
      confidence: 'high',
      detail: 'Last turn failed',
    };
  if (pendingTool)
    return {
      activity: activityForCursorTool(pendingTool.name),
      confidence: 'medium',
      detail: describeTool(pendingTool),
    };
  if (signals.promptOpen && now - signals.updatedAt < PROMPT_FRESH_MS)
    return {
      activity: 'working',
      confidence: 'medium',
      detail: 'Prompt received',
    };
  const detail = composerStatus
    ? `Composer status "${composerStatus}"`
    : turnStatus
      ? `Last turn ${turnStatus}`
      : 'Transcript updated';
  return now - signals.updatedAt < WAITING_INPUT_WINDOW_MS
    ? { activity: 'waiting-input', confidence: 'medium', detail }
    : { activity: 'idle', confidence: 'low', detail };
}

/**
 * Walks JSONL and keeps only tool names, path fields and turn status.
 * `text` may start mid-line; partial lines are skipped. Message text is ignored.
 */
export function parseCursorTranscriptTail(text: string): CursorTranscriptTail {
  let pendingTool: CursorTool | undefined;
  let turnStatus: string | undefined;
  let promptOpen = false;
  for (const line of text.split('\n')) {
    let entry: {
      type?: string;
      status?: string;
      role?: string;
      message?: { content?: unknown };
    };
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type === 'turn_ended') {
      pendingTool = undefined;
      promptOpen = false;
      turnStatus = typeof entry.status === 'string' ? entry.status : undefined;
      continue;
    }
    if (entry.role !== 'assistant' && entry.role !== 'user') continue;
    promptOpen = entry.role === 'user';
    if (entry.role === 'user') {
      pendingTool = undefined;
      turnStatus = undefined;
      continue;
    }
    promptOpen = false;
    turnStatus = undefined;
    const content = Array.isArray(entry.message?.content)
      ? entry.message.content
      : [];
    for (const block of content as Record<string, unknown>[]) {
      if (block.type !== 'tool_use' || typeof block.name !== 'string') continue;
      const input = (block.input ?? {}) as Record<string, unknown>;
      const path = [
        input.path,
        input.file_path,
        input.target_file,
        input.notebook_path,
      ].find((value): value is string => typeof value === 'string');
      pendingTool = { name: block.name, ...(path && { path }) };
    }
  }
  return {
    ...(pendingTool && { pendingTool }),
    ...(turnStatus && { turnStatus }),
    ...(promptOpen && { promptOpen }),
  };
}

/** `meta.json` beside a Cursor chat store. Only the working directory is used. */
export function cwdFromMeta(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ['cwd', 'workspacePath', 'folder']) {
    const candidate = record[key];
    if (typeof candidate === 'string' && candidate.length > 0) return candidate;
  }
  return undefined;
}

/** `file:///C:/work` and `file:///d%3A/git/repo` → a filesystem path. */
export function pathFromFileUri(uri: string): string | undefined {
  if (!uri.startsWith('file:')) return undefined;
  try {
    let pathname = decodeURIComponent(new URL(uri).pathname);
    if (/^\/[A-Za-z]:/.test(pathname)) pathname = pathname.slice(1);
    return pathname || undefined;
  } catch {
    return undefined;
  }
}

export function workspacePath(
  fsPath: unknown,
  external: unknown,
  uriPath: unknown,
): string | undefined {
  if (typeof fsPath === 'string' && fsPath.length > 0) return fsPath;
  if (typeof external === 'string') {
    const parsed = pathFromFileUri(external);
    if (parsed) return parsed;
  }
  if (typeof uriPath === 'string' && uriPath.length > 0) return uriPath;
  return undefined;
}

interface TranscriptHit {
  id: string;
  file: string;
  mtimeMs: number;
}

interface ComposerRow {
  id: string;
  cwd?: string;
  status?: string;
  updatedAt: number;
  draft?: boolean;
}

const flagged = (value: unknown) =>
  value === true || value === 1 || value === '1' || value === 'true';

const asTime = (value: unknown) => {
  const time = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(time) ? time : undefined;
};

async function readTail(path: string): Promise<string> {
  const handle = await open(path, 'r');
  try {
    const { size } = await handle.stat();
    const length = Math.min(size, TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, Math.max(0, size - length));
    return buffer.toString('utf8');
  } finally {
    await handle.close();
  }
}

const columnsOf = (db: DatabaseSync, table: string) =>
  new Set(
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
      (column) => column.name,
    ),
  );

export class CursorAdapter implements AgentAdapter {
  readonly kind = 'cursor' as const;

  constructor(
    private readonly configDir = cursorConfigDir(),
    private readonly userDir = cursorUserDir(),
  ) {}

  async discover(now: number): Promise<AgentObservation[]> {
    const since = now - CURSOR_LIVE_WINDOW_MS;
    const transcripts = await this.recentTranscripts(since).catch(
      () => [] as TranscriptHit[],
    );
    const [cwds, composers] = await Promise.all([
      this.chatCwds(new Set(transcripts.map((hit) => hit.id))).catch(
        () => new Map<string, string>(),
      ),
      this.composers(since).catch(() => [] as ComposerRow[]),
    ]);

    const sessions = new Map<
      string,
      {
        cwd?: string;
        status?: string;
        updatedAt: number;
        composer: boolean;
        transcript: boolean;
        tail: CursorTranscriptTail;
      }
    >();
    for (const composer of composers) {
      sessions.set(composer.id, {
        cwd: composer.cwd,
        status: composer.status,
        updatedAt: composer.updatedAt,
        composer: true,
        transcript: false,
        tail: {},
      });
    }
    const tails = await Promise.all(
      transcripts.map(async (hit) => ({
        hit,
        tail: parseCursorTranscriptTail(
          await readTail(hit.file).catch(() => ''),
        ),
      })),
    );
    for (const { hit, tail } of tails) {
      const existing = sessions.get(hit.id);
      const cwd = cwds.get(hit.id) ?? existing?.cwd;
      sessions.set(hit.id, {
        cwd,
        status: existing?.status,
        updatedAt: Math.max(existing?.updatedAt ?? 0, hit.mtimeMs),
        composer: existing?.composer ?? false,
        transcript: true,
        tail,
      });
    }

    return [...sessions.entries()]
      .sort(([, a], [, b]) => b.updatedAt - a.updatedAt)
      .slice(0, 50)
      .map(([id, session]) => {
        const cwd = session.cwd ? displayPath(session.cwd) : '';
        const folder = basename(cwd);
        return {
          id: `cursor:${id}`,
          name: `Cursor · ${folder || 'session'} ${id.slice(-4)}`,
          kind: this.kind,
          source:
            session.composer && session.transcript
              ? 'Cursor composer state and agent transcript'
              : session.composer
                ? 'Cursor composer state'
                : 'Cursor agent transcript',
          ...cursorActivity(
            {
              composerStatus: session.status,
              updatedAt: session.updatedAt,
              ...session.tail,
            },
            now,
          ),
          sessionId: id,
          cwd,
          updatedAt: session.updatedAt,
        };
      });
  }

  /** `<projects>/<slug>/agent-transcripts/<id>/<id>.jsonl`, plus a flat `<id>.jsonl`. */
  private async recentTranscripts(since: number): Promise<TranscriptHit[]> {
    const projects = join(this.configDir, 'projects');
    let slugs: string[];
    try {
      slugs = await readdir(projects);
    } catch {
      return [];
    }
    const hits: TranscriptHit[] = [];
    await Promise.all(
      slugs.map(async (slug) => {
        let entries: string[];
        try {
          entries = await readdir(join(projects, slug, 'agent-transcripts'));
        } catch {
          return;
        }
        await Promise.all(
          entries.map(async (entry) => {
            if (entry === 'subagents' || entry.startsWith('.')) return;
            const root = join(projects, slug, 'agent-transcripts', entry);
            const info = await stat(root).catch(() => undefined);
            if (!info) return;
            const file = info.isDirectory()
              ? join(root, `${entry}.jsonl`)
              : entry.endsWith('.jsonl')
                ? root
                : undefined;
            if (!file) return;
            const fileInfo =
              file === root ? info : await stat(file).catch(() => undefined);
            if (!fileInfo?.isFile() || fileInfo.mtimeMs < since) return;
            const id = basename(file, '.jsonl');
            if (id) hits.push({ id, file, mtimeMs: fileInfo.mtimeMs });
          }),
        );
      }),
    );
    return hits.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 50);
  }

  /** `chats/<hash>/<id>/meta.json` holds the cwd. `store.db` (message blobs) is never opened. */
  private async chatCwds(wanted: Set<string>): Promise<Map<string, string>> {
    const found = new Map<string, string>();
    if (wanted.size === 0) return found;
    let hashes: string[];
    try {
      hashes = await readdir(join(this.configDir, 'chats'));
    } catch {
      return found;
    }
    await Promise.all(
      hashes.map(async (hash) => {
        let ids: string[];
        try {
          ids = await readdir(join(this.configDir, 'chats', hash));
        } catch {
          return;
        }
        await Promise.all(
          ids.map(async (id) => {
            if (!wanted.has(id)) return;
            try {
              const cwd = cwdFromMeta(
                JSON.parse(
                  await readFile(
                    join(this.configDir, 'chats', hash, id, 'meta.json'),
                    'utf8',
                  ),
                ),
              );
              if (cwd) found.set(id, cwd);
            } catch {
              // A chat without meta.json still shows if its transcript is live.
            }
          }),
        );
      }),
    );
    return found;
  }

  /**
   * IDE session index. Cursor 3+ keeps it in the global `state.vscdb`
   * (`composerHeaders`, or `ItemTable` key `composer.composerHeaders`).
   * Older builds keep `allComposers` in each workspace database.
   * Titles and bubble text are never selected.
   */
  private async composers(since: number): Promise<ComposerRow[]> {
    const globalDb = join(this.userDir, 'globalStorage', 'state.vscdb');
    if (
      await stat(globalDb).then(
        (info) => info.isFile(),
        () => false,
      )
    ) {
      const { DatabaseSync } = await import('node:sqlite');
      const db = new DatabaseSync(globalDb, { readOnly: true, timeout: 200 });
      try {
        const tables = new Set(
          (
            db
              .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
              .all() as { name: string }[]
          ).map((table) => table.name),
        );
        const rows = new Map<string, ComposerRow>();
        let indexed = false;
        if (tables.has('composerHeaders')) {
          indexed = true;
          for (const row of readHeaderTable(db, since)) rows.set(row.id, row);
        }
        if (tables.has('ItemTable')) {
          try {
            const fromItem = readHeaderItem(db, since);
            if (fromItem) {
              indexed = true;
              for (const row of fromItem) {
                const seen = rows.get(row.id);
                rows.set(
                  row.id,
                  seen
                    ? {
                        ...seen,
                        cwd: row.cwd ?? seen.cwd,
                        updatedAt: Math.max(seen.updatedAt, row.updatedAt),
                      }
                    : row,
                );
              }
            }
          } catch {
            // The index key can be present with a shape this version doesn't use.
          }
        }
        if (tables.has('cursorDiskKV')) applyStatuses(db, rows);
        if (indexed) return finishComposers(rows);
      } finally {
        db.close();
      }
    }
    return this.workspaceComposers(since);
  }

  private async workspaceComposers(since: number): Promise<ComposerRow[]> {
    const storage = join(this.userDir, 'workspaceStorage');
    let ids: string[];
    try {
      ids = await readdir(storage);
    } catch {
      return [];
    }
    const rows = new Map<string, ComposerRow>();
    const { DatabaseSync } = await import('node:sqlite');
    for (const id of ids) {
      let folder: string | undefined;
      try {
        const workspace = JSON.parse(
          await readFile(join(storage, id, 'workspace.json'), 'utf8'),
        ) as { folder?: unknown };
        folder =
          typeof workspace.folder === 'string'
            ? pathFromFileUri(workspace.folder)
            : undefined;
      } catch {
        continue;
      }
      const dbPath = join(storage, id, 'state.vscdb');
      let db: DatabaseSync | undefined;
      try {
        db = new DatabaseSync(dbPath, { readOnly: true, timeout: 200 });
        const listed = readHeaderItem(db, since, 'composer.composerData');
        for (const row of listed ?? [])
          rows.set(row.id, { ...row, cwd: row.cwd ?? folder });
      } catch {
        // Locked or not a composer database.
      } finally {
        db?.close();
      }
    }
    return finishComposers(rows);
  }
}

interface HeaderRecord {
  id: unknown;
  updatedAt: unknown;
  archived: unknown;
  subagent: unknown;
  subcomposer: unknown;
  draft: unknown;
  fsPath: unknown;
  external: unknown;
}

function keepHeader(row: HeaderRecord, since: number): ComposerRow | undefined {
  const id = typeof row.id === 'string' ? row.id : '';
  const updatedAt = asTime(row.updatedAt);
  if (!id || updatedAt === undefined || updatedAt <= since) return undefined;
  if ([row.archived, row.subagent, row.subcomposer].some(flagged))
    return undefined;
  const cwd = workspacePath(row.fsPath, row.external, undefined);
  return {
    id,
    updatedAt,
    ...(cwd && { cwd }),
    ...(flagged(row.draft) && { draft: true }),
  };
}

function readHeaderTable(db: DatabaseSync, since: number): ComposerRow[] {
  const columns = columnsOf(db, 'composerHeaders');
  if (!columns.has('composerId') || !columns.has('lastUpdatedAt')) return [];
  const valueFields = columns.has('value')
    ? `json_extract(value, '$.workspaceIdentifier.uri.fsPath') AS fsPath,
       json_extract(value, '$.workspaceIdentifier.uri.external') AS external,
       json_extract(value, '$.isBestOfNSubcomposer') AS subcomposer,
       json_extract(value, '$.isDraft') AS draft`
    : `NULL AS fsPath, NULL AS external, 0 AS subcomposer, 0 AS draft`;
  const rows = db
    .prepare(
      `SELECT composerId AS id, lastUpdatedAt AS updatedAt,
              ${columns.has('isArchived') ? 'isArchived' : '0'} AS archived,
              ${columns.has('isSubagent') ? 'isSubagent' : '0'} AS subagent,
              ${valueFields}
       FROM composerHeaders
       WHERE lastUpdatedAt > ?
       ORDER BY lastUpdatedAt DESC
       LIMIT 80`,
    )
    .all(since) as unknown as HeaderRecord[];
  return rows.flatMap((row) => {
    const kept = keepHeader(row, since);
    return kept ? [kept] : [];
  });
}

/** `null` when the index key is absent, so the caller can try the legacy layout. */
function readHeaderItem(
  db: DatabaseSync,
  since: number,
  key = 'composer.composerHeaders',
): ComposerRow[] | null {
  const found = db
    .prepare(`SELECT 1 FROM ItemTable WHERE key = ? LIMIT 1`)
    .get(key);
  if (!found) return null;
  const rows = db
    .prepare(
      `SELECT json_extract(composer.value, '$.composerId') AS id,
              json_extract(composer.value, '$.lastUpdatedAt') AS updatedAt,
              json_extract(composer.value, '$.isArchived') AS archived,
              json_extract(composer.value, '$.isSubagent') AS subagent,
              json_extract(composer.value, '$.isBestOfNSubcomposer') AS subcomposer,
              json_extract(composer.value, '$.isDraft') AS draft,
              json_extract(composer.value, '$.workspaceIdentifier.uri.fsPath') AS fsPath,
              json_extract(composer.value, '$.workspaceIdentifier.uri.external') AS external
       FROM ItemTable, json_each(json_extract(ItemTable.value, '$.allComposers')) AS composer
       WHERE ItemTable.key = ?`,
    )
    .all(key) as unknown as HeaderRecord[];
  return rows.flatMap((row) => {
    const kept = keepHeader(row, since);
    return kept ? [kept] : [];
  });
}

function finishComposers(rows: Map<string, ComposerRow>): ComposerRow[] {
  for (const [id, row] of rows) {
    if (row.draft && row.status !== 'generating') rows.delete(id);
    delete row.draft;
  }
  return [...rows.values()];
}

function applyStatuses(db: DatabaseSync, rows: Map<string, ComposerRow>) {
  const ids = [...rows.keys()];
  if (ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(', ');
  const statuses = db
    .prepare(
      `SELECT substr(key, 14) AS id, json_extract(value, '$.status') AS status
       FROM cursorDiskKV WHERE key IN (${placeholders})`,
    )
    .all(...ids.map((id) => `composerData:${id}`)) as {
    id: string;
    status: unknown;
  }[];
  for (const status of statuses) {
    const row = rows.get(status.id);
    if (row && typeof status.status === 'string') row.status = status.status;
  }
}
