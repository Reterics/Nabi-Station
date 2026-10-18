import type { World } from '@nabi/protocol';

export interface DistrictArea {
  id: string;
  centerX: number;
  centerZ: number;
  width: number;
  depth: number;
  /** Plot centres along each axis, used to run roads between rows and columns. */
  columns: number[];
  rows: number[];
}

export interface CityLayout {
  districts: DistrictArea[];
  /** Ground extent of the whole city. */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  agents: Map<string, [number, number]>;
}

/** Ground margin around plot centres; six plots give the original 16.5 × 13 board. */
const MARGIN = { x: 3.75, z: 3.7 };
/** Where residents stand around their plot's entrance (relative to the plot centre). */
const SLOTS: [number, number][] = [
  [0.85, 1.5],
  [-0.85, 1.5],
  [1.45, 0.6],
  [-1.45, 0.6],
  [0, 1.7],
  [1.5, -0.6],
];

const unique = (values: number[]) =>
  [...new Set(values.map((value) => Math.round(value * 1000) / 1000))].sort(
    (a, b) => a - b,
  );

export function cityLayout(world: World): CityLayout {
  const districts = world.districts.map((district) => {
    const xs = district.plots.map((plot) => plot.position.x);
    const zs = district.plots.map((plot) => plot.position.z);
    const [minX, maxX] = xs.length
      ? [Math.min(...xs), Math.max(...xs)]
      : [0, 0];
    const [minZ, maxZ] = zs.length
      ? [Math.min(...zs), Math.max(...zs)]
      : [0, 0];
    return {
      id: district.id,
      centerX: (minX + maxX) / 2,
      centerZ: (minZ + maxZ) / 2,
      width: maxX - minX + MARGIN.x * 2,
      depth: maxZ - minZ + MARGIN.z * 2,
      columns: unique(xs),
      rows: unique(zs),
    };
  });
  const edges = districts.length
    ? districts
    : [{ centerX: 0, centerZ: 0, width: MARGIN.x * 2, depth: MARGIN.z * 2 }];
  const bounds = {
    minX: Math.min(...edges.map((d) => d.centerX - d.width / 2)),
    maxX: Math.max(...edges.map((d) => d.centerX + d.width / 2)),
    minZ: Math.min(...edges.map((d) => d.centerZ - d.depth / 2)),
    maxZ: Math.max(...edges.map((d) => d.centerZ + d.depth / 2)),
  };

  const plots = new Map(
    world.districts
      .flatMap((district) => district.plots)
      .map((plot) => [plot.repoId, plot.position]),
  );
  const occupancy = new Map<string, number>();
  const agents = new Map<string, [number, number]>();
  let outskirts = 0;
  for (const agent of world.agents) {
    const plot = agent.repoId ? plots.get(agent.repoId) : undefined;
    if (plot) {
      const index = occupancy.get(agent.repoId!) ?? 0;
      occupancy.set(agent.repoId!, index + 1);
      const [dx, dz] = SLOTS[index % SLOTS.length]!;
      agents.set(agent.id, [plot.x + dx, plot.z + dz]);
    } else {
      // Sessions outside every repository wait along the front edge of the city.
      agents.set(agent.id, [
        bounds.minX + 1 + outskirts++ * 0.9,
        bounds.maxZ - 0.8,
      ]);
    }
  }
  return { districts, bounds, agents };
}
