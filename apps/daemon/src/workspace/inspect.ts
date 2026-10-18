import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { git } from './git';

/** Raw, deterministic observations of one repository. `evaluate` turns them into checks. */
export interface RepoFacts {
  /** Tracked paths, repo-relative with forward slashes. */
  files: string[];
  trackedBytes: number;
  commits: {
    total: number;
    /** Commit times (ms) of the last 90 days, newest first. */
    recent: number[];
    /** Distinct authors of the last 90 days; only the count leaves this module. */
    authors90Days: number;
    lastCommitAt?: number;
    firstCommitAt?: number;
  };
  tags: number;
  todos: { todo: number; fixme: number };
  /**
   * Contents of allowlisted manifest, config and documentation files. Nothing else
   * is ever opened: no sources, no `.env`, no keys.
   */
  texts: Record<string, string>;
}

const MAX_FILES = 50_000;
const MAX_TEXT_BYTES = 128 * 1024;
const MAX_TEXTS = 60;

/**
 * Files whose contents the analysis may read. Depth is limited so a vendored tree
 * cannot flood it; `.env*`, keys and certificates can never match.
 */
export const READABLE: RegExp[] = [
  /^([^/]+\/){0,2}package\.json$/,
  /^([^/]+\/){0,2}tsconfig[^/]*\.json$/,
  /^([^/]+\/){0,1}(pyproject\.toml|setup\.cfg|requirements[^/]*\.txt|Pipfile)$/,
  /^([^/]+\/){0,2}Cargo\.toml$/,
  /^(go\.mod|composer\.json|Gemfile|Makefile|justfile|deno\.jsonc?)$/,
  /^\.github\/workflows\/[^/]+\.ya?ml$/,
  /^(\.gitlab-ci\.yml|azure-pipelines\.yml|\.circleci\/config\.yml)$/,
  /^readme(\.[a-z]+)?$/i,
  /^(architecture|contributing|changelog)(\.[a-z]+)?$/i,
  /^docs?\/(readme|index|architecture|overview)(\.[a-z]+)?$/i,
];
const NEVER =
  /(^|\/)(\.env[^/]*|[^/]*\.(pem|key|p12|pfx|crt)|id_rsa[^/]*|secrets?[^/]*)$/i;

export const isReadable = (path: string) =>
  !NEVER.test(path) &&
  !/(^|\/)(node_modules|vendor|third_party)\//.test(path) &&
  READABLE.some((pattern) => pattern.test(path));

async function readHead(path: string): Promise<string | undefined> {
  const handle = await open(path, 'r').catch(() => undefined);
  if (!handle) return undefined;
  try {
    const buffer = Buffer.alloc(MAX_TEXT_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, MAX_TEXT_BYTES, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}

const quiet = <T>(promise: Promise<T>, fallback: T) =>
  promise.catch(() => fallback);

/** `git grep -c` output (`path:count` lines) summed. */
export function sumGrepCounts(output: string): number {
  return output
    .split('\n')
    .map((line) => Number(line.slice(line.lastIndexOf(':') + 1)))
    .filter((count) => Number.isFinite(count))
    .reduce((sum, count) => sum + count, 0);
}

/** `git ls-tree -r -l -z HEAD` sizes summed (blobs only). */
export function sumTreeSizes(output: string): number {
  let total = 0;
  for (const record of output.split('\0')) {
    const match = /^\d+ blob [0-9a-f]+\s+(\d+)\t/.exec(record);
    if (match) total += Number(match[1]);
  }
  return total;
}

export async function inspectRepo(
  path: string,
  now = Date.now(),
): Promise<RepoFacts> {
  const since = Math.floor((now - 90 * 86_400_000) / 1000);
  const [files, tree, total, log, last, first, tags, todo, fixme] =
    await Promise.all([
      quiet(
        git(path, ['ls-files', '-z']).then((out) =>
          out.split('\0').filter(Boolean).slice(0, MAX_FILES),
        ),
        [] as string[],
      ),
      quiet(git(path, ['ls-tree', '-r', '-l', '-z', 'HEAD']), ''),
      quiet(git(path, ['rev-list', '--count', 'HEAD']), '0'),
      // Author emails are hashed into a count here and never stored or sent.
      quiet(
        git(path, ['log', `--since=${since}`, '--format=%ct%x09%ae', 'HEAD']),
        '',
      ),
      quiet(git(path, ['log', '-1', '--format=%ct', 'HEAD']), ''),
      quiet(
        git(path, ['rev-list', '--max-parents=0', '--format=%ct', 'HEAD']),
        '',
      ),
      quiet(git(path, ['tag', '--list']), ''),
      quiet(git(path, ['grep', '-I', '-c', '-w', 'TODO']), ''),
      quiet(git(path, ['grep', '-I', '-c', '-w', 'FIXME']), ''),
    ]);
  const recent: number[] = [];
  const authors = new Set<string>();
  for (const line of log.split('\n')) {
    const [time, author] = line.split('\t');
    if (!time) continue;
    recent.push(Number(time) * 1000);
    if (author) authors.add(author.toLowerCase());
  }
  const firstTimes = first
    .split('\n')
    .filter((line) => /^\d+$/.test(line))
    .map(Number);
  const texts: Record<string, string> = {};
  const readable = files.filter(isReadable).slice(0, MAX_TEXTS);
  await Promise.all(
    readable.map(async (file) => {
      const text = await readHead(join(path, file));
      if (text !== undefined) texts[file] = text;
    }),
  );
  return {
    files,
    trackedBytes: sumTreeSizes(tree),
    commits: {
      total: Number(total.trim()) || 0,
      recent,
      authors90Days: authors.size,
      lastCommitAt: Number(last.trim()) * 1000 || undefined,
      firstCommitAt: firstTimes.length
        ? Math.min(...firstTimes) * 1000
        : undefined,
    },
    tags: tags.split('\n').filter(Boolean).length,
    todos: { todo: sumGrepCounts(todo), fixme: sumGrepCounts(fixme) },
    texts,
  };
}
