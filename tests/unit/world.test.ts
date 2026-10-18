import { describe, expect, it } from 'vitest';
import { worldSchema, needsAttention } from '../../packages/protocol/src/index';
import { createDemoWorld } from '../../apps/web/src/demo/world';

describe('demo world contract', () => {
  it('is deterministic, complete, and explicitly marked as demo data', () => {
    const world = createDemoWorld();
    expect(world).toEqual(createDemoWorld());
    expect(world.mode).toBe('demo');
    expect(world.repos).toHaveLength(6);
    expect(
      world.agents.filter(needsAttention).map((agent) => agent.id),
    ).toEqual(['claude-1']);
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
