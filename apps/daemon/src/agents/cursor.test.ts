import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CursorAdapter,
  activityForCursorTool,
  cursorActivity,
  cwdFromMeta,
  parseCursorTranscriptTail,
  pathFromFileUri,
  type CursorSignals,
} from './cursor';

const now = Date.UTC(2026, 9, 18, 12);
const signals = (patch: Partial<CursorSignals> = {}): CursorSignals => ({
  updatedAt: now - 5_000,
  ...patch,
});

describe('Cursor activity mapping', () => {
  it('maps a generating composer by the trailing tool', () => {
    expect(activityForCursorTool('StrReplace')).toBe('editing');
    expect(activityForCursorTool('Shell')).toBe('running-tool');
    expect(activityForCursorTool('Read')).toBe('reading');
    expect(activityForCursorTool('Task')).toBe('delegating');
    expect(
      cursorActivity(
        signals({
          composerStatus: 'generating',
          pendingTool: { name: 'StrReplace', path: 'src/a.ts' },
        }),
        now,
      ),
    ).toMatchObject({
      activity: 'editing',
      confidence: 'high',
      detail: 'StrReplace src/a.ts',
    });
    expect(
      cursorActivity(signals({ composerStatus: 'generating' }), now).activity,
    ).toBe('working');
  });

  it('maps aborted, failed and finished turns', () => {
    expect(
      cursorActivity(signals({ composerStatus: 'aborted' }), now).activity,
    ).toBe('idle');
    expect(cursorActivity(signals({ turnStatus: 'error' }), now).activity).toBe(
      'failed',
    );
    expect(
      cursorActivity(signals({ turnStatus: 'success' }), now).activity,
    ).toBe('waiting-input');
    expect(
      cursorActivity(
        signals({ turnStatus: 'success', updatedAt: now - 20 * 60_000 }),
        now,
      ),
    ).toMatchObject({ activity: 'idle', confidence: 'low' });
  });

  it('reads tool names and paths, never message text', () => {
    const tail = parseCursorTranscriptTail(
      [
        JSON.stringify({
          role: 'user',
          message: { content: [{ type: 'text', text: 'secret prompt' }] },
        }),
        JSON.stringify({
          role: 'assistant',
          message: {
            content: [
              { type: 'text', text: 'secret answer' },
              {
                type: 'tool_use',
                name: 'Shell',
                input: { command: 'secret command', path: 'not-a-shell-path' },
              },
              {
                type: 'tool_use',
                name: 'StrReplace',
                input: {
                  path: 'src/a.ts',
                  old_string: 'secret before',
                  new_string: 'secret after',
                },
              },
            ],
          },
        }),
        '{not json',
      ].join('\n'),
    );
    expect(tail.pendingTool).toEqual({ name: 'StrReplace', path: 'src/a.ts' });
    expect(JSON.stringify(tail)).not.toContain('secret');
    expect(
      parseCursorTranscriptTail(
        `${JSON.stringify({
          role: 'assistant',
          message: {
            content: [{ type: 'tool_use', name: 'Read', input: { path: 'a' } }],
          },
        })}\n${JSON.stringify({ type: 'turn_ended', status: 'success', error: 'secret error' })}`,
      ),
    ).toEqual({ turnStatus: 'success' });
  });

  it('decodes chat cwd and file URIs', () => {
    expect(cwdFromMeta({ cwd: 'C:\\work\\demo', name: 'secret' })).toBe(
      'C:\\work\\demo',
    );
    expect(cwdFromMeta({ title: 'secret' })).toBeUndefined();
    expect(pathFromFileUri('file:///C:/work/demo')).toBe(
      '/C:/work/demo'.slice(1),
    );
    expect(pathFromFileUri('file:///d%3A/git/Nabi-Station')).toBe(
      'd:/git/Nabi-Station',
    );
    expect(pathFromFileUri('https://example.com')).toBeUndefined();
  });
});

describe('CursorAdapter', () => {
  let configDir: string;
  let userDir: string;
  afterEach(() =>
    Promise.all([
      rm(configDir, { recursive: true, force: true }),
      rm(userDir, { recursive: true, force: true }),
    ]),
  );

  const stamp = async (file: string, when = now - 5_000) => {
    const seconds = when / 1000;
    await utimes(file, seconds, seconds);
  };

  it('reads a live transcript and composer status, and skips secrets, subagents and closed chats', async () => {
    configDir = await mkdtemp(join(tmpdir(), 'nabi-cursor-'));
    userDir = await mkdtemp(join(tmpdir(), 'nabi-cursor-user-'));
    const transcript = join(
      configDir,
      'projects',
      'd-git-demo',
      'agent-transcripts',
      'live',
      'live.jsonl',
    );
    const subagent = join(
      configDir,
      'projects',
      'd-git-demo',
      'agent-transcripts',
      'live',
      'subagents',
      'child.jsonl',
    );
    const stale = join(
      configDir,
      'projects',
      'd-git-demo',
      'agent-transcripts',
      'old.jsonl',
    );
    await mkdir(join(transcript, '..'), { recursive: true });
    await mkdir(join(subagent, '..'), { recursive: true });
    await writeFile(
      transcript,
      [
        JSON.stringify({
          role: 'assistant',
          message: {
            content: [
              { type: 'text', text: 'secret answer' },
              {
                type: 'tool_use',
                name: 'StrReplace',
                input: { path: 'src/a.ts', old_string: 'secret before' },
              },
            ],
          },
        }),
      ].join('\n'),
    );
    await writeFile(
      subagent,
      JSON.stringify({ type: 'turn_ended', status: 'error' }),
    );
    await writeFile(
      stale,
      JSON.stringify({ type: 'turn_ended', status: 'error' }),
    );
    await stamp(transcript);
    await stamp(subagent);
    await stamp(stale, now - 3 * 60 * 60_000);
    const metaDir = join(configDir, 'chats', 'hash', 'live');
    await mkdir(metaDir, { recursive: true });
    await writeFile(
      join(metaDir, 'meta.json'),
      JSON.stringify({ cwd: 'C:\\work\\demo', name: 'secret title' }),
    );
    await writeFile(
      join(metaDir, 'store.db'),
      'secret blob that must not be required',
    );

    const dbDir = join(userDir, 'globalStorage');
    await mkdir(dbDir, { recursive: true });
    const db = new DatabaseSync(join(dbDir, 'state.vscdb'));
    db.exec(`CREATE TABLE composerHeaders (
      composerId TEXT, lastUpdatedAt INTEGER, isArchived INTEGER, isSubagent INTEGER, value TEXT
    );
    CREATE TABLE cursorDiskKV (key TEXT, value TEXT);
    CREATE TABLE ItemTable (key TEXT, value TEXT);`);
    db.prepare('INSERT INTO composerHeaders VALUES (?, ?, ?, ?, ?)').run(
      'live',
      now - 5_000,
      0,
      0,
      JSON.stringify({
        name: 'secret title',
        workspaceIdentifier: {
          uri: { fsPath: 'C:\\somewhere\\else' },
        },
      }),
    );
    db.prepare('INSERT INTO composerHeaders VALUES (?, ?, ?, ?, ?)').run(
      'archived',
      now - 5_000,
      1,
      0,
      '{}',
    );
    db.prepare('INSERT INTO composerHeaders VALUES (?, ?, ?, ?, ?)').run(
      'child',
      now - 5_000,
      0,
      1,
      '{}',
    );
    db.prepare('INSERT INTO cursorDiskKV VALUES (?, ?)').run(
      'composerData:live',
      JSON.stringify({
        status: 'generating',
        conversation: [{ text: 'secret bubble' }],
      }),
    );
    db.prepare('INSERT INTO cursorDiskKV VALUES (?, ?)').run(
      'bubbleId:live:1',
      JSON.stringify({ text: 'secret bubble row' }),
    );
    db.prepare('INSERT INTO ItemTable VALUES (?, ?)').run(
      'composer.composerHeaders',
      JSON.stringify({
        allComposers: [
          {
            composerId: 'from-item',
            name: 'secret item title',
            lastUpdatedAt: now - 4_000,
            workspaceIdentifier: {
              uri: { external: 'file:///d%3A/git/Other' },
            },
          },
        ],
      }),
    );
    db.close();

    const agents = await new CursorAdapter(configDir, userDir).discover(now);
    expect(agents.map((agent) => agent.id).sort()).toEqual([
      'cursor:from-item',
      'cursor:live',
    ]);
    expect(agents.find((agent) => agent.id === 'cursor:live')).toMatchObject({
      name: 'Cursor · demo live',
      activity: 'editing',
      confidence: 'high',
      detail: 'StrReplace src/a.ts',
      cwd: 'C:/work/demo',
      source: 'Cursor composer state and agent transcript',
    });
    expect(
      agents.find((agent) => agent.id === 'cursor:from-item'),
    ).toMatchObject({
      cwd: 'D:/git/Other',
      activity: 'waiting-input',
      source: 'Cursor composer state',
    });
    expect(JSON.stringify(agents)).not.toContain('secret');
  });

  it('returns nothing when Cursor is not installed', async () => {
    configDir = await mkdtemp(join(tmpdir(), 'nabi-cursor-empty-'));
    userDir = await mkdtemp(join(tmpdir(), 'nabi-cursor-user-empty-'));
    expect(await new CursorAdapter(configDir, userDir).discover(now)).toEqual(
      [],
    );
  });
});
