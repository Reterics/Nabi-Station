import { readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { displayPath } from '../paths';

/** Directories that never contain repositories worth showing, or are too large to walk. */
const IGNORED = new Set([
  'node_modules',
  'vendor',
  'target',
  'dist',
  'build',
  'out',
  '.venv',
  'venv',
  '__pycache__',
  '.next',
  '.turbo',
  '.cache',
  '$RECYCLE.BIN',
  'System Volume Information',
]);

export interface DiscoveredRepo {
  root: string;
  path: string;
  name: string;
}

/**
 * Breadth-first walk of each root down to `maxDepth`. A directory containing `.git`
 * (a directory, or a file for worktrees and submodules) is a repository; the walk
 * does not descend into it.
 */
export async function discoverRepos(
  roots: string[],
  maxDepth = 4,
): Promise<DiscoveredRepo[]> {
  const found: DiscoveredRepo[] = [];
  for (const rootInput of roots) {
    const root = displayPath(rootInput);
    let level = [root];
    for (let depth = 0; depth <= maxDepth && level.length > 0; depth++) {
      const next: string[] = [];
      for (const dir of level) {
        let entries;
        try {
          entries = await readdir(dir, { withFileTypes: true });
        } catch {
          continue;
        }
        if (entries.some((entry) => entry.name === '.git')) {
          found.push({ root, path: dir, name: basename(dir) || dir });
          continue;
        }
        for (const entry of entries)
          if (
            entry.isDirectory() &&
            !entry.name.startsWith('.') &&
            !IGNORED.has(entry.name)
          )
            next.push(displayPath(join(dir, entry.name)));
      }
      level = next;
    }
  }
  return found.sort((a, b) => a.path.localeCompare(b.path));
}

export async function isDirectory(path: string): Promise<boolean> {
  return stat(path).then(
    (s) => s.isDirectory(),
    () => false,
  );
}
