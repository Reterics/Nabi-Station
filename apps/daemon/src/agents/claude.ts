import { open, readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentNpc } from '@nabi/protocol';
import { claudeHome, displayPath } from '../paths';
import { isSameProcess } from './process';
import {
  WAITING_INPUT_WINDOW_MS,
  type AgentAdapter,
  type AgentObservation,
} from './types';

/** Fields read from `~/.claude/sessions/<pid>.json` (undocumented; observed on 2.1.302). */
export interface ClaudeSession {
  pid: number;
  sessionId: string;
  cwd: string;
  status?: string;
  name?: string;
  procStart?: string;
  updatedAt?: number;
}

export function parseSessionFile(text: string): ClaudeSession | null {
  try {
    const data = JSON.parse(text) as Record<string, unknown>;
    if (
      typeof data.pid !== 'number' ||
      typeof data.sessionId !== 'string' ||
      typeof data.cwd !== 'string'
    )
      return null;
    return {
      pid: data.pid,
      sessionId: data.sessionId,
      cwd: data.cwd,
      status: typeof data.status === 'string' ? data.status : undefined,
      name: typeof data.name === 'string' ? data.name : undefined,
      procStart:
        typeof data.procStart === 'string' ? data.procStart : undefined,
      updatedAt:
        typeof data.updatedAt === 'number' ? data.updatedAt : undefined,
    };
  } catch {
    return null;
  }
}

export interface ToolUse {
  id: string;
  name: string;
  path?: string;
}
export interface TranscriptTail {
  /** Last tool call that has no result yet. */
  pendingTool?: ToolUse;
  lastTool?: ToolUse;
  lastTimestamp?: number;
}

/**
 * Reads only event types, tool names, file paths and timestamps. Message text is
 * never extracted. `text` may start mid-line; partial lines are skipped.
 */
export function parseTranscriptTail(text: string): TranscriptTail {
  const tools: ToolUse[] = [];
  const finished = new Set<string>();
  let lastTimestamp: number | undefined;
  for (const line of text.split('\n')) {
    let entry: {
      type?: string;
      timestamp?: string;
      message?: { content?: unknown };
    };
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type !== 'assistant' && entry.type !== 'user') continue;
    const time = entry.timestamp ? Date.parse(entry.timestamp) : NaN;
    if (!Number.isNaN(time)) lastTimestamp = time;
    const content = Array.isArray(entry.message?.content)
      ? entry.message.content
      : [];
    for (const block of content as Record<string, unknown>[]) {
      if (block.type === 'tool_use' && typeof block.id === 'string') {
        const input = (block.input ?? {}) as Record<string, unknown>;
        const path = [input.file_path, input.notebook_path, input.path].find(
          (value): value is string => typeof value === 'string',
        );
        tools.push({ id: block.id, name: String(block.name), path });
      }
      if (block.type === 'tool_result' && typeof block.tool_use_id === 'string')
        finished.add(block.tool_use_id);
    }
  }
  const lastTool = tools.at(-1);
  const pendingTool =
    lastTool && !finished.has(lastTool.id) ? lastTool : undefined;
  return { pendingTool, lastTool, lastTimestamp };
}

export function activityForTool(name: string): AgentNpc['activity'] {
  if (/^(Read|Grep|Glob|LS|WebFetch|WebSearch|NotebookRead)$/.test(name))
    return 'reading';
  if (/^(Edit|MultiEdit|Write|NotebookEdit)$/.test(name)) return 'editing';
  if (/^(Bash|BashOutput|PowerShell|KillShell)$/.test(name))
    return 'running-tool';
  return 'working';
}

const describeTool = (tool: ToolUse) =>
  tool.path ? `${tool.name} ${tool.path}` : tool.name;

/** Pure mapping from observations to an activity. Only `busy` is a known status (S1). */
export function claudeActivity(
  session: ClaudeSession,
  tail: TranscriptTail,
  now: number,
): Pick<AgentNpc, 'activity' | 'confidence' | 'detail'> {
  const { pendingTool } = tail;
  if (session.status === 'busy') {
    return pendingTool
      ? {
          activity: activityForTool(pendingTool.name),
          confidence: 'high',
          detail: describeTool(pendingTool),
        }
      : { activity: 'working', confidence: 'high', detail: 'Thinking' };
  }
  const status = `session status "${session.status ?? 'missing'}"`;
  if (pendingTool)
    return {
      activity: 'waiting-permission',
      confidence: 'low',
      detail: `${describeTool(pendingTool)} has no result; ${status}`,
    };
  const last = tail.lastTimestamp ?? session.updatedAt ?? 0;
  return now - last < WAITING_INPUT_WINDOW_MS
    ? {
        activity: 'waiting-input',
        confidence: 'medium',
        detail: `Turn finished; ${status}`,
      }
    : { activity: 'idle', confidence: 'medium', detail: status };
}

const TAIL_BYTES = 256 * 1024;

async function readTail(path: string): Promise<string> {
  const handle = await open(path, 'r');
  try {
    const { size } = await handle.stat();
    const length = Math.min(size, TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, size - length);
    return buffer.toString('utf8');
  } finally {
    await handle.close();
  }
}

export class ClaudeCodeAdapter implements AgentAdapter {
  readonly kind = 'claude-code' as const;
  private transcripts = new Map<string, string>();

  constructor(private readonly home = claudeHome()) {}

  async discover(now: number): Promise<AgentObservation[]> {
    let files: string[];
    try {
      files = await readdir(join(this.home, 'sessions'));
    } catch {
      return [];
    }
    const observations = await Promise.all(
      // `<pid>.json` only: the neighbouring `<pid>.*.key` files hold secrets.
      files
        .filter((file) => /^\d+\.json$/.test(file))
        .map((file) => this.observe(file, now)),
    );
    return observations.filter((agent) => agent !== null);
  }

  private async observe(
    file: string,
    now: number,
  ): Promise<AgentObservation | null> {
    let session: ClaudeSession | null;
    try {
      session = parseSessionFile(
        await readFile(join(this.home, 'sessions', file), 'utf8'),
      );
    } catch {
      return null;
    }
    if (!session || !(await isSameProcess(session.pid, session.procStart)))
      return null;
    const transcript = await this.findTranscript(session.sessionId);
    const tail = transcript
      ? parseTranscriptTail(await readTail(transcript).catch(() => ''))
      : {};
    return {
      id: `claude-code:${session.sessionId}`,
      name: session.name ? `Claude Code · ${session.name}` : 'Claude Code',
      kind: this.kind,
      source: transcript
        ? 'Claude session file and transcript'
        : 'Claude session file',
      ...claudeActivity(session, tail, now),
      pid: session.pid,
      sessionId: session.sessionId,
      cwd: displayPath(session.cwd),
      updatedAt:
        Math.max(session.updatedAt ?? 0, tail.lastTimestamp ?? 0) || undefined,
    };
  }

  /** `projects/<encoded cwd>/<sessionId>.jsonl`; found by id, not by re-encoding the cwd. */
  private async findTranscript(sessionId: string): Promise<string | undefined> {
    const cached = this.transcripts.get(sessionId);
    if (cached) return cached;
    const projects = join(this.home, 'projects');
    let dirs: string[];
    try {
      dirs = await readdir(projects);
    } catch {
      return undefined;
    }
    for (const dir of dirs) {
      const candidate = join(projects, dir, `${sessionId}.jsonl`);
      if (
        await stat(candidate).then(
          (s) => s.isFile(),
          () => false,
        )
      ) {
        this.transcripts.set(sessionId, candidate);
        return candidate;
      }
    }
    return undefined;
  }
}
