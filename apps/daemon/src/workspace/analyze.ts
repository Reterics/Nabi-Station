import type { BuildingSpec } from '@nabi/protocol';
import { git } from './git';

export interface RepoSignals {
  language: string;
  fileCount: number;
  commitCount: number;
  readme: boolean;
  docs: boolean;
  tests: boolean;
  lint: boolean;
  format: boolean;
  ci: boolean;
  container: boolean;
  deploy: boolean;
}

const LANGUAGES: Record<string, string> = {
  ts: 'TypeScript',
  tsx: 'TypeScript',
  mts: 'TypeScript',
  cts: 'TypeScript',
  js: 'JavaScript',
  jsx: 'JavaScript',
  mjs: 'JavaScript',
  cjs: 'JavaScript',
  vue: 'JavaScript',
  svelte: 'JavaScript',
  py: 'Python',
  ipynb: 'Python',
  rs: 'Rust',
  go: 'Go',
  c: 'C',
  h: 'C',
  cc: 'C++',
  cpp: 'C++',
  hpp: 'C++',
  cs: 'C#',
  java: 'Java',
  kt: 'Kotlin',
  swift: 'Swift',
  php: 'PHP',
  rb: 'Ruby',
  md: 'Markdown',
  mdx: 'Markdown',
  rst: 'Markdown',
};

const has = (files: string[], pattern: RegExp) =>
  files.some((file) => pattern.test(file));

/** Pure: repository signals from its tracked paths (forward slashes, repo-relative). */
export function signalsFromFiles(
  files: string[],
  commitCount: number,
): RepoSignals {
  const counts = new Map<string, number>();
  for (const file of files) {
    if (/(^|\/)(vendor|third_party|node_modules)\//.test(file)) continue;
    const language = LANGUAGES[file.split('.').pop()?.toLowerCase() ?? ''];
    if (language) counts.set(language, (counts.get(language) ?? 0) + 1);
  }
  const ranked = [...counts].sort((a, b) => b[1] - a[1]);
  // Documentation only wins when the repository has no code at all.
  const code = ranked.find(([language]) => language !== 'Markdown');
  return {
    language: code?.[0] ?? ranked[0]?.[0] ?? 'Unknown',
    fileCount: files.length,
    commitCount,
    readme: has(files, /^readme(\.|$)/i),
    docs: has(files, /^(docs?|documentation)\//i),
    tests: has(
      files,
      /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[a-z]+$|(^|\/)test_[^/]+\.py$|_test\.(go|py)$/i,
    ),
    lint: has(
      files,
      /(^|\/)(\.?eslint[^/]*|biome\.jsonc?|\.ruff\.toml|ruff\.toml|clippy\.toml|\.golangci\.ya?ml|\.rubocop\.yml|phpstan\.neon)$/i,
    ),
    format: has(
      files,
      /(^|\/)(\.prettierrc[^/]*|prettier\.config\.[a-z]+|rustfmt\.toml|\.rustfmt\.toml|\.clang-format|biome\.jsonc?|\.editorconfig)$/i,
    ),
    ci: has(
      files,
      /^(\.github\/workflows\/|\.gitlab-ci\.yml$|\.circleci\/|azure-pipelines\.yml$)/i,
    ),
    container: has(
      files,
      /(^|\/)(dockerfile[^/]*|docker-compose[^/]*\.ya?ml|compose\.ya?ml|\.devcontainer\/)/i,
    ),
    deploy: has(
      files,
      /^(vercel\.json|netlify\.toml|fly\.toml|render\.yaml|app\.yaml|Procfile|k8s\/|helm\/|terraform\/|.*\.tf$)/i,
    ),
  };
}

const ARCHETYPES: Record<string, BuildingSpec['archetype']> = {
  TypeScript: 'office',
  JavaScript: 'office',
  Python: 'laboratory',
  Rust: 'factory',
  Go: 'factory',
  C: 'factory',
  'C++': 'factory',
  'C#': 'tower',
  Java: 'tower',
  Kotlin: 'tower',
  Swift: 'tower',
  PHP: 'townhouse',
  Ruby: 'townhouse',
  Markdown: 'library',
};

/** Capabilities that raise a repository's tier, in the order the panel suggests them. */
export const TIER_CAPABILITIES = [
  'readme',
  'tests',
  'lint',
  'format',
  'ci',
  'docs',
  'container',
  'deploy',
] as const;

/**
 * Pure and deterministic (plan §12). Tier 0 is an empty plot (≤ 1 commit); otherwise
 * each capability is a point: 0–1 → 1, 2–3 → 2, 4–5 → 3, 6+ → 4.
 */
export function buildingFromSignals(
  signals: RepoSignals,
  seed: number,
): BuildingSpec {
  const points = TIER_CAPABILITIES.filter(
    (capability) => signals[capability],
  ).length;
  const tier =
    signals.commitCount <= 1 ? 0 : Math.min(4, 1 + Math.floor(points / 2));
  const modules: BuildingSpec['modules'] = [];
  if (signals.tests) modules.push('tests');
  if (signals.ci) modules.push('ci');
  if (signals.docs || signals.readme) modules.push('docs');
  if (signals.container) modules.push('container');
  if (signals.deploy) modules.push('deploy');
  return {
    archetype: ARCHETYPES[signals.language] ?? 'office',
    tier,
    seed,
    modules,
    footprint: signals.fileCount < 200 ? 1 : signals.fileCount < 2000 ? 2 : 3,
  };
}

const MAX_FILES = 50_000;

export async function analyzeRepo(path: string): Promise<RepoSignals> {
  const [files, commits] = await Promise.all([
    git(path, ['ls-files', '-z']).then(
      (output) => output.split('\0').filter(Boolean).slice(0, MAX_FILES),
      () => [],
    ),
    git(path, ['rev-list', '--count', 'HEAD']).then(
      (output) => Number(output.trim()) || 0,
      () => 0, // No commits yet.
    ),
  ]);
  return signalsFromFiles(files, commits);
}
