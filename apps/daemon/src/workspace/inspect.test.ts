import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  inspectRepo,
  isReadable,
  sumGrepCounts,
  sumTreeSizes,
} from './inspect';

describe('readable files', () => {
  it('reads manifests and docs, never secrets or sources', () => {
    for (const path of [
      'package.json',
      'apps/web/package.json',
      'tsconfig.base.json',
      'Cargo.toml',
      '.github/workflows/ci.yml',
      'README.md',
      'docs/architecture.md',
    ])
      expect([path, isReadable(path)]).toEqual([path, true]);
    for (const path of [
      '.env',
      '.env.local',
      'config/secrets.json',
      'certs/server.key',
      'src/index.ts',
      'node_modules/x/package.json',
      'a/b/c/package.json',
    ])
      expect([path, isReadable(path)]).toEqual([path, false]);
  });
  it('parses git output', () => {
    expect(sumGrepCounts('a.ts:3\nsrc/b:c.ts:2\n')).toBe(5);
    expect(
      sumTreeSizes(
        '100644 blob 0123abcd     120\ta.ts\u0000100644 blob 4567ef01      30\tb.md\u0000',
      ),
    ).toBe(150);
  });
});

describe('inspectRepo', () => {
  let dir: string;
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('collects history, size, debt and allowlisted texts from a real repository', async () => {
    dir = await mkdtemp(join(tmpdir(), 'nabi-inspect-'));
    const gitIn = (...args: string[]) =>
      execFileSync('git', args, {
        cwd: dir,
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 'A',
          GIT_AUTHOR_EMAIL: 'a@example.com',
          GIT_COMMITTER_NAME: 'A',
          GIT_COMMITTER_EMAIL: 'a@example.com',
        },
      });
    gitIn('init', '-q');
    await mkdir(join(dir, 'src'));
    await writeFile(join(dir, 'README.md'), '# Demo\n');
    await writeFile(join(dir, 'package.json'), '{"scripts":{"test":"vitest"}}');
    await writeFile(join(dir, '.env'), 'API_KEY=secret');
    await writeFile(
      join(dir, 'src', 'a.ts'),
      '// TODO one\n// TODO two\n// FIXME three\nexport const secretSource = 1;\n',
    );
    gitIn('add', '-A');
    gitIn('commit', '-q', '-m', 'first');
    gitIn('tag', 'v1');

    const facts = await inspectRepo(dir);
    expect(facts.files.sort()).toEqual(
      ['.env', 'README.md', 'package.json', 'src/a.ts'].sort(),
    );
    expect(Object.keys(facts.texts).sort()).toEqual([
      'README.md',
      'package.json',
    ]);
    expect(JSON.stringify(facts.texts)).not.toContain('secret');
    expect(facts.commits).toMatchObject({ total: 1, authors90Days: 1 });
    expect(facts.commits.recent).toHaveLength(1);
    expect(facts.tags).toBe(1);
    expect(facts.todos).toEqual({ todo: 2, fixme: 1 });
    expect(facts.trackedBytes).toBeGreaterThan(50);
  });
});
