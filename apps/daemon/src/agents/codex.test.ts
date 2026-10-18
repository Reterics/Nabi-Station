import { mkdtemp, rm } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CodexAdapter,
  codexActivity,
  codexHelpers,
  latestVersioned,
  type CodexThread,
} from './codex';

const now = Date.UTC(2026, 9, 18, 12);
const thread: CodexThread = {
  id: 't',
  cwd: 'C:/w',
  source: 'cli',
  updatedAtMs: now - 1000,
};

describe('Codex activity mapping', () => {
  it('maps in-progress turns by their latest item', () => {
    const map = (item?: string) =>
      codexActivity(thread, { status: 'inProgress' }, item, now).activity;
    expect(map('fileChange')).toBe('editing');
    expect(map('commandExecution')).toBe('running-tool');
    expect(map('webSearch')).toBe('reading');
    expect(map('reasoning')).toBe('working');
    expect(map(undefined)).toBe('working');
  });
  it('maps finished turns', () => {
    expect(
      codexActivity(thread, { status: 'failed' }, undefined, now).activity,
    ).toBe('failed');
    expect(
      codexActivity(thread, { status: 'completed' }, undefined, now).activity,
    ).toBe('waiting-input');
    expect(
      codexActivity(
        { ...thread, updatedAtMs: now - 20 * 60_000 },
        { status: 'completed' },
        undefined,
        now,
      ),
    ).toMatchObject({ activity: 'idle', confidence: 'low' });
  });
  it('picks the highest schema version', () => {
    expect(
      latestVersioned(
        ['state_4.sqlite', 'state_12.sqlite', 'state_5.sqlite-wal', 'x'],
        'state',
      ),
    ).toBe('state_12.sqlite');
    expect(latestVersioned([], 'state')).toBeUndefined();
  });
});

describe('Codex helpers', () => {
  const call = (
    itemId: string,
    server: string,
    tool: string,
    status: string,
  ) => ({
    itemId,
    itemType: 'mcpToolCall',
    server,
    tool,
    status,
    createdAtMs: now,
  });
  it('marks the running call active and keeps the rest as recent', () => {
    const helpers = codexHelpers(
      [
        call('a', 'codex_apps', 'github.fetch', 'completed'),
        call('b', 'tiger', 'db_query', 'failed'),
        call('c', 'blender', 'execute_blender_code', 'inProgress'),
      ],
      true,
      'c',
    );
    expect(helpers.map((h) => [h.label, h.state])).toEqual([
      ['Blender', 'active'],
      ['GitHub', 'recent'],
      ['Tiger', 'failed'],
    ]);
    expect(
      codexHelpers([call('c', 'blender', 'x', 'inProgress')], false, 'c')[0]!
        .state,
    ).toBe('recent');
  });
});

describe('CodexAdapter', () => {
  let home: string;
  afterEach(() => rm(home, { recursive: true, force: true }));

  it('reads recent top-level threads from a synthetic database, read-only', async () => {
    home = await mkdtemp(join(tmpdir(), 'nabi-codex-'));
    const state = new DatabaseSync(join(home, 'state_5.sqlite'));
    state.exec(`CREATE TABLE threads (id TEXT, cwd TEXT, title TEXT, source TEXT, updated_at INTEGER,
      updated_at_ms INTEGER, archived INTEGER)`);
    const insert = state.prepare(
      'INSERT INTO threads VALUES (?, ?, ?, ?, 0, ?, ?)',
    );
    insert.run(
      'live',
      '\\\\?\\C:\\work\\demo',
      'Fix the build',
      'vscode',
      now - 5_000,
      0,
    );
    insert.run(
      'sub',
      'C:\\work\\demo',
      'Review',
      '{"subagent":{}}',
      now - 5_000,
      0,
    );
    insert.run('old', 'C:\\work\\demo', 'Old', 'cli', now - 3_600_000, 0);
    insert.run('archived', 'C:\\work\\demo', 'Gone', 'cli', now - 5_000, 1);
    state.close();
    const history = new DatabaseSync(join(home, 'thread_history_1.sqlite'));
    history.exec(`CREATE TABLE thread_turns (thread_id TEXT, turn_id TEXT, rollout_ordinal INTEGER, status TEXT);
      CREATE TABLE thread_items (thread_id TEXT, turn_id TEXT, item_id TEXT, rollout_ordinal INTEGER,
        created_at_ms INTEGER, item_json TEXT, item_type TEXT);
      INSERT INTO thread_turns VALUES ('live', 'turn-1', 1, 'completed'), ('live', 'turn-2', 2, 'inProgress');`);
    const item = history.prepare(
      'INSERT INTO thread_items VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    item.run(
      'live',
      'turn-1',
      'i1',
      1,
      now - 60_000,
      JSON.stringify({
        server: 'blender',
        tool: 'execute_blender_code',
        status: 'completed',
        arguments: { code: 'secret' },
      }),
      'mcpToolCall',
    );
    item.run('live', 'turn-2', 'i2', 3, now - 2_000, '{}', 'reasoning');
    item.run('live', 'turn-2', 'i3', 4, now - 1_000, '{}', 'fileChange');
    history.close();

    const agents = await new CodexAdapter(home).discover(now);
    expect(agents).toEqual([
      expect.objectContaining({
        id: 'codex:live',
        // Prompt-derived titles are never shown.
        name: 'Codex · demo live',
        activity: 'editing',
        confidence: 'high',
        cwd: 'C:/work/demo',
        helpers: [
          expect.objectContaining({
            id: 'mcp:blender',
            label: 'Blender',
            category: '3d',
            state: 'recent',
          }),
        ],
      }),
    ]);
    expect(JSON.stringify(agents)).not.toContain('secret');
  });
});
