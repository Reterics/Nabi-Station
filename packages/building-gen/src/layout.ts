/** Plot spacing in world units (X across columns, Z across rows). */
export const PLOT_SPACING = { x: 4.5, z: 5.6 } as const;
/** Gap between neighbouring districts, in addition to normal plot spacing. */
const DISTRICT_GAP = 3;

export interface PlotPosition {
  x: number;
  z: number;
}

/** Columns for a near-square grid, never fewer than three (the demo layout). */
export function gridColumns(count: number): number {
  return Math.max(3, Math.ceil(Math.sqrt(count)));
}

/**
 * Deterministic district layouts: each district is a centred grid, and districts
 * sit side by side along X. Six plots in one district give the demo's hand-placed
 * positions (x ∈ {-4.5, 0, 4.5}, z ∈ {-2.8, 2.8}).
 */
export function layoutDistricts(counts: readonly number[]): PlotPosition[][] {
  const widths = counts.map(
    (count) => gridColumns(count) * PLOT_SPACING.x + DISTRICT_GAP,
  );
  const total = widths.reduce((sum, width) => sum + width, 0);
  let left = -total / 2;
  return counts.map((count, index) => {
    const columns = gridColumns(count);
    const rows = Math.max(1, Math.ceil(count / columns));
    const centre = left + widths[index]! / 2;
    left += widths[index]!;
    return Array.from({ length: count }, (_, plot) => ({
      x: centre + ((plot % columns) - (columns - 1) / 2) * PLOT_SPACING.x,
      z: (Math.floor(plot / columns) - (rows - 1) / 2) * PLOT_SPACING.z,
    }));
  });
}
