import { open, readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  mcpHelper,
  parseMcpToolName,
  type AgentNpc,
  type Helper,
} from '@nabi/protocol';
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
  /** `subagent_type` of an Agent/Task call: a type name such as "Explore", not a prompt. */
  subagent?: string;
  at?: number;
}
export interface TranscriptTail {
  /** Last tool call that has no result yet. */
  pendingTool?: ToolUse;
  lastTool?: ToolUse;
  lastTimestamp?: number;
  /** Every tool call in the tail, oldest first. */
  tools?: ToolUse[];
  /** Calls without a result; parallel calls can have several. */
  pendingTools?: ToolUse[];
  /** Ids of calls whose result was flagged `is_error`. */
  failed?: Set<string>;
}

/**
 * Reads only event types, tool names, file paths and timestamps. Message text is
 * never extracted. `text` may start mid-line; partial lines are skipped.
 */
export function parseTranscriptTail(text: string): TranscriptTail {
  const tools: ToolUse[] = [];
  const finished = new Set<string>();
  const failed = new Set<string>();
  /** Index of the first tool call of the current turn. */
  let turnStart = 0;
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
    // A typed prompt (string content) starts a new turn; earlier calls can no longer run.
    if (entry.type === 'user' && typeof entry.message?.content === 'string')
      turnStart = tools.length;
    const content = Array.isArray(entry.message?.content)
      ? entry.message.content
      : [];
    for (const block of content as Record<string, unknown>[]) {
      if (block.type === 'tool_use' && typeof block.id === 'string') {
        const input = (block.input ?? {}) as Record<string, unknown>;
        const path = [input.file_path, input.notebook_path, input.path].find(
          (value): value is string => typeof value === 'string',
        );
        const subagent =
          typeof input.subagent_type === 'string'
            ? input.subagent_type.slice(0, 60)
            : undefined;
        tools.push({
          id: block.id,
          name: String(block.name),
          ...(path && { path }),
          ...(subagent && { subagent }),
          ...(!Number.isNaN(time) && { at: time }),
        });
      }
      if (
        block.type === 'tool_result' &&
        typeof block.tool_use_id === 'string'
      ) {
        finished.add(block.tool_use_id);
        if (block.is_error === true) failed.add(block.tool_use_id);
      }
    }
  }
  const lastTool = tools.at(-1);
  const pendingTool =
    lastTool && !finished.has(lastTool.id) ? lastTool : undefined;
  const pendingTools = tools
    .slice(turnStart)
    .filter((tool) => !finished.has(tool.id));
  return { pendingTool, lastTool, lastTimestamp, tools, pendingTools, failed };
}

/** Helpers count as "recent" this long after their last call. */
export const HELPER_RECENT_MS = 15 * 60_000;
const MAX_HELPERS = 8;

/** The helper a tool call hands work to; built-in file and shell tools have none. */
export function helperForTool(
  tool: ToolUse,
): Pick<Helper, 'id' | 'label' | 'category' | 'tool'> | null {
  const mcp = parseMcpToolName(tool.name);
  if (mcp) return mcpHelper(mcp.server, mcp.tool);
  if (/^(WebSearch|WebFetch)$/.test(tool.name))
    return { id: 'web', label: 'Web', category: 'web', tool: tool.name };
  if (/^(Agent|Task)$/.test(tool.name)) {
    const type = tool.subagent ?? 'general-purpose';
    return {
      id: `subagent:${type}`,
      label: `${type} subagent`,
      category: 'subagent',
    };
  }
  return null;
}

/**
 * Tools this session handed work to, newest first. While the session is busy every
 * unanswered call is running; when it is not, an unanswered last call is waiting
 * for permission.
 */
export function claudeHelpers(
  tail: TranscriptTail,
  busy: boolean,
  now: number,
): Helper[] {
  const pending = new Set(
    busy
      ? (tail.pendingTools ?? []).map((tool) => tool.id)
      : tail.pendingTool
        ? [tail.pendingTool.id]
        : [],
  );
  const helpers = new Map<string, Helper>();
  for (const tool of tail.tools ?? []) {
    const identity = helperForTool(tool);
    if (!identity) continue;
    const running = pending.has(tool.id);
    if (!running && (tool.at === undefined || now - tool.at > HELPER_RECENT_MS))
      continue;
    const previous = helpers.get(identity.id);
    const state: Helper['state'] = running
      ? busy
        ? 'active'
        : 'waiting'
      : tail.failed?.has(tool.id)
        ? 'failed'
        : 'recent';
    helpers.set(identity.id, {
      ...identity,
      // An earlier call still running outranks a later finished one.
      state:
        previous &&
        (previous.state === 'active' || previous.state === 'waiting') &&
        !running
          ? previous.state
          : state,
      calls: (previous?.calls ?? 0) + 1,
      ...((tool.at ?? previous?.lastUsedAt) !== undefined && {
        lastUsedAt: tool.at ?? previous?.lastUsedAt,
      }),
    });
  }
  const rank = (helper: Helper) =>
    helper.state === 'active' || helper.state === 'waiting' ? 0 : 1;
  return [...helpers.values()]
    .sort(
      (a, b) => rank(a) - rank(b) || (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0),
    )
    .slice(0, MAX_HELPERS);
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
    // Built-in work in flight is the session's own; otherwise it waits on its helpers.
    const running = tail.pendingTools ?? (pendingTool ? [pendingTool] : []);
    const own = running.filter((tool) => !helperForTool(tool)).at(-1);
    const delegated = running.filter((tool) => helperForTool(tool));
    if (!own && delegated.length > 0) {
      const names = [
        ...new Set(delegated.map((tool) => helperForTool(tool)!.label)),
      ];
      const tool = helperForTool(delegated.at(-1)!)!.tool;
      return {
        activity: 'delegating',
        confidence: 'high',
        detail:
          names.length === 1 && tool
            ? `Waiting on ${names[0]} · ${tool}`
            : `Waiting on ${names.join(', ')}`,
      };
    }
    const current = own ?? pendingTool;
    return current
      ? {
          activity: activityForTool(current.name),
          confidence: 'high',
          detail: describeTool(current),
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
      helpers: claudeHelpers(tail, session.status === 'busy', now),
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
