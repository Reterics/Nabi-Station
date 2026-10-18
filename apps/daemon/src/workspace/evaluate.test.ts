import { describe, expect, it } from 'vitest';
import { evaluate } from './evaluate';
import type { RepoFacts } from './inspect';

const DAY = 86_400_000;
const now = Date.UTC(2026, 9, 18, 12);

function facts(overrides: Partial<RepoFacts> = {}): RepoFacts {
  return {
    files: [],
    trackedBytes: 1000,
    commits: {
      total: 40,
      recent: [now - DAY, now - 40 * DAY],
      authors90Days: 2,
      lastCommitAt: now - DAY,
      firstCommitAt: now - 400 * DAY,
    },
    tags: 0,
    todos: { todo: 0, fixme: 0 },
    texts: {},
    ...overrides,
  };
}

const source = (count: number, dir = 'src') =>
  Array.from({ length: count }, (_, index) => `${dir}/module${index}.ts`);
const readme = `# App\n${'Line of text.\n'.repeat(20)}\n## Getting started\npnpm install\n`;
const packageJson = JSON.stringify({
  scripts: { test: 'vitest run', lint: 'eslint .', deploy: 'wrangler deploy' },
  dependencies: { react: '19.0.0' },
  devDependencies: {
    vitest: '5.0.0',
    eslint: '9.0.0',
    prettier: '3.0.0',
    '@playwright/test': '1.50.0',
  },
});

/** A well-kept TypeScript web app: every check passes. */
const complete = facts({
  files: [
    'README.md',
    'LICENSE',
    'CHANGELOG.md',
    '.gitignore',
    'package.json',
    'pnpm-lock.yaml',
    'tsconfig.json',
    'eslint.config.js',
    '.prettierrc.json',
    'playwright.config.ts',
    'Dockerfile',
    '.github/workflows/ci.yml',
    '.github/dependabot.yml',
    'docs/ARCHITECTURE.md',
    ...source(30),
    ...Array.from({ length: 8 }, (_, index) => `src/module${index}.test.ts`),
  ],
  tags: 3,
  texts: {
    'README.md': readme,
    'package.json': packageJson,
    'tsconfig.json': '{ "compilerOptions": { "strict": true } }',
    '.github/workflows/ci.yml':
      'jobs:\n  test:\n    steps:\n      - run: pnpm lint\n      - run: pnpm test\n',
  },
});

describe('repository evaluation', () => {
  it('rates a complete, tested, automated repository as production-ready', () => {
    const analysis = evaluate(complete, now);
    const notPassing = analysis.checks.filter(
      (check) => check.status !== 'pass',
    );
    expect(notPassing).toEqual([]);
    expect(analysis).toMatchObject({
      maturity: 'production',
      score: 100,
      activity: 'active',
      frameworks: ['React'],
      packageManagers: ['pnpm'],
      dependencies: { runtime: 1, dev: 4 },
    });
    expect(analysis.scripts).toEqual(['test', 'lint', 'deploy']);
    expect(analysis.languages[0]).toEqual({ name: 'TypeScript', share: 0.91 });
  });

  it('is deterministic', () => {
    expect(evaluate(complete, now)).toEqual(evaluate(complete, now));
  });

  it('explains every gap with evidence', () => {
    const analysis = evaluate(
      facts({
        files: ['README.md', 'package.json', ...source(12)],
        texts: { 'README.md': '# x\n', 'package.json': '{}' },
      }),
      now,
    );
    const byId = Object.fromEntries(
      analysis.checks.map((check) => [check.id, check]),
    );
    expect(byId.readme).toMatchObject({
      status: 'partial',
      evidence: 'README.md (1 lines)',
    });
    expect(byId.tests).toMatchObject({
      status: 'missing',
      evidence: 'No test files found',
    });
    expect(byId.ci).toMatchObject({ status: 'missing' });
    expect(byId.types).toMatchObject({
      status: 'missing',
      evidence: 'TypeScript without a tsconfig',
    });
    expect(byId.lockfile).toMatchObject({ status: 'missing' });
    expect(analysis.maturity).toBe('prototype');
  });

  it('keeps maturity and activity on separate axes', () => {
    const dormant = facts({
      ...complete,
      commits: {
        ...complete.commits,
        recent: [],
        lastCommitAt: now - 400 * DAY,
      },
    });
    expect(evaluate(dormant, now)).toMatchObject({
      maturity: 'production',
      activity: 'dormant',
    });
  });

  it('caps young histories and treats content-free repositories as empty', () => {
    const firstCommit = facts({
      ...complete,
      commits: { ...complete.commits, total: 1 },
    });
    expect(evaluate(firstCommit, now).maturity).toBe('developing');
    expect(evaluate(facts({ files: ['.gitignore'] }), now).maturity).toBe(
      'empty',
    );
  });

  it('only asks UI projects for end-to-end tests, and CI that exists to run them', () => {
    const library = evaluate(
      facts({
        files: [
          'Cargo.toml',
          'Cargo.lock',
          '.github/workflows/ci.yml',
          ...source(5),
        ],
        texts: {
          'Cargo.toml':
            '[dependencies]\nserde = "1"\ntokio = { version = "1" }\n',
          '.github/workflows/ci.yml': 'steps:\n  - run: cargo build\n',
        },
      }),
      now,
    );
    expect(library.checks.some((check) => check.id === 'e2e')).toBe(false);
    expect(library.frameworks).toEqual(['Tokio', 'Serde']);
    expect(library.checks.find((check) => check.id === 'ci')).toMatchObject({
      status: 'partial',
      evidence: '.github/workflows/ci.yml · does not run tests',
    });
  });
});
