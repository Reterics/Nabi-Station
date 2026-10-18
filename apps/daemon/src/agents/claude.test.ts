import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ClaudeCodeAdapter,
  claudeActivity,
  claudeHelpers,
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
    expect(tail.pendingTool).toMatchObject({
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
    expect(activity('Task')).toBe('delegating');
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

describe('Claude helpers', () => {
  const at = (id: string, name: string, minutesAgo: number, input = {}) =>
    line({
      type: 'assistant',
      timestamp: new Date(now - minutesAgo * 60_000).toISOString(),
      message: { content: [{ type: 'tool_use', id, name, input }] },
    });
  const failed = (id: string) =>
    line({
      type: 'user',
      message: {
        content: [{ type: 'tool_result', tool_use_id: id, is_error: true }],
      },
    });
  const prompt = line({ type: 'user', message: { content: 'secret prompt' } });

  it('turns MCP servers, web access and subagents into helpers', () => {
    const tail = parseTranscriptTail(
      [
        at('old', 'mcp__claude_ai_Higgsfield__generate_image', 40),
        toolResult('old'),
        at('h', 'mcp__claude_ai_Higgsfield__generate_image', 5),
        toolResult('h'),
        at('t', 'mcp__tiger__db_query', 4),
        failed('t'),
        prompt,
        at('r', 'Read', 3, { file_path: 'C:/a.ts' }),
        toolResult('r'),
        at('b', 'mcp__blender__execute_blender_code', 1, { code: 'secret' }),
        at('e', 'Agent', 1, { subagent_type: 'Explore', prompt: 'secret' }),
      ].join('\n'),
    );
    const helpers = claudeHelpers(tail, true, now);
    expect(helpers.map((h) => [h.label, h.category, h.state])).toEqual([
      ['Blender', '3d', 'active'],
      ['Explore subagent', 'subagent', 'active'],
      ['Tiger', 'database', 'failed'],
      ['Higgsfield', 'media', 'recent'],
    ]);
    expect(helpers[3]).toMatchObject({ calls: 1, tool: 'generate_image' });
    expect(JSON.stringify(helpers)).not.toContain('secret');
    expect(claudeActivity(session, tail, now)).toMatchObject({
      activity: 'delegating',
      detail: 'Waiting on Blender, Explore subagent',
    });
  });

  it('shows a call awaiting permission as waiting, and own work as the activity', () => {
    const tail = parseTranscriptTail(at('b', 'mcp__blender__x', 1));
    expect(claudeHelpers(tail, false, now)[0]!.state).toBe('waiting');
    const mixed = parseTranscriptTail(
      [at('b', 'mcp__blender__x', 1), at('s', 'Bash', 1)].join('\n'),
    );
    expect(claudeActivity(session, mixed, now).activity).toBe('running-tool');
  });

  it('forgets unanswered calls from before the latest prompt', () => {
    const tail = parseTranscriptTail(
      [at('b', 'mcp__blender__x', 2), prompt].join('\n'),
    );
    expect(claudeHelpers(tail, true, now)[0]!.state).toBe('recent');
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
