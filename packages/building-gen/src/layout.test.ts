import { describe, expect, it } from 'vitest';
import { layoutDistricts, PLOT_SPACING } from './layout';

describe('district layout', () => {
  it('reproduces the demo grid for six plots', () => {
    expect(layoutDistricts([6])[0]).toEqual([
      { x: -4.5, z: -2.8 },
      { x: 0, z: -2.8 },
      { x: 4.5, z: -2.8 },
      { x: -4.5, z: 2.8 },
      { x: 0, z: 2.8 },
      { x: 4.5, z: 2.8 },
    ]);
  });
  it('never overlaps plots within or across districts', () => {
    const plots = layoutDistricts([1, 30, 7]).flat();
    expect(plots).toHaveLength(38);
    for (const [index, a] of plots.entries())
      for (const b of plots.slice(index + 1))
        expect(
          Math.abs(a.x - b.x) >= PLOT_SPACING.x - 1e-9 ||
            Math.abs(a.z - b.z) >= PLOT_SPACING.z - 1e-9,
        ).toBe(true);
  });
  it('is deterministic and handles empty districts', () => {
    expect(layoutDistricts([4, 0, 2])).toEqual(layoutDistricts([4, 0, 2]));
    expect(layoutDistricts([0])).toEqual([[]]);
  });
});
