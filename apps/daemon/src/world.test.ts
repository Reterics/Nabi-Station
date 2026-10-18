import { describe, expect, it } from 'vitest';
import { worldSchema } from '@nabi/protocol';
import type { AgentObservation } from './agents';
import { displayPath, isWithin, pathKey } from './paths';
import { buildingFromSignals, signalsFromFiles } from './workspace/analyze';
import { parseStatus } from './workspace/git';
import { buildWorld, repoForPath, type RepoSnapshot } from './world';

describe('paths', () => {
  it('normalises the spellings agents use for one folder', () => {
    for (const spelling of [
      '\\\\?\\D:\\git\\x',
      'D:\\git\\x\\',
      'd:/git/x',
      '/d/git/x',
    ])
      expect(displayPath(spelling)).toBe('D:/git/x');
    expect(pathKey('D:/Git/X', 'win32')).toBe(pathKey('d:/git/x', 'win32'));
    expect(pathKey('d:\\GIT\\a\\src', 'linux')).toBe('d:/git/a/src');
    expect(pathKey('/tmp/Git', 'linux')).toBe('/tmp/Git');
    expect(isWithin('d:/git/xy', 'd:/git/x')).toBe(false);
    expect(isWithin('d:/git/x/src', 'd:/git/x')).toBe(true);
  });
});

describe('git status parsing', () => {
  it('counts changes, renames and branch divergence', () => {
    const output = [
      '# branch.oid abc',
      '# branch.head feat/x',
      '# branch.upstream origin/feat/x',
      '# branch.ab +2 -1',
      '1 .M N... 100644 100644 100644 a b src/a.ts',
      '2 R. N... 100644 100644 100644 a b R100 new.ts',
      'old.ts',
      'u UU N... 1 2 3 4 a b c conflict.ts',
      '? notes.txt',
      '? tmp/',
      '',
    ].join('\0');
    expect(parseStatus(output)).toEqual({
      branch: 'feat/x',
      modified: 3,
      untracked: 2,
      ahead: 2,
      behind: 1,
    });
    expect(parseStatus('# branch.head (detached)\0').branch).toBe(
      'detached HEAD',
    );
  });
});

describe('repository scoring', () => {
  const files = [
    'README.md',
    'src/index.ts',
    'src/app.tsx',
    'src/app.test.ts',
    'docs/guide.md',
    '.github/workflows/ci.yml',
    'eslint.config.js',
    '.prettierrc.json',
    'Dockerfile',
  ];
  it('derives language and capabilities from tracked files', () => {
    expect(signalsFromFiles(files, 10)).toMatchObject({
      language: 'TypeScript',
      readme: true,
      docs: true,
      tests: true,
      lint: true,
      format: true,
      ci: true,
      container: true,
      deploy: false,
    });
    expect(signalsFromFiles(['README.md', 'guide.md'], 3).language).toBe(
      'Markdown',
    );
    expect(signalsFromFiles(['vendor/lib.go', 'a.py'], 3).language).toBe(
      'Python',
    );
  });
  it('maps signals to a deterministic building, empty plot first', () => {
    const signals = signalsFromFiles(files, 10);
    expect(buildingFromSignals(signals, 7)).toEqual({
      archetype: 'office',
      tier: 4,
      seed: 7,
      modules: ['tests', 'ci', 'docs', 'container'],
      footprint: 1,
    });
    expect(buildingFromSignals({ ...signals, commitCount: 0 }, 7).tier).toBe(0);
    expect(
      buildingFromSignals(signalsFromFiles(['main.rs'], 5), 1),
    ).toMatchObject({ archetype: 'factory', tier: 1 });
  });
});

describe('world assembly', () => {
  const repo = (path: string): RepoSnapshot => ({
    repo: { root: 'D:/git', path, name: path.split('/').pop()! },
    signals: signalsFromFiles(['README.md', 'a.ts'], 4),
    git: { branch: 'main', modified: 0, untracked: 0, ahead: 0, behind: 0 },
  });
  const agent = (cwd: string): AgentObservation => ({
    id: `claude-code:${cwd}`,
    name: 'Claude Code',
    kind: 'claude-code',
    activity: 'working',
    source: 'test',
    confidence: 'high',
    cwd,
  });

  it('places agents in the innermost repository, or nowhere', () => {
    expect(
      repoForPath('D:/git/a/packages/b', ['D:/git/a', 'D:/git/a/packages/b']),
    ).toBe('D:/git/a/packages/b');
    expect(repoForPath('d:\\GIT\\a\\src', ['D:/git/a'])).toBe('D:/git/a');
    expect(repoForPath('D:/git', ['D:/git/a'])).toBeNull();
  });

  it('builds a valid live world with stable ids and unplaced agents', () => {
    const input = {
      roots: ['D:/git', 'E:/work'],
      repos: [repo('D:/git/app'), repo('E:/work/app'), repo('D:/git/docs')],
      agents: [agent('D:/git/app/src'), agent('C:/Users/me')],
      version: 3,
      now: 1,
    };
    const world = buildWorld(input);
    expect(worldSchema.safeParse(world).success).toBe(true);
    expect(world.mode).toBe('live');
    expect(world.districts.map((district) => district.plots.length)).toEqual([
      2, 1,
    ]);
    const ids = world.repos.map((repo) => repo.id);
    expect(new Set(ids).size).toBe(3);
    expect(buildWorld(input).repos.map((repo) => repo.id)).toEqual(ids);
    expect(world.agents.map((agent) => agent.repoId)).toEqual([
      world.repos.find((repo) => repo.path === 'D:/git/app')!.id,
      null,
    ]);
  });

  it('keeps the newest of two observations with one id instead of failing validation', () => {
    const older = { ...agent('D:/git/app'), id: 'same', updatedAt: 1 };
    const newer = { ...agent('C:/elsewhere'), id: 'same', updatedAt: 2 };
    const world = buildWorld({
      roots: ['D:/git'],
      repos: [repo('D:/git/app')],
      agents: [older, newer],
      version: 1,
      now: 1,
    });
    expect(world.agents).toHaveLength(1);
    expect(world.agents[0]).toMatchObject({
      cwd: 'C:/elsewhere',
      repoId: null,
    });
  });
});
