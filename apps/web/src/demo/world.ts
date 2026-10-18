import { layoutDistricts, seedFromString } from '@nabi/building-gen';
import {
  maturities,
  worldSchema,
  type ActivityLevel,
  type AgentNpc,
  type BuildingSpec,
  type Check,
  type Helper,
  type HelperCategory,
  type HelperState,
  type Maturity,
  type Recommendations,
  type Repo,
  type RepoAnalysis,
  type World,
} from '@nabi/protocol';

/**
 * Presentation fixture, shown only at `?demo` and labelled as demo data everywhere.
 * Two districts, every building style and maturity stage, and a busy afternoon of
 * sessions handing work to MCP servers, web requests and subagents.
 */
const NOW = Date.UTC(2026, 9, 18, 14, 30);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

type CheckId =
  | 'readme'
  | 'setup-docs'
  | 'architecture-docs'
  | 'license'
  | 'tests'
  | 'e2e'
  | 'lint'
  | 'format'
  | 'types'
  | 'ci'
  | 'ci-quality'
  | 'dependency-updates'
  | 'lockfile'
  | 'container'
  | 'deploy'
  | 'releases'
  | 'todo-debt'
  | 'gitignore';

/** Label, area, weight, and the evidence a pass / partial / miss shows. */
const CHECKS: Record<
  CheckId,
  [string, Check['area'], number, string, string, string]
> = {
  readme: [
    'README',
    'documentation',
    1,
    'README.md (184 lines)',
    'README.md (6 lines)',
    'No README at the root',
  ],
  'setup-docs': [
    'Setup instructions',
    'documentation',
    1,
    'README.md has a setup section',
    'README.md has a setup section',
    'No install/usage section found',
  ],
  'architecture-docs': [
    'Architecture & docs',
    'documentation',
    0.5,
    'docs/ARCHITECTURE.md, docs/adr/0001-routing.md +6',
    'docs/getting-started.md',
    'No docs/ folder or ARCHITECTURE file',
  ],
  license: [
    'Licence',
    'documentation',
    0.5,
    'LICENSE',
    'LICENSE',
    'No LICENSE file',
  ],
  tests: [
    'Automated tests',
    'testing',
    1,
    '142 test files · vitest',
    '3 test files · vitest',
    'No test files found',
  ],
  e2e: [
    'End-to-end tests',
    'testing',
    0.5,
    '@playwright/test, playwright.config.ts',
    'playwright.config.ts',
    'UI project without Playwright or Cypress',
  ],
  lint: [
    'Linting',
    'quality',
    1,
    'eslint.config.js · script "lint"',
    'eslint.config.js · no lint script',
    'No linter configured',
  ],
  format: [
    'Formatting',
    'quality',
    0.5,
    '.prettierrc.json, .editorconfig',
    '.editorconfig',
    'No formatter configured',
  ],
  types: [
    'Strict type checking',
    'quality',
    1,
    'strict mode in tsconfig.json',
    'tsconfig without "strict": true',
    'TypeScript without a tsconfig',
  ],
  ci: [
    'Continuous integration',
    'automation',
    1,
    '.github/workflows/ci.yml · runs tests',
    '.github/workflows/release.yml · does not run tests',
    'No CI workflow',
  ],
  'ci-quality': [
    'CI quality gates',
    'automation',
    0.5,
    'CI runs lint or type checks',
    'CI runs lint or type checks',
    'CI runs no lint or type check',
  ],
  'dependency-updates': [
    'Dependency updates',
    'automation',
    0.5,
    '.github/dependabot.yml',
    '.github/dependabot.yml',
    'No Dependabot or Renovate',
  ],
  lockfile: [
    'Reproducible installs',
    'delivery',
    0.5,
    'lockfile: pnpm',
    'lockfile: pnpm',
    'package.json without a lockfile',
  ],
  container: [
    'Container setup',
    'delivery',
    0.5,
    'Dockerfile, compose.yaml',
    'Dockerfile',
    'No Dockerfile or devcontainer',
  ],
  deploy: [
    'Deployment',
    'delivery',
    0.5,
    'vercel.json, CI deploy step',
    'script "deploy"',
    'No deployment configuration',
  ],
  releases: [
    'Releases',
    'delivery',
    0.5,
    '38 tags · CHANGELOG.md',
    'CHANGELOG.md',
    'No tags or CHANGELOG',
  ],
  'todo-debt': [
    'TODO/FIXME debt',
    'maintenance',
    0.5,
    'Few TODO/FIXME markers',
    'Many TODO/FIXME markers',
    'Heavy TODO/FIXME debt',
  ],
  gitignore: [
    '.gitignore',
    'maintenance',
    0.5,
    '.gitignore',
    '.gitignore',
    'No .gitignore',
  ],
};

interface DemoRepo {
  name: string;
  district: 'acme' | 'labs';
  description: string;
  archetype: BuildingSpec['archetype'];
  maturity: Maturity;
  activity: ActivityLevel;
  languages: [string, number][];
  frameworks: string[];
  files: number;
  kib: number;
  /** Total commits, commits in the last 30 days, authors in the last 90. */
  commits: [number, number, number];
  todos: [number, number];
  /** Checks that do not pass; everything else passes. */
  missing?: CheckId[];
  partial?: CheckId[];
  /** Per-repository evidence overrides. */
  evidence?: Partial<Record<CheckId, string>>;
  /** UI projects are also checked for end-to-end tests. */
  ui?: boolean;
  scripts: string[];
  managers: string[];
  git: Repo['git'];
}

const clean = (branch = 'main'): Repo['git'] => ({
  branch,
  modified: 0,
  untracked: 0,
  ahead: 0,
  behind: 0,
});

const repos: DemoRepo[] = [
  // Acme: the product team.
  {
    name: 'storefront-web',
    district: 'acme',
    description: 'Next.js storefront: catalogue, cart and checkout.',
    archetype: 'pavilion',
    maturity: 'production',
    activity: 'active',
    languages: [
      ['TypeScript', 0.86],
      ['Markdown', 0.08],
      ['JavaScript', 0.06],
    ],
    frameworks: ['Next.js', 'React', 'Tailwind CSS', 'Zod'],
    files: 1240,
    kib: 9_800,
    commits: [2184, 146, 7],
    todos: [12, 1],
    partial: ['dependency-updates'],
    missing: ['container'],
    ui: true,
    scripts: [
      'dev',
      'build',
      'start',
      'lint',
      'typecheck',
      'test',
      'test:e2e',
      'storybook',
    ],
    managers: ['pnpm'],
    git: {
      branch: 'feat/checkout-redesign',
      modified: 9,
      untracked: 2,
      ahead: 4,
      behind: 1,
    },
  },
  {
    name: 'checkout-api',
    district: 'acme',
    description: 'Payments and order service behind the storefront.',
    archetype: 'office',
    maturity: 'production',
    activity: 'active',
    languages: [
      ['TypeScript', 0.94],
      ['Markdown', 0.06],
    ],
    frameworks: ['Fastify', 'Zod', 'Prisma'],
    files: 610,
    kib: 3_400,
    commits: [1530, 88, 5],
    todos: [21, 3],
    evidence: {
      tests: '318 test files · vitest',
      deploy: 'fly.toml, CI deploy step',
    },
    scripts: [
      'dev',
      'build',
      'test',
      'lint',
      'db:migrate',
      'db:seed',
      'deploy',
    ],
    managers: ['pnpm'],
    git: {
      branch: 'fix/refund-idempotency',
      modified: 3,
      untracked: 1,
      ahead: 1,
      behind: 0,
    },
  },
  {
    name: 'platform-gateway',
    district: 'acme',
    description:
      'Edge gateway: auth, rate limits and routing for every service.',
    archetype: 'tower',
    maturity: 'production',
    activity: 'recent',
    languages: [
      ['Kotlin', 0.81],
      ['Java', 0.12],
      ['Markdown', 0.07],
    ],
    frameworks: [],
    files: 2_480,
    kib: 18_200,
    commits: [4210, 41, 9],
    todos: [44, 6],
    missing: ['format'],
    evidence: {
      tests: '512 test files · JUnit',
      lockfile: 'lockfile: Gradle',
      container: 'Dockerfile, helm/',
      lint: 'detekt.yml · script "lint"',
    },
    scripts: ['build', 'test', 'lint', 'deploy'],
    managers: ['Gradle'],
    git: clean(),
  },
  {
    name: 'design-system',
    district: 'acme',
    description: 'Shared React components, tokens and icons.',
    archetype: 'pavilion',
    maturity: 'established',
    activity: 'recent',
    languages: [
      ['TypeScript', 0.78],
      ['Markdown', 0.12],
      ['JavaScript', 0.1],
    ],
    frameworks: ['React', 'Vite'],
    files: 520,
    kib: 2_100,
    commits: [640, 19, 4],
    todos: [8, 0],
    missing: ['container', 'deploy'],
    partial: ['e2e'],
    ui: true,
    scripts: ['build', 'storybook', 'test', 'lint', 'release'],
    managers: ['pnpm'],
    git: clean(),
  },
  {
    name: 'data-pipeline',
    district: 'acme',
    description: 'Nightly ETL from orders into the warehouse.',
    archetype: 'laboratory',
    maturity: 'developing',
    activity: 'active',
    languages: [
      ['Python', 0.91],
      ['Markdown', 0.09],
    ],
    frameworks: ['pandas', 'FastAPI'],
    files: 186,
    kib: 940,
    commits: [212, 37, 3],
    todos: [41, 7],
    missing: ['lint', 'types', 'ci-quality', 'releases', 'dependency-updates'],
    partial: ['architecture-docs', 'todo-debt'],
    evidence: {
      tests: '24 test files · pytest',
      lockfile: 'lockfile: uv',
      types: 'No mypy or pyright configuration',
      'todo-debt': '41 TODO · 7 FIXME in 186 files',
    },
    scripts: ['etl', 'test', 'backfill'],
    managers: ['uv'],
    git: {
      branch: 'feat/late-orders',
      modified: 5,
      untracked: 3,
      ahead: 2,
      behind: 0,
    },
  },
  {
    name: 'recommender-ml',
    district: 'acme',
    description: 'Product recommendations: training, evaluation, serving.',
    archetype: 'laboratory',
    maturity: 'established',
    activity: 'active',
    languages: [
      ['Python', 0.84],
      ['Markdown', 0.1],
      ['TypeScript', 0.06],
    ],
    frameworks: ['PyTorch', 'NumPy', 'FastAPI'],
    files: 430,
    kib: 6_600,
    commits: [890, 52, 4],
    todos: [63, 9],
    missing: ['dependency-updates', 'releases'],
    partial: ['todo-debt', 'types'],
    evidence: {
      tests: '67 test files · pytest',
      lockfile: 'lockfile: Poetry',
      types: 'mypy configured, not strict',
      'todo-debt': '63 TODO · 9 FIXME in 430 files',
    },
    scripts: ['train', 'eval', 'serve'],
    managers: ['Poetry'],
    git: {
      branch: 'exp/two-tower-v3',
      modified: 2,
      untracked: 6,
      ahead: 7,
      behind: 3,
    },
  },
  {
    name: 'mobile-app',
    district: 'acme',
    description: 'React Native shopping app for iOS and Android.',
    archetype: 'pavilion',
    maturity: 'developing',
    activity: 'recent',
    languages: [
      ['TypeScript', 0.9],
      ['Markdown', 0.06],
      ['JavaScript', 0.04],
    ],
    frameworks: ['React Native', 'React', 'Zod'],
    files: 340,
    kib: 4_200,
    commits: [96, 22, 2],
    todos: [27, 4],
    missing: ['e2e', 'ci', 'container', 'deploy', 'releases'],
    partial: ['tests'],
    ui: true,
    scripts: ['start', 'ios', 'android', 'test', 'lint'],
    managers: ['pnpm'],
    git: clean('feat/push-notifications'),
  },
  {
    name: 'docs-portal',
    district: 'acme',
    description: 'Public developer documentation and API reference.',
    archetype: 'library',
    maturity: 'established',
    activity: 'quiet',
    languages: [
      ['Markdown', 0.88],
      ['TypeScript', 0.12],
    ],
    frameworks: ['Astro'],
    files: 760,
    kib: 5_100,
    commits: [1012, 3, 6],
    todos: [5, 0],
    missing: ['container'],
    partial: ['tests'],
    evidence: { deploy: 'netlify.toml', tests: '4 test files · vitest' },
    scripts: ['dev', 'build', 'check-links', 'test'],
    managers: ['pnpm'],
    git: clean(),
  },
  // Labs: side projects, tools and experiments.
  {
    name: 'nabi-station',
    district: 'labs',
    description: 'A little city for your development workspace.',
    archetype: 'studio',
    maturity: 'developing',
    activity: 'active',
    languages: [
      ['TypeScript', 0.72],
      ['Markdown', 0.22],
      ['Python', 0.06],
    ],
    frameworks: ['React', 'Vite', 'Three.js', 'Zod'],
    files: 214,
    kib: 31_000,
    commits: [48, 48, 1],
    todos: [3, 0],
    missing: [
      'license',
      'lint',
      'ci',
      'dependency-updates',
      'container',
      'deploy',
      'releases',
    ],
    ui: true,
    scripts: [
      'dev',
      'build',
      'typecheck',
      'test',
      'test:e2e',
      'nabi',
      'format',
    ],
    managers: ['pnpm'],
    git: {
      branch: 'feat/active-sessions',
      modified: 14,
      untracked: 5,
      ahead: 3,
      behind: 0,
    },
  },
  {
    name: 'shader-playground',
    district: 'labs',
    description: 'WebGL experiments: SDFs, toon shading, particles.',
    archetype: 'studio',
    maturity: 'prototype',
    activity: 'recent',
    languages: [
      ['TypeScript', 0.64],
      ['JavaScript', 0.3],
      ['Markdown', 0.06],
    ],
    frameworks: ['Three.js', 'Vite'],
    files: 42,
    kib: 380,
    commits: [17, 9, 1],
    todos: [14, 2],
    missing: [
      'setup-docs',
      'architecture-docs',
      'license',
      'tests',
      'e2e',
      'lint',
      'ci',
      'dependency-updates',
      'container',
      'deploy',
      'releases',
    ],
    partial: ['readme', 'types'],
    ui: true,
    scripts: ['dev', 'build'],
    managers: ['npm'],
    git: { branch: 'main', modified: 2, untracked: 4, ahead: 0, behind: 0 },
  },
  {
    name: 'rust-indexer',
    district: 'labs',
    description: 'Fast code search index in Rust.',
    archetype: 'factory',
    maturity: 'established',
    activity: 'active',
    languages: [
      ['Rust', 0.93],
      ['Markdown', 0.07],
    ],
    frameworks: ['Tokio', 'Serde'],
    files: 260,
    kib: 1_700,
    commits: [377, 31, 2],
    todos: [19, 2],
    missing: ['container', 'deploy'],
    evidence: {
      tests: '58 test files · cargo test',
      lockfile: 'lockfile: Cargo',
      lint: 'clippy.toml · script "clippy"',
      format: 'rustfmt.toml',
    },
    scripts: ['bench', 'release', 'clippy'],
    managers: ['Cargo'],
    git: clean('perf/trigram-cache'),
  },
  {
    name: 'cli-toolkit',
    district: 'labs',
    description: 'Small Go CLIs for releases and changelogs.',
    archetype: 'factory',
    maturity: 'developing',
    activity: 'quiet',
    languages: [
      ['Go', 0.95],
      ['Markdown', 0.05],
    ],
    frameworks: [],
    files: 88,
    kib: 410,
    commits: [64, 0, 1],
    todos: [9, 1],
    missing: ['architecture-docs', 'container', 'deploy', 'dependency-updates'],
    partial: ['ci'],
    evidence: {
      tests: '14 test files · go test',
      lockfile: 'lockfile: Go modules',
      lint: '.golangci.yml · script "lint"',
    },
    scripts: ['build', 'lint'],
    managers: ['Go modules'],
    git: clean(),
  },
  {
    name: 'legacy-billing',
    district: 'labs',
    description: 'The old invoicing system, kept running for two customers.',
    archetype: 'townhouse',
    maturity: 'developing',
    activity: 'dormant',
    languages: [
      ['PHP', 0.89],
      ['JavaScript', 0.08],
      ['Markdown', 0.03],
    ],
    frameworks: ['Laravel'],
    files: 640,
    kib: 7_300,
    commits: [2903, 0, 0],
    todos: [310, 58],
    missing: [
      'architecture-docs',
      'license',
      'lint',
      'format',
      'ci',
      'dependency-updates',
      'deploy',
      'todo-debt',
    ],
    partial: ['tests', 'readme'],
    evidence: {
      lockfile: 'lockfile: Composer',
      container: 'Dockerfile',
      'todo-debt': '310 TODO · 58 FIXME in 640 files',
    },
    scripts: ['serve', 'migrate'],
    managers: ['Composer'],
    git: clean('master'),
  },
  {
    name: 'team-blog',
    district: 'labs',
    description: 'Engineering blog, written in Markdown.',
    archetype: 'townhouse',
    maturity: 'established',
    activity: 'quiet',
    languages: [
      ['Markdown', 0.71],
      ['Ruby', 0.29],
    ],
    frameworks: [],
    files: 290,
    kib: 12_400,
    commits: [455, 2, 8],
    todos: [1, 0],
    missing: ['container'],
    partial: ['tests'],
    evidence: {
      lockfile: 'lockfile: Bundler',
      deploy: 'netlify.toml',
      tests: '2 test files · html-proofer',
    },
    scripts: ['serve', 'build'],
    managers: ['Bundler'],
    git: clean(),
  },
  {
    name: 'voice-notes',
    district: 'labs',
    description: 'A fresh idea: one commit so far.',
    archetype: 'pavilion',
    maturity: 'empty',
    activity: 'active',
    languages: [['Markdown', 1]],
    frameworks: [],
    files: 2,
    kib: 1,
    commits: [1, 1, 1],
    todos: [0, 0],
    missing: [
      'setup-docs',
      'architecture-docs',
      'license',
      'tests',
      'lint',
      'format',
      'ci',
      'dependency-updates',
      'container',
      'deploy',
      'releases',
    ],
    partial: ['readme'],
    scripts: [],
    managers: [],
    git: { branch: 'main', modified: 0, untracked: 3, ahead: 1, behind: 0 },
  },
];

const ageOf: Record<ActivityLevel, number> = {
  active: 2 * HOUR,
  recent: 12 * DAY,
  quiet: 70 * DAY,
  dormant: 420 * DAY,
};

function analysisFor(repo: DemoRepo): RepoAnalysis {
  const typed = repo.languages.some(([name]) =>
    ['TypeScript', 'Python'].includes(name),
  );
  const ids = (Object.keys(CHECKS) as CheckId[]).filter(
    (id) =>
      (id !== 'e2e' || repo.ui) &&
      (id !== 'types' || typed) &&
      (id !== 'ci-quality' || !repo.missing?.includes('ci')) &&
      (id !== 'lockfile' || repo.managers.length > 0),
  );
  const checks: Check[] = ids.map((id) => {
    const [label, area, weight, pass, partial, missing] = CHECKS[id];
    const status: Check['status'] = repo.missing?.includes(id)
      ? 'missing'
      : repo.partial?.includes(id)
        ? 'partial'
        : 'pass';
    const evidence =
      repo.evidence?.[id] ??
      (status === 'pass' ? pass : status === 'partial' ? partial : missing);
    return { id, label, area, status, weight, evidence };
  });
  const value = { pass: 1, partial: 0.5, missing: 0 };
  const total = checks.reduce((sum, check) => sum + check.weight, 0);
  const score = Math.round(
    (checks.reduce(
      (sum, check) => sum + check.weight * value[check.status],
      0,
    ) /
      total) *
      100,
  );
  const [commits, last30Days, authors] = repo.commits;
  return {
    maturity: repo.maturity,
    activity: repo.activity,
    score,
    sizeBand:
      repo.files < 30
        ? 1
        : repo.files < 200
          ? 2
          : repo.files < 1000
            ? 3
            : repo.files < 5000
              ? 4
              : 5,
    trackedBytes: repo.kib * 1024,
    fileCount: repo.files,
    languages: repo.languages.map(([name, share]) => ({ name, share })),
    frameworks: repo.frameworks,
    packageManagers: repo.managers,
    scripts: repo.scripts,
    dependencies: {
      runtime: repo.files > 2 ? Math.round(repo.files / 40) + 3 : 0,
      dev: repo.files > 2 ? Math.round(repo.files / 30) + 5 : 0,
    },
    folders:
      repo.files > 2
        ? [
            { name: 'src/', files: Math.round(repo.files * 0.62) },
            { name: 'tests/', files: Math.round(repo.files * 0.18) },
            { name: 'docs/', files: Math.round(repo.files * 0.08) },
            { name: '(root files)', files: 14 },
          ]
        : [{ name: '(root files)', files: repo.files }],
    commits: {
      total: commits,
      last30Days,
      last90Days: Math.min(commits, Math.round(last30Days * 2.4)),
      authors90Days: authors,
      lastCommitAt: NOW - ageOf[repo.activity],
      firstCommitAt: NOW - Math.min(commits, 1200) * DAY * 0.6,
    },
    todos: { todo: repo.todos[0], fixme: repo.todos[1] },
    checks,
  };
}

/** Same rules as the daemon: maturity is the tier, passed checks are annexes. */
function buildingFor(repo: DemoRepo, analysis: RepoAnalysis): BuildingSpec {
  const passed = (id: CheckId) =>
    analysis.checks.some((check) => check.id === id && check.status === 'pass');
  const modules: BuildingSpec['modules'] = [];
  if (passed('tests')) modules.push('tests');
  if (passed('e2e')) modules.push('e2e');
  if (passed('ci')) modules.push('ci');
  if (passed('lint')) modules.push('lint');
  if (passed('readme') || passed('architecture-docs')) modules.push('docs');
  if (passed('container')) modules.push('container');
  if (passed('deploy')) modules.push('deploy');
  if (passed('releases')) modules.push('release');
  return {
    archetype: repo.archetype,
    tier: maturities.indexOf(repo.maturity),
    seed: seedFromString(repo.name),
    modules,
    footprint: analysis.sizeBand <= 2 ? 1 : analysis.sizeBand <= 3 ? 2 : 3,
    maturity: repo.maturity,
    activity: repo.activity,
  };
}

const helper = (
  id: string,
  label: string,
  category: HelperCategory,
  state: HelperState,
  calls: number,
  tool?: string,
  minutesAgo = 3,
): Helper => ({
  id,
  label,
  category,
  state,
  calls,
  ...(tool && { tool }),
  lastUsedAt: NOW - minutesAgo * 60_000,
});

const session = ({
  minutesAgo = 1,
  ...agent
}: Omit<AgentNpc, 'source' | 'updatedAt'> & {
  minutesAgo?: number;
}): AgentNpc => ({
  ...agent,
  source: 'Demo fixture',
  updatedAt: NOW - minutesAgo * 60_000,
});

const path = (repo: string) =>
  `D:/work/${repos.find((entry) => entry.name === repo)!.district}/${repo}`;

const agents: AgentNpc[] = [
  session({
    id: 'claude-assets',
    name: 'Claude Code · city assets',
    kind: 'claude-code',
    repoId: 'nabi-station',
    activity: 'delegating',
    confidence: 'high',
    detail: 'Waiting on Blender · execute_blender_code',
    pid: 42396,
    cwd: path('nabi-station'),
    helpers: [
      helper(
        'mcp:blender',
        'Blender',
        '3d',
        'active',
        21,
        'execute_blender_code',
        0,
      ),
      helper(
        'subagent:Explore',
        'Explore subagent',
        'subagent',
        'active',
        2,
        undefined,
        0,
      ),
      helper('mcp:meshy', 'Meshy', '3d', 'recent', 53, 'meshy_animate', 4),
      helper(
        'mcp:higgsfield',
        'Higgsfield',
        'media',
        'recent',
        7,
        'generate_image',
        6,
      ),
      helper('mcp:claude_docs', 'Claude Docs', 'docs', 'recent', 2, 'read', 11),
    ],
  }),
  session({
    id: 'cursor-nabi',
    name: 'Cursor · nabi-station 78b3',
    kind: 'cursor',
    repoId: 'nabi-station',
    activity: 'waiting-input',
    confidence: 'medium',
    detail: 'Composer finished',
    cwd: path('nabi-station'),
    minutesAgo: 3,
  }),
  session({
    id: 'claude-storefront',
    name: 'Claude Code · checkout redesign',
    kind: 'claude-code',
    repoId: 'storefront-web',
    activity: 'delegating',
    confidence: 'high',
    detail: 'Waiting on Chrome · take_screenshot',
    pid: 18204,
    cwd: path('storefront-web'),
    helpers: [
      helper(
        'mcp:claude-in-chrome',
        'Chrome',
        'browser',
        'active',
        14,
        'take_screenshot',
        0,
      ),
      helper(
        'mcp:figma',
        'Figma',
        'design',
        'recent',
        6,
        'get_design_context',
        4,
      ),
      helper('web', 'Web', 'web', 'recent', 3, 'WebFetch', 9),
    ],
  }),
  session({
    id: 'codex-storefront',
    name: 'Codex · storefront-web a41c',
    kind: 'codex',
    repoId: 'storefront-web',
    activity: 'reading',
    confidence: 'high',
    detail: 'Turn in progress: imageView',
    cwd: path('storefront-web'),
    helpers: [
      helper(
        'mcp:github',
        'GitHub',
        'code-host',
        'recent',
        11,
        'get_pull_request',
        2,
      ),
    ],
  }),
  session({
    id: 'claude-checkout',
    name: 'Claude Code · refunds',
    kind: 'claude-code',
    repoId: 'checkout-api',
    activity: 'waiting-permission',
    confidence: 'low',
    detail: 'mcp__postgres__execute_sql has no result; session status "idle"',
    pid: 22916,
    cwd: path('checkout-api'),
    minutesAgo: 2,
    helpers: [
      helper(
        'mcp:postgres',
        'Postgres',
        'database',
        'waiting',
        4,
        'execute_sql',
        2,
      ),
      helper(
        'mcp:sentry',
        'Sentry',
        'cloud',
        'recent',
        3,
        'get_issue_details',
        6,
      ),
    ],
  }),
  session({
    id: 'codex-gateway',
    name: 'Codex · platform-gateway 77e2',
    kind: 'codex',
    repoId: 'platform-gateway',
    activity: 'failed',
    confidence: 'high',
    detail: 'Last turn failed',
    cwd: path('platform-gateway'),
    minutesAgo: 6,
    helpers: [
      helper(
        'mcp:github',
        'GitHub',
        'code-host',
        'failed',
        2,
        'create_branch',
        6,
      ),
    ],
  }),
  session({
    id: 'claude-pipeline',
    name: 'Claude Code · late orders',
    kind: 'claude-code',
    repoId: 'data-pipeline',
    activity: 'running-tool',
    confidence: 'high',
    detail: 'Bash uv run pytest tests/test_late_orders.py',
    pid: 9120,
    cwd: path('data-pipeline'),
    helpers: [
      helper(
        'mcp:bigquery',
        'BigQuery',
        'database',
        'recent',
        8,
        'run_query',
        3,
      ),
      helper('mcp:notion', 'Notion', 'docs', 'recent', 1, 'search', 15),
    ],
  }),
  session({
    id: 'claude-recommender',
    name: 'Claude Code · eval report',
    kind: 'claude-code',
    repoId: 'recommender-ml',
    activity: 'waiting-input',
    confidence: 'medium',
    detail: 'Turn finished; session status "idle"',
    pid: 31408,
    cwd: path('recommender-ml'),
    minutesAgo: 4,
    helpers: [
      helper(
        'mcp:hugging_face',
        'Hugging Face',
        'tool',
        'recent',
        5,
        'model_search',
        7,
      ),
      helper(
        'subagent:general-purpose',
        'general-purpose subagent',
        'subagent',
        'recent',
        3,
        undefined,
        5,
      ),
      helper('web', 'Web', 'web', 'recent', 6, 'WebSearch', 8),
    ],
  }),
  session({
    id: 'cursor-mobile',
    name: 'Cursor · push notifications',
    kind: 'cursor',
    repoId: 'mobile-app',
    activity: 'editing',
    confidence: 'high',
    detail: 'edit_file src/notifications/register.ts',
    cwd: path('mobile-app'),
  }),
  session({
    id: 'claude-indexer',
    name: 'Claude Code · trigram cache',
    kind: 'claude-code',
    repoId: 'rust-indexer',
    activity: 'working',
    confidence: 'high',
    detail: 'Thinking',
    pid: 27744,
    cwd: path('rust-indexer'),
    helpers: [
      helper(
        'mcp:context7',
        'Context7',
        'docs',
        'recent',
        4,
        'get-library-docs',
        5,
      ),
    ],
  }),
  session({
    id: 'codex-scratch',
    name: 'Codex · scratch 19fa',
    kind: 'codex',
    repoId: null,
    activity: 'idle',
    confidence: 'low',
    detail: 'Last turn completed',
    cwd: 'D:/work/scratch',
    minutesAgo: 26,
  }),
];

export function createDemoWorld(): World {
  const districts = ['acme', 'labs'] as const;
  const byDistrict = districts.map((district) =>
    repos.filter((repo) => repo.district === district),
  );
  const positions = layoutDistricts(byDistrict.map((list) => list.length));
  return worldSchema.parse({
    version: 1,
    mode: 'demo',
    updatedAt: NOW,
    districts: districts.map((district, index) => ({
      id: district,
      name: district === 'acme' ? 'Acme product' : 'Labs',
      rootPath: `D:/work/${district}`,
      plots: byDistrict[index]!.map((repo, plot) => ({
        id: `plot-${repo.name}`,
        repoId: repo.name,
        position: positions[index]![plot],
      })),
    })),
    repos: repos.map((repo) => {
      const analysis = analysisFor(repo);
      return {
        id: repo.name,
        name: repo.name,
        path: path(repo.name),
        districtId: repo.district,
        language:
          repo.languages.find(([name]) => name !== 'Markdown')?.[0] ??
          'Markdown',
        description: repo.description,
        building: buildingFor(repo, analysis),
        git: repo.git,
        analysis,
      };
    }),
    agents,
  });
}

/**
 * Example recommendations for the demo, labelled as examples in the panel. Real
 * recommendations come from the local model, for real repositories only.
 */
export const demoRecommendations: Record<string, Recommendations> = {
  'nabi-station': {
    strengths: [
      'Strict TypeScript across every package',
      'Unit and Playwright tests already in place',
      'Reproducible installs with pnpm',
      'Clear setup instructions in the README',
    ],
    recommendedImprovements: [
      {
        priority: 'high',
        area: 'CI',
        reason:
          'Tests and type checks only run on one machine, so regressions can reach main unnoticed.',
        suggestion:
          'Add a GitHub Actions workflow that runs typecheck, unit and end-to-end tests on pull requests.',
      },
      {
        priority: 'high',
        area: 'Licence',
        reason:
          'Without a licence nobody else can legally use or contribute to the project.',
        suggestion: 'Add a LICENSE file at the root (MIT or Apache-2.0).',
      },
      {
        priority: 'medium',
        area: 'Linting',
        reason:
          'Prettier formats the code, but nothing catches unused code or hook mistakes.',
        suggestion:
          'Add ESLint with typescript-eslint and react-hooks, and a "lint" script.',
      },
      {
        priority: 'low',
        area: 'Dependencies',
        reason: 'Three.js and React move quickly; manual upgrades fall behind.',
        suggestion: 'Enable Dependabot for npm with weekly grouped updates.',
      },
    ],
    agentPrompt: `You are working in nabi-station, a pnpm TypeScript monorepo (React, Vite, Three.js, Zod).

1. Create .github/workflows/ci.yml that installs with pnpm and runs pnpm typecheck, pnpm test and pnpm test:e2e (after pnpm exec playwright install chromium) on pushes and pull requests to main.
2. Add an MIT LICENSE file at the repository root.

Inspect the existing setup before changing anything, keep changes minimal and consistent with the codebase, leave unrelated code alone, and finish by running pnpm typecheck and pnpm test.

Acceptance criteria:
1. A pull request triggers the workflow and it passes.
2. LICENSE exists at the root.`,
  },
  'data-pipeline': {
    strengths: [
      'Tests run with pytest',
      'Reproducible installs with uv',
      'Active development by a small team',
    ],
    recommendedImprovements: [
      {
        priority: 'high',
        area: 'Code quality',
        reason:
          'With no linter or type checker, schema drift in the ETL only shows up in the nightly run.',
        suggestion:
          'Configure ruff and mypy in pyproject.toml and run both in CI.',
      },
      {
        priority: 'high',
        area: 'Technical debt',
        reason:
          '41 TODOs and 7 FIXMEs in 186 files point at unfinished error handling.',
        suggestion:
          'Resolve the FIXMEs first and turn the rest into tracked issues.',
      },
      {
        priority: 'medium',
        area: 'Documentation',
        reason:
          'Only a getting-started page exists; the data flow lives in people’s heads.',
        suggestion:
          'Add docs/ARCHITECTURE.md describing sources, stages and warehouse tables.',
      },
    ],
    agentPrompt: `You are working in data-pipeline, a Python ETL project (pandas, FastAPI) managed with uv.

1. Add ruff and mypy configuration to pyproject.toml, fix what they report in the pipeline package, and add "lint" and "typecheck" targets next to the existing "test" target.
2. Resolve the FIXME comments in the pipeline code, and replace each remaining TODO with a short reference to a tracked issue.

Inspect the existing setup before changing anything, keep changes minimal and consistent with the codebase, leave unrelated code alone, and finish by running the existing test target.

Acceptance criteria:
1. The lint and typecheck targets pass.
2. No FIXME comments remain.`,
  },
  'storefront-web': {
    strengths: [
      'Production-ready, with 142 test files',
      'Playwright covers the checkout flows',
      'Automated deploys through Vercel',
    ],
    recommendedImprovements: [
      {
        priority: 'medium',
        area: 'Container',
        reason:
          'Local setup depends on each developer’s Node version and services.',
        suggestion: 'Add a devcontainer with Node 22 and pnpm.',
      },
      {
        priority: 'low',
        area: 'Dependencies',
        reason: 'Dependabot runs, but ungrouped updates create review noise.',
        suggestion:
          'Group minor and patch updates into one weekly pull request.',
      },
    ],
    agentPrompt: `You are working in storefront-web, a Next.js storefront (React, Tailwind CSS, Zod) using pnpm.

1. Add .devcontainer/devcontainer.json with Node 22 and pnpm, forwarding port 3000, and run pnpm install on create.

Inspect the existing setup before changing anything, keep changes minimal and consistent with the codebase, leave unrelated code alone, and finish by running pnpm lint and pnpm test.

Acceptance criteria:
1. The project opens and starts in the devcontainer.`,
  },
};
