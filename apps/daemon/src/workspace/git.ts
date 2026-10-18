import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Repo } from '@nabi/protocol';

const run = promisify(execFile);

export type GitState = Repo['git'];

export async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run('git', args, {
    cwd,
    windowsHide: true,
    timeout: 15_000,
    maxBuffer: 64 * 1024 * 1024,
    // Never prompt or take optional locks: this is a read-only observer.
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
  });
  return stdout;
}

/** Parses `git status --porcelain=v2 -z --branch`. */
export function parseStatus(output: string): GitState {
  const state: GitState = {
    branch: '',
    modified: 0,
    untracked: 0,
    ahead: 0,
    behind: 0,
  };
  const records = output.split('\0');
  for (let index = 0; index < records.length; index++) {
    const record = records[index]!;
    if (record.startsWith('# branch.head ')) {
      const head = record.slice('# branch.head '.length);
      state.branch = head === '(detached)' ? 'detached HEAD' : head;
    } else if (record.startsWith('# branch.ab ')) {
      const match = /\+(\d+) -(\d+)/.exec(record);
      state.ahead = Number(match?.[1] ?? 0);
      state.behind = Number(match?.[2] ?? 0);
    } else if (record.startsWith('1 ') || record.startsWith('u ')) {
      state.modified++;
    } else if (record.startsWith('2 ')) {
      state.modified++;
      index++; // A rename/copy record is followed by its original path.
    } else if (record.startsWith('? ')) {
      state.untracked++;
    }
  }
  return state;
}

export async function gitStatus(path: string): Promise<GitState> {
  return parseStatus(
    await git(path, [
      'status',
      '--porcelain=v2',
      '-z',
      '--branch',
      '--untracked-files=normal',
    ]),
  );
}

/** Runs `task` over `items` with at most `limit` in flight (git spawns are slow on Windows). */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]!);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}
