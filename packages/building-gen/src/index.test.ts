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
