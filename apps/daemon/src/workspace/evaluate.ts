import type {
  ActivityLevel,
  Check,
  CheckArea,
  CheckStatus,
  Maturity,
  RepoAnalysis,
} from '@nabi/protocol';
import { LANGUAGES } from './analyze';
import type { RepoFacts } from './inspect';

const DAY = 86_400_000;

/** Package names that identify a framework or major tool; checked against every manifest. */
const FRAMEWORKS: [RegExp, string][] = [
  [/^next$/, 'Next.js'],
  [/^react$/, 'React'],
  [/^vue$/, 'Vue'],
  [/^svelte$|^@sveltejs\/kit$/, 'Svelte'],
  [/^@angular\/core$/, 'Angular'],
  [/^solid-js$/, 'Solid'],
  [/^astro$/, 'Astro'],
  [/^vite$/, 'Vite'],
  [/^electron$/, 'Electron'],
  [/^@tauri-apps\/api$|^tauri$/, 'Tauri'],
  [/^three$|^@react-three\/fiber$/, 'Three.js'],
  [/^tailwindcss$/, 'Tailwind CSS'],
  [/^express$/, 'Express'],
  [/^fastify$/, 'Fastify'],
  [/^@nestjs\/core$/, 'NestJS'],
  [/^hono$/, 'Hono'],
  [/^zod$/, 'Zod'],
  [/^prisma$|^@prisma\/client$/, 'Prisma'],
  [/^drizzle-orm$/, 'Drizzle'],
  [/^react-native$|^expo$/, 'React Native'],
  [/^django$/i, 'Django'],
  [/^flask$/i, 'Flask'],
  [/^fastapi$/i, 'FastAPI'],
  [/^torch$/i, 'PyTorch'],
  [/^tensorflow$/i, 'TensorFlow'],
  [/^pandas$/i, 'pandas'],
  [/^numpy$/i, 'NumPy'],
  [/^tokio$/, 'Tokio'],
  [/^axum$/, 'Axum'],
  [/^actix-web$/, 'Actix'],
  [/^bevy$/, 'Bevy'],
  [/^serde$/, 'Serde'],
  [/^github\.com\/gin-gonic\/gin$/, 'Gin'],
  [/^github\.com\/labstack\/echo/, 'Echo'],
  [/^laravel\/framework$/, 'Laravel'],
  [/^symfony\//, 'Symfony'],
  [/^rails$/, 'Rails'],
];
const FRONTEND = new Set([
  'Next.js',
  'React',
  'Vue',
  'Svelte',
  'Angular',
  'Solid',
  'Astro',
  'Electron',
  'Tauri',
]);

interface Manifests {
  runtime: Set<string>;
  dev: Set<string>;
  scripts: Map<string, string>;
  packageManagers: string[];
}

const parseJson = (text: string): Record<string, unknown> | undefined => {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return undefined;
  }
};
const keys = (value: unknown) =>
  value && typeof value === 'object' ? Object.keys(value) : [];

/** TOML `[section]` body up to the next header; good enough for dependency names. */
const tomlSection = (text: string, header: RegExp) => {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => header.test(line.trim()));
  if (start < 0) return [];
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\s*\[/.test(line)) break;
    body.push(line);
  }
  return body;
};

function readManifests(facts: RepoFacts): Manifests {
  const runtime = new Set<string>();
  const dev = new Set<string>();
  const scripts = new Map<string, string>();
  for (const [path, text] of Object.entries(facts.texts)) {
    const name = path.split('/').pop()!;
    if (name === 'package.json') {
      const json = parseJson(text);
      if (!json) continue;
      for (const dep of keys(json.dependencies)) runtime.add(dep);
      for (const dep of keys(json.peerDependencies)) runtime.add(dep);
      for (const dep of keys(json.devDependencies)) dev.add(dep);
      const own = (json.scripts ?? {}) as Record<string, unknown>;
      for (const [script, command] of Object.entries(own))
        if (typeof command === 'string') {
          // Root scripts by name; workspace scripts only when the root lacks them.
          if (!path.includes('/') || !scripts.has(script))
            scripts.set(script, command);
        }
    } else if (name === 'Cargo.toml') {
      const names = (header: RegExp) =>
        tomlSection(text, header).flatMap(
          (line) => /^([\w-]+)\s*=/.exec(line)?.[1] ?? [],
        );
      for (const dep of names(/^\[(workspace\.)?dependencies\]$/))
        runtime.add(dep);
      for (const dep of names(/^\[dev-dependencies\]$/)) dev.add(dep);
    } else if (name === 'go.mod') {
      for (const match of text.matchAll(
        /^\s*(?:require\s+)?([\w.-]+\.[a-z]+\/[\w./-]+)\s+v/gm,
      ))
        runtime.add(match[1]!);
    } else if (name === 'pyproject.toml' || /^requirements/.test(name)) {
      const source = name === 'pyproject.toml' ? text : `\n${text}`;
      const block =
        name === 'pyproject.toml'
          ? (/dependencies\s*=\s*\[([^\]]*)\]/.exec(source)?.[1] ?? '')
          : source;
      for (const match of block.matchAll(/^\s*["']?([A-Za-z][\w.-]*)/gm))
        runtime.add(match[1]!.toLowerCase());
    } else if (name === 'composer.json') {
      const json = parseJson(text);
      for (const dep of keys(json?.require)) runtime.add(dep);
      for (const dep of keys(json?.['require-dev'])) dev.add(dep);
    } else if (name === 'Gemfile') {
      for (const match of text.matchAll(/^\s*gem\s+["']([\w-]+)["']/gm))
        runtime.add(match[1]!);
    } else if (name === 'Makefile' || name === 'justfile') {
      for (const match of text.matchAll(/^([a-z][\w-]*):(?!=)/gm))
        if (!scripts.has(match[1]!)) scripts.set(match[1]!, `make ${match[1]}`);
    }
  }
  const has = (pattern: RegExp) =>
    facts.files.some((file) => pattern.test(file));
  const packageManagers = (
    [
      [/^pnpm-lock\.yaml$/, 'pnpm'],
      [/^yarn\.lock$/, 'Yarn'],
      [/^package-lock\.json$/, 'npm'],
      [/^bun\.lockb?$/, 'Bun'],
      [/^poetry\.lock$/, 'Poetry'],
      [/^uv\.lock$/, 'uv'],
      [/^Pipfile\.lock$/, 'Pipenv'],
      [/^Cargo\.lock$/, 'Cargo'],
      [/^go\.sum$/, 'Go modules'],
      [/^composer\.lock$/, 'Composer'],
      [/^Gemfile\.lock$/, 'Bundler'],
    ] as const
  )
    .filter(([pattern]) => has(pattern))
    .map(([, name]) => name);
  return { runtime, dev, scripts, packageManagers };
}

function check(
  id: string,
  label: string,
  area: CheckArea,
  status: CheckStatus,
  evidence: string,
  weight = 1,
): Check {
  return { id, label, area, status, weight, evidence };
}

const list = (items: string[], max = 3) =>
  items.length > max
    ? `${items.slice(0, max).join(', ')} +${items.length - max}`
    : items.join(', ');

/**
 * Pure: facts → checks, score, maturity, activity. Same input, same verdict; there
 * is no model in this path.
 */
export function evaluate(facts: RepoFacts, now: number): RepoAnalysis {
  const { files, texts } = facts;
  const matching = (pattern: RegExp) =>
    files.filter((file) => pattern.test(file));
  const manifests = readManifests(facts);
  const deps = new Set([...manifests.runtime, ...manifests.dev]);
  const depMatching = (pattern: RegExp) =>
    [...deps].filter((dep) => pattern.test(dep));
  const scriptNames = [...manifests.scripts.keys()];
  const scriptFor = (pattern: RegExp) =>
    [...manifests.scripts].find(
      ([name, command]) => pattern.test(name) || pattern.test(command),
    );

  // Languages by tracked file count, ignoring vendored trees.
  const counts = new Map<string, number>();
  for (const file of files) {
    if (/(^|\/)(vendor|third_party|node_modules)\//.test(file)) continue;
    const language = LANGUAGES[file.split('.').pop()?.toLowerCase() ?? ''];
    if (language) counts.set(language, (counts.get(language) ?? 0) + 1);
  }
  const counted = [...counts.values()].reduce((sum, n) => sum + n, 0) || 1;
  const languages = [...counts]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, n]) => ({
      name,
      share: Math.round((n / counted) * 100) / 100,
    }));
  const codeLanguages = new Set(
    languages.filter((l) => l.name !== 'Markdown').map((l) => l.name),
  );
  const frameworks = [
    ...new Set(
      FRAMEWORKS.filter(([pattern]) =>
        [...deps].some((dep) => pattern.test(dep)),
      ).map(([, name]) => name),
    ),
  ];

  const checks: Check[] = [];

  // Documentation.
  const readme = Object.keys(texts).find((path) => /^readme(\.|$)/i.test(path));
  const readmeLines = readme
    ? texts[readme]!.split('\n').filter((line) => line.trim()).length
    : 0;
  checks.push(
    check(
      'readme',
      'README',
      'documentation',
      readmeLines >= 15 ? 'pass' : readme ? 'partial' : 'missing',
      readme ? `${readme} (${readmeLines} lines)` : 'No README at the root',
    ),
  );
  const setup =
    readme &&
    /^#+\s*(install|setup|getting started|quick ?start|usage|run(ning)? locally|development)/im.test(
      texts[readme]!,
    );
  checks.push(
    check(
      'setup-docs',
      'Setup instructions',
      'documentation',
      setup ? 'pass' : 'missing',
      setup
        ? `${readme} has a setup section`
        : 'No install/usage section found',
    ),
  );
  const docs = matching(/^(docs?|documentation)\/.+\.(md|mdx|rst|txt)$/i);
  const architecture = matching(/(^|\/)architecture[^/]*\.(md|mdx|rst)$/i);
  checks.push(
    check(
      'architecture-docs',
      'Architecture & docs',
      'documentation',
      architecture.length || docs.length >= 3
        ? 'pass'
        : docs.length
          ? 'partial'
          : 'missing',
      architecture.length || docs.length
        ? list([...architecture, ...docs])
        : 'No docs/ folder or ARCHITECTURE file',
      0.5,
    ),
  );
  const license = matching(/^(license|licence|copying)(\.|$)/i);
  checks.push(
    check(
      'license',
      'Licence',
      'documentation',
      license.length ? 'pass' : 'missing',
      license[0] ?? 'No LICENSE file',
      0.5,
    ),
  );

  // Testing.
  const testFiles = matching(
    /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[a-z]+$|(^|\/)test_[^/]+\.py$|_test\.(go|py)$/i,
  );
  const runners = [
    ...depMatching(
      /^(vitest|jest|mocha|ava|uvu|pytest|@playwright\/test|cypress)$/,
    ),
    ...(codeLanguages.has('Rust') && testFiles.length ? ['cargo test'] : []),
    ...(files.some((file) => file.endsWith('_test.go')) ? ['go test'] : []),
    ...(matching(/(^|\/)(pytest\.ini|conftest\.py)$/).length ? ['pytest'] : []),
  ];
  const testScript = scriptFor(/^test$|vitest|jest|pytest|mocha/);
  checks.push(
    check(
      'tests',
      'Automated tests',
      'testing',
      testFiles.length >= 5 && (testScript || runners.length)
        ? 'pass'
        : testFiles.length
          ? 'partial'
          : 'missing',
      testFiles.length
        ? `${testFiles.length} test files${runners.length ? ` · ${list([...new Set(runners)])}` : ''}`
        : 'No test files found',
    ),
  );
  const frontend = frameworks.some((name) => FRONTEND.has(name));
  if (frontend) {
    const e2e = [
      ...depMatching(/^(@playwright\/test|playwright|cypress|webdriverio)$/),
      ...matching(/(^|\/)(playwright|cypress)\.config\.[a-z]+$/),
    ];
    checks.push(
      check(
        'e2e',
        'End-to-end tests',
        'testing',
        e2e.length ? 'pass' : 'missing',
        e2e.length ? list(e2e) : 'UI project without Playwright or Cypress',
        0.5,
      ),
    );
  }

  // Code quality.
  const lintConfigs = matching(
    /(^|\/)(\.?eslint[^/]*|biome\.jsonc?|\.?ruff\.toml|clippy\.toml|\.golangci\.ya?ml|\.rubocop\.yml|phpstan\.neon|\.pylintrc|\.flake8)$/i,
  );
  const lintTools = depMatching(
    /^(eslint|@biomejs\/biome|oxlint|ruff|pylint|flake8)$/,
  );
  const lintScript = scriptFor(
    /^lint|eslint|biome (check|lint)|ruff check|clippy/,
  );
  checks.push(
    check(
      'lint',
      'Linting',
      'quality',
      (lintConfigs.length || lintTools.length) && lintScript
        ? 'pass'
        : lintConfigs.length || lintTools.length
          ? 'partial'
          : 'missing',
      lintConfigs.length || lintTools.length
        ? `${list([...lintConfigs, ...lintTools])}${lintScript ? ` · script "${lintScript[0]}"` : ' · no lint script'}`
        : 'No linter configured',
    ),
  );
  const formatConfigs = [
    ...matching(
      /(^|\/)(\.prettierrc[^/]*|prettier\.config\.[a-z]+|rustfmt\.toml|\.rustfmt\.toml|\.clang-format|biome\.jsonc?|\.editorconfig|\.black)$/i,
    ),
    ...depMatching(/^(prettier|black|@biomejs\/biome)$/),
  ];
  checks.push(
    check(
      'format',
      'Formatting',
      'quality',
      formatConfigs.length ? 'pass' : 'missing',
      formatConfigs.length ? list(formatConfigs) : 'No formatter configured',
      0.5,
    ),
  );
  if (codeLanguages.has('TypeScript')) {
    const tsconfigs = Object.entries(texts).filter(([path]) =>
      /(^|\/)tsconfig[^/]*\.json$/.test(path),
    );
    const strict = tsconfigs.filter(([, text]) =>
      /"strict"\s*:\s*true/.test(text),
    );
    checks.push(
      check(
        'types',
        'Strict type checking',
        'quality',
        strict.length ? 'pass' : tsconfigs.length ? 'partial' : 'missing',
        strict.length
          ? `strict mode in ${list(strict.map(([path]) => path))}`
          : tsconfigs.length
            ? 'tsconfig without "strict": true'
            : 'TypeScript without a tsconfig',
      ),
    );
  } else if (codeLanguages.has('Python')) {
    const typed = [
      ...matching(
        /(^|\/)(mypy\.ini|\.mypy\.ini|pyrightconfig\.json|py\.typed)$/,
      ),
      ...depMatching(/^(mypy|pyright)$/),
      ...Object.entries(texts)
        .filter(
          ([path, text]) =>
            path.endsWith('pyproject.toml') &&
            /\[tool\.(mypy|pyright)\]/.test(text),
        )
        .map(([path]) => path),
    ];
    checks.push(
      check(
        'types',
        'Type checking',
        'quality',
        typed.length ? 'pass' : 'missing',
        typed.length ? list(typed) : 'No mypy or pyright configuration',
        0.5,
      ),
    );
  }

  // Automation.
  const workflows = Object.entries(texts).filter(([path]) =>
    /^(\.github\/workflows\/|\.gitlab-ci\.yml|azure-pipelines\.yml|\.circleci\/)/.test(
      path,
    ),
  );
  const ciText = workflows.map(([, text]) => text).join('\n');
  const ciRunsTests =
    /\b(test|vitest|jest|pytest|cargo test|go test|playwright)\b/i.test(ciText);
  const ciQuality =
    /\b(lint|typecheck|tsc|clippy|ruff|eslint|format:check|prettier --check|mypy)\b/i.test(
      ciText,
    );
  checks.push(
    check(
      'ci',
      'Continuous integration',
      'automation',
      workflows.length && ciRunsTests
        ? 'pass'
        : workflows.length
          ? 'partial'
          : 'missing',
      workflows.length
        ? `${list(workflows.map(([path]) => path))}${ciRunsTests ? ' · runs tests' : ' · does not run tests'}`
        : 'No CI workflow',
    ),
  );
  if (workflows.length)
    checks.push(
      check(
        'ci-quality',
        'CI quality gates',
        'automation',
        ciQuality ? 'pass' : 'missing',
        ciQuality
          ? 'CI runs lint or type checks'
          : 'CI runs no lint or type check',
        0.5,
      ),
    );
  const updates = matching(
    /^(\.github\/dependabot\.ya?ml|renovate\.json5?|\.github\/renovate\.json5?|\.renovaterc[^/]*)$/,
  );
  checks.push(
    check(
      'dependency-updates',
      'Dependency updates',
      'automation',
      updates.length ? 'pass' : 'missing',
      updates[0] ?? 'No Dependabot or Renovate',
      0.5,
    ),
  );

  // Delivery.
  const manifestFiles = matching(
    /^(package\.json|Cargo\.toml|pyproject\.toml|requirements[^/]*\.txt|Pipfile|go\.mod|composer\.json|Gemfile)$/,
  );
  if (deps.size > 0 || manifestFiles.length > 0)
    checks.push(
      check(
        'lockfile',
        'Reproducible installs',
        'delivery',
        manifests.packageManagers.length ? 'pass' : 'missing',
        manifests.packageManagers.length
          ? `lockfile: ${list(manifests.packageManagers)}`
          : `${list(manifestFiles) || 'Manifest'} without a lockfile`,
        0.5,
      ),
    );
  const container = matching(
    /(^|\/)(dockerfile[^/]*|docker-compose[^/]*\.ya?ml|compose\.ya?ml|\.devcontainer\/[^/]+)$/i,
  );
  checks.push(
    check(
      'container',
      'Container setup',
      'delivery',
      container.length ? 'pass' : 'missing',
      container.length ? list(container) : 'No Dockerfile or devcontainer',
      0.5,
    ),
  );
  const deploy = [
    ...matching(
      /^(vercel\.json|netlify\.toml|fly\.toml|render\.yaml|app\.yaml|Procfile|wrangler\.toml|k8s\/.+|helm\/.+|terraform\/.+|.*\.tf)$/i,
    ),
    ...(scriptFor(/^deploy|^release|^publish/)
      ? [`script "${scriptFor(/^deploy|^release|^publish/)![0]}"`]
      : []),
    ...(/\b(deploy|publish|release)\b/i.test(ciText) ? ['CI deploy step'] : []),
  ];
  checks.push(
    check(
      'deploy',
      'Deployment',
      'delivery',
      deploy.length ? 'pass' : 'missing',
      deploy.length ? list(deploy) : 'No deployment configuration',
      0.5,
    ),
  );
  const changelog = matching(/^changelog(\.|$)/i);
  checks.push(
    check(
      'releases',
      'Releases',
      'delivery',
      facts.tags > 0 || changelog.length ? 'pass' : 'missing',
      facts.tags > 0
        ? `${facts.tags} tags${changelog.length ? ` · ${changelog[0]}` : ''}`
        : (changelog[0] ?? 'No tags or CHANGELOG'),
      0.5,
    ),
  );

  // Maintenance.
  const debt = facts.todos.todo + facts.todos.fixme;
  const perHundred = (debt / Math.max(1, files.length)) * 100;
  checks.push(
    check(
      'todo-debt',
      'TODO/FIXME debt',
      'maintenance',
      perHundred < 5 ? 'pass' : perHundred < 15 ? 'partial' : 'missing',
      `${facts.todos.todo} TODO · ${facts.todos.fixme} FIXME in ${files.length} files`,
      0.5,
    ),
  );
  checks.push(
    check(
      'gitignore',
      '.gitignore',
      'maintenance',
      files.includes('.gitignore') ? 'pass' : 'missing',
      files.includes('.gitignore') ? '.gitignore' : 'No .gitignore',
      0.5,
    ),
  );

  const value = { pass: 1, partial: 0.5, missing: 0 } as const;
  const weights = checks.reduce((sum, item) => sum + item.weight, 0);
  const score = Math.round(
    (checks.reduce((sum, item) => sum + item.weight * value[item.status], 0) /
      weights) *
      100,
  );
  const status = (id: string) => checks.find((item) => item.id === id)?.status;

  const commits = facts.commits;
  const last30Days = commits.recent.filter(
    (time) => now - time <= 30 * DAY,
  ).length;
  const codeFiles = files.filter((file) => {
    const language = LANGUAGES[file.split('.').pop()?.toLowerCase() ?? ''];
    return language && language !== 'Markdown';
  }).length;
  // Content decides "empty"; history only caps how far a repository can rise, so a
  // large first commit is developing, not an empty plot, but not yet established.
  const maturity: Maturity =
    commits.total === 0 || files.length <= 2 || codeFiles + docs.length === 0
      ? 'empty'
      : score >= 75 &&
          commits.total >= 10 &&
          status('tests') === 'pass' &&
          status('ci') === 'pass' &&
          ['deploy', 'container', 'releases'].some(
            (id) => status(id) === 'pass',
          )
        ? 'production'
        : score >= 55 && status('tests') !== 'missing' && commits.total >= 10
          ? 'established'
          : score >= 30 && codeFiles >= 5
            ? 'developing'
            : 'prototype';
  const age = commits.lastCommitAt ? now - commits.lastCommitAt : Infinity;
  const activity: ActivityLevel =
    age <= 7 * DAY
      ? 'active'
      : age <= 30 * DAY
        ? 'recent'
        : age <= 180 * DAY
          ? 'quiet'
          : 'dormant';

  const folders = new Map<string, number>();
  for (const file of files) {
    const slash = file.indexOf('/');
    const name = slash < 0 ? '(root files)' : `${file.slice(0, slash)}/`;
    folders.set(name, (folders.get(name) ?? 0) + 1);
  }

  return {
    maturity,
    activity,
    score,
    sizeBand:
      files.length < 30
        ? 1
        : files.length < 200
          ? 2
          : files.length < 1000
            ? 3
            : files.length < 5000
              ? 4
              : 5,
    trackedBytes: facts.trackedBytes,
    fileCount: files.length,
    languages,
    frameworks,
    packageManagers: manifests.packageManagers,
    scripts: scriptNames.slice(0, 30),
    dependencies: { runtime: manifests.runtime.size, dev: manifests.dev.size },
    folders: [...folders]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([name, count]) => ({ name, files: count })),
    commits: {
      total: commits.total,
      last30Days,
      last90Days: commits.recent.length,
      authors90Days: commits.authors90Days,
      ...(commits.lastCommitAt && { lastCommitAt: commits.lastCommitAt }),
      ...(commits.firstCommitAt && { firstCommitAt: commits.firstCommitAt }),
    },
    todos: facts.todos,
    checks,
  };
}

export const tierForMaturity: Record<Maturity, number> = {
  empty: 0,
  prototype: 1,
  developing: 2,
  established: 3,
  production: 4,
};
