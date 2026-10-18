import { describe, expect, it } from 'vitest';
import { archetypes, type BuildingSpec } from '@nabi/protocol';
import { generateBuilding, seedFromString } from './index';

const spec: BuildingSpec = {
  archetype: 'office',
  tier: 3,
  seed: seedFromString('nabi-station'),
  modules: ['tests', 'ci'],
  footprint: 2,
};

describe('building generation', () => {
  it('is deterministic and does not mutate its inputs', () => {
    const original = structuredClone(spec);
    expect(generateBuilding(spec)).toEqual(
      generateBuilding(structuredClone(spec)),
    );
    expect(spec).toEqual(original);
    expect(seedFromString('nabi-station')).not.toBe(
      seedFromString('model-lab'),
    );
  });
  it('produces finite geometry with positive dimensions and unique part IDs at every tier', () => {
    for (const archetype of archetypes)
      for (const tier of [0, 1, 2, 3, 4]) {
        const parts = generateBuilding({ ...spec, archetype, tier });
        expect(new Set(parts.map((part) => part.id)).size).toBe(parts.length);
        for (const part of parts) {
          expect(part.position.every(Number.isFinite)).toBe(true);
          expect(
            part.size.every(
              (dimension) => Number.isFinite(dimension) && dimension > 0,
            ),
          ).toBe(true);
        }
        expect(parts.some((part) => part.id === 'body')).toBe(tier > 0);
      }
  });
  it('gives every style its own silhouette and seeded variations', () => {
    const signature = (overrides: Partial<BuildingSpec>) =>
      generateBuilding({ ...spec, modules: [], ...overrides })
        .map((part) => `${part.id}:${part.shape}`)
        .sort()
        .join(',');
    const styles = archetypes.map((archetype) => signature({ archetype }));
    expect(new Set(styles).size).toBe(archetypes.length);
    const colours = (seed: number) =>
      generateBuilding({ ...spec, seed })
        .map((part) => part.color)
        .join();
    const variants = new Set(
      ['a', 'b', 'c', 'd', 'e', 'f'].map((name) =>
        colours(seedFromString(name)),
      ),
    );
    expect(variants.size).toBeGreaterThan(2);
  });
  it('shows maturity as construction state and activity as lit windows', () => {
    const ids = (overrides: Partial<BuildingSpec>) =>
      generateBuilding({ ...spec, ...overrides }).map((part) => part.id);
    const prototype = ids({ tier: 1, maturity: 'prototype' });
    expect(prototype).toContain('crane-mast');
    expect(prototype).toContain('scaffold-pole--1-1');
    expect(prototype).not.toContain('roof');
    const developing = ids({ tier: 2, maturity: 'developing' });
    expect(developing).toContain('scaffold-pole-1-1');
    expect(developing).not.toContain('scaffold-pole--1-1');
    expect(developing).not.toContain('crane-mast');
    const production = ids({ tier: 4, maturity: 'production' });
    expect(production).toContain('crown');
    expect(production.some((id) => id.startsWith('scaffold'))).toBe(false);

    const windows = (activity: BuildingSpec['activity']) =>
      generateBuilding({ ...spec, activity }).filter((part) =>
        part.id.startsWith('window'),
      );
    expect(windows('active').every((part) => part.emissive)).toBe(true);
    expect(windows('dormant').some((part) => part.emissive)).toBe(false);
    const quiet = windows('quiet').filter((part) => part.emissive).length;
    expect(quiet).toBeGreaterThan(0);
    expect(quiet).toBeLessThan(windows('quiet').length);
  });
  it('adds and removes capability modules independently', () => {
    const withoutModules = generateBuilding({ ...spec, modules: [] }).map(
      (part) => part.id,
    );
    expect(withoutModules).not.toContain('antenna');
    expect(withoutModules).not.toContain('frame-1');
    const withModules = generateBuilding(spec).map((part) => part.id);
    expect(withModules).toContain('antenna');
    expect(withModules).toContain('frame-1');
  });
});
