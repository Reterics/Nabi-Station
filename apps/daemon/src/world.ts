import { basename } from 'node:path';
import { layoutDistricts, seedFromString } from '@nabi/building-gen';
import { worldSchema, type World } from '@nabi/protocol';
import type { AgentObservation } from './agents';
import { displayPath, isWithin, pathKey } from './paths';
import { buildingFromSignals, type RepoSignals } from './workspace/analyze';
import type { GitState } from './workspace/git';
import type { DiscoveredRepo } from './workspace/scan';

export interface RepoSnapshot {
  repo: DiscoveredRepo;
  signals: RepoSignals;
  git: GitState;
}

const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'repo';

/** Stable across runs and unique across roots: names repeat, paths do not. */
export const repoId = (path: string) =>
  `${slug(basename(path))}-${seedFromString(pathKey(path)).toString(36).slice(0, 6)}`;
const districtId = (root: string) =>
  `district-${seedFromString(pathKey(root)).toString(36)}`;

/** The innermost repository containing `cwd`, or null (district root, home folder…). */
export function repoForPath(
  cwd: string,
  repoPaths: readonly string[],
): string | null {
  const key = pathKey(cwd);
  let best: string | null = null;
  for (const path of repoPaths) {
    const candidate = pathKey(path);
    if (
      isWithin(key, candidate) &&
      (!best || candidate.length > pathKey(best).length)
    )
      best = path;
  }
  return best;
}

export function buildWorld(input: {
  roots: string[];
  repos: RepoSnapshot[];
  agents: AgentObservation[];
  version: number;
  now: number;
}): World {
  const roots = [
    ...new Map(
      input.roots.map((root) => [pathKey(root), displayPath(root)]),
    ).values(),
  ];
  // A repository found under two overlapping roots belongs to the innermost one.
  const unique = new Map<string, RepoSnapshot>();
  for (const snapshot of input.repos)
    unique.set(pathKey(snapshot.repo.path), snapshot);
  const byDistrict = roots.map((root) =>
    [...unique.values()]
      .filter((snapshot) => {
        const owner = roots
          .filter((candidate) =>
            isWithin(pathKey(snapshot.repo.path), pathKey(candidate)),
          )
          .sort((a, b) => b.length - a.length)[0];
        return owner !== undefined && pathKey(owner) === pathKey(root);
      })
      .sort((a, b) => a.repo.path.localeCompare(b.repo.path)),
  );
  const positions = layoutDistricts(
    byDistrict.map((snapshots) => snapshots.length),
  );
  const repoPaths = byDistrict.flat().map((snapshot) => snapshot.repo.path);
  // Two observations of one session (e.g. a reused session id) would fail validation;
  // keep the most recently active one.
  const agents = new Map<string, AgentObservation>();
  for (const agent of input.agents) {
    const seen = agents.get(agent.id);
    if (!seen || (agent.updatedAt ?? 0) > (seen.updatedAt ?? 0))
      agents.set(agent.id, agent);
  }

  return worldSchema.parse({
    version: input.version,
    mode: 'live',
    updatedAt: input.now,
    districts: roots.map((root, index) => ({
      id: districtId(root),
      name: basename(root) || root,
      rootPath: root,
      plots: byDistrict[index]!.map((snapshot, plot) => ({
        id: `plot-${repoId(snapshot.repo.path)}`,
        repoId: repoId(snapshot.repo.path),
        position: positions[index]![plot],
      })),
    })),
    repos: byDistrict.flatMap((snapshots, index) =>
      snapshots.map(({ repo, signals, git }) => ({
        id: repoId(repo.path),
        name: repo.name,
        path: repo.path,
        districtId: districtId(roots[index]!),
        language: signals.language,
        description: `${signals.commitCount} commits · ${signals.fileCount} tracked files`,
        building: buildingFromSignals(
          signals,
          seedFromString(pathKey(repo.path)),
        ),
        git,
      })),
    ),
    agents: [...agents.values()].map((agent) => {
      const path = repoForPath(agent.cwd, repoPaths);
      return { ...agent, repoId: path ? repoId(path) : null };
    }),
  });
}
