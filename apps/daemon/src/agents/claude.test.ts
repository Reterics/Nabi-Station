import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ClaudeCodeAdapter,
  claudeActivity,
  parseSessionFile,
  parseTranscriptTail,
  type ClaudeSession,
} from './claude';

const now = Date.UTC(2026, 9, 18, 12);
const session: ClaudeSession = {
  pid: 1234,
  sessionId: 's-1',
  cwd: 'C:\\work\\demo',
  status: 'busy',
};
const line = (value: unknown) => JSON.stringify(value);
const toolUse = (id: string, name: string, input: object = {}) =>
  line({
    type: 'assistant',
    timestamp: new Date(now - 1000).toISOString(),
    message: { content: [{ type: 'tool_use', id, name, input }] },
  });
const toolResult = (id: string) =>
  line({
    type: 'user',
    message: {
      content: [
        { type: 'tool_result', tool_use_id: id, content: 'secret output' },
      ],
    },
  });

describe('Claude session files', () => {
  it('parses required fields and rejects malformed files', () => {
    expect(
      parseSessionFile(line({ ...session, status: 'busy', extra: true })),
    ).toMatchObject(session);
    expect(
      parseSessionFile(line({ pid: '1', sessionId: 's', cwd: 'x' })),
    ).toBeNull();
    expect(parseSessionFile('{not json')).toBeNull();
  });
});

describe('Claude transcript tail', () => {
  it('finds the pending tool and ignores partial lines and message text', () => {
    const text = [
      '{"truncated":',
      toolUse('a', 'Read', { file_path: 'C:/x.ts' }),
      toolResult('a'),
      toolUse('b', 'Edit', { file_path: 'C:/y.ts' }),
    ].join('\n');
    const tail = parseTranscriptTail(text);
    expect(tail.pendingTool).toEqual({
      id: 'b',
      name: 'Edit',
      path: 'C:/y.ts',
    });
    expect(JSON.stringify(tail)).not.toContain('secret');
  });
  it('has no pending tool once every tool has a result', () => {
    expect(
      parseTranscriptTail([toolUse('a', 'Bash'), toolResult('a')].join('\n'))
        .pendingTool,
    ).toBeUndefined();
  });
});

describe('Claude activity mapping', () => {
  it('maps a busy session by its pending tool', () => {
    const activity = (name: string) =>
      claudeActivity(session, { pendingTool: { id: 'x', name } }, now).activity;
    expect(activity('Grep')).toBe('reading');
    expect(activity('Write')).toBe('editing');
    expect(activity('PowerShell')).toBe('running-tool');
    expect(activity('Task')).toBe('working');
    expect(claudeActivity(session, {}, now)).toMatchObject({
      activity: 'working',
      confidence: 'high',
    });
  });
  it('labels inferences from unknown statuses with lower confidence', () => {
    const idle = { ...session, status: 'idle-ish' };
    expect(
      claudeActivity(idle, { pendingTool: { id: 'x', name: 'Bash' } }, now),
    ).toMatchObject({
      activity: 'waiting-permission',
      confidence: 'low',
    });
    expect(
      claudeActivity(idle, { lastTimestamp: now - 60_000 }, now),
    ).toMatchObject({
      activity: 'waiting-input',
      confidence: 'medium',
    });
    expect(
      claudeActivity(idle, { lastTimestamp: now - 3_600_000 }, now).activity,
    ).toBe('idle');
  });
});

describe('ClaudeCodeAdapter', () => {
  let home: string;
  afterEach(() => rm(home, { recursive: true, force: true }));

  it('reads live sessions and their transcripts, skipping dead pids and key files', async () => {
    home = await mkdtemp(join(tmpdir(), 'nabi-claude-'));
    await mkdir(join(home, 'sessions'));
    await mkdir(join(home, 'projects', 'C--work-demo'), { recursive: true });
    const live = {
      pid: process.pid,
      sessionId: 'live',
      cwd: 'C:\\work\\demo',
      status: 'busy',
      name: 'demo-1',
    };
    await writeFile(join(home, 'sessions', `${process.pid}.json`), line(live));
    await writeFile(
      join(home, 'sessions', '999999.json'),
      line({ ...live, pid: 999_999, sessionId: 'dead' }),
    );
    await writeFile(
      join(home, 'sessions', `${process.pid}.abc.key`),
      'must never be read',
    );
    await writeFile(
      join(home, 'projects', 'C--work-demo', 'live.jsonl'),
      toolUse('t', 'Read', { file_path: 'C:/work/demo/a.ts' }),
    );

    const agents = await new ClaudeCodeAdapter(home).discover(now);
    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({
      id: 'claude-code:live',
      name: 'Claude Code · demo-1',
      activity: 'reading',
      cwd: 'C:/work/demo',
      pid: process.pid,
      detail: 'Read C:/work/demo/a.ts',
    });
  });

  it('returns nothing when Claude Code is not installed', async () => {
    home = join(tmpdir(), 'nabi-missing-claude');
    expect(await new ClaudeCodeAdapter(home).discover(now)).toEqual([]);
  });
});
