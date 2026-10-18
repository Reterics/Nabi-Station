import { describe, expect, it } from 'vitest';
import {
  activityLevels,
  archetypes,
  maturities,
  needsAttention,
  worldSchema,
} from '../../packages/protocol/src/index';
import {
  createDemoWorld,
  demoRecommendations,
} from '../../apps/web/src/demo/world';

describe('demo world contract', () => {
  it('is deterministic, complete, and explicitly marked as demo data', () => {
    const world = createDemoWorld();
    expect(world).toEqual(createDemoWorld());
    expect(world.mode).toBe('demo');
    expect(world.repos).toHaveLength(15);
    expect(world.districts.map((district) => district.name)).toEqual([
      'Acme product',
      'Labs',
    ]);
    expect(
      world.agents.filter(needsAttention).map((agent) => agent.id),
    ).toEqual([
      'cursor-nabi',
      'claude-checkout',
      'codex-gateway',
      'claude-recommender',
    ]);
  });
  it('shows every building style, maturity, activity and agent kind for presentations', () => {
    const world = createDemoWorld();
    const all = <T>(values: T[]) => [...new Set(values)].sort();
    expect(all(world.repos.map((repo) => repo.building.archetype))).toEqual(
      [...archetypes].sort(),
    );
    expect(all(world.repos.map((repo) => repo.analysis!.maturity))).toEqual(
      [...maturities].sort(),
    );
    expect(all(world.repos.map((repo) => repo.analysis!.activity))).toEqual(
      [...activityLevels].sort(),
    );
    expect(all(world.agents.map((agent) => agent.kind))).toEqual([
      'claude-code',
      'codex',
      'cursor',
    ]);
    // Tiers follow the rule-based maturity, as they do for live data.
    for (const repo of world.repos)
      expect(repo.building.tier).toBe(
        maturities.indexOf(repo.analysis!.maturity),
      );
    for (const repoId of Object.keys(demoRecommendations))
      expect(world.repos.map((repo) => repo.id)).toContain(repoId);
  });
  it('rejects dangling agent, plot, and district references', () => {
    const world = createDemoWorld();
    world.agents[0]!.repoId = 'missing';
    expect(worldSchema.safeParse(world).success).toBe(false);
    const missingRepo = createDemoWorld();
    missingRepo.repos.pop();
    expect(worldSchema.safeParse(missingRepo).success).toBe(false);
    const missingDistrict = createDemoWorld();
    missingDistrict.repos[0]!.districtId = 'missing';
    expect(worldSchema.safeParse(missingDistrict).success).toBe(false);
  });
  it('rejects duplicate entities and invalid tier values', () => {
    const world = createDemoWorld();
    world.repos.push(world.repos[0]!);
    expect(worldSchema.safeParse(world).success).toBe(false);
    const badTier = createDemoWorld();
    badTier.repos[0]!.building.tier = 5;
    expect(worldSchema.safeParse(badTier).success).toBe(false);
  });
});
