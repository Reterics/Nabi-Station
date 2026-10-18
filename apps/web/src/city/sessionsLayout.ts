import type { AgentNpc, Repo, World } from '@nabi/protocol';

/** One project with live sessions: its building, its agents, and their helpers. */
export interface SessionSite {
  id: string;
  title: string;
  /** Folder for sessions outside every scanned repository. */
  path: string;
  repo?: Repo;
  agents: AgentNpc[];
  centerX: number;
  centerZ: number;
  /** Stage size along world X (`width`) and world Z (`depth`). */
  width: number;
  depth: number;
}

export interface SessionsLayout {
  sites: SessionSite[];
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  agents: Map<string, [number, number]>;
  /** Keyed by `${agentId}/${helperId}`. */
  helpers: Map<string, [number, number]>;
  /** Building position per site id. */
  buildings: Map<string, [number, number]>;
  /** Extent along world X and Z, and the world centre of that extent. */
  screen: { width: number; depth: number; centerX: number; centerZ: number };
}

/**
 * Stage axes are the city axes: `u` is world X, `v` is world Z. The shared
 * isometric camera then shows the same corner it shows in the workspace.
 */
export const toWorld = (u: number, v: number): [number, number] => [u, v];

/** Width of one agent's slot on its stage; grows with its helpers. */
const AGENT_SLOT = 5.2;
const SITE_DEPTH = 7.6;
const SITE_GAP = 0.8;
/** Rows also leave room for the next row's buildings, which stand at its back. */
const ROW_GAP = 2.4;
/** Helpers stand in two staggered rows in front of their agent. */
const HELPER_STEP = 1.05;
const HELPER_ROWS = [1.35, 2.25];
/** The building stands at the back of the stage; agents in front of it. */
const BUILDING_V = -2.3;
const AGENT_V = 0.1;
/** Canvas width ÷ height the grid is shaped for; the ground is squashed by sin 35.26°. */
const ASPECT = 1.25;
const SQUASH = 0.58;

export const helperKey = (agentId: string, helperId: string) =>
  `${agentId}/${helperId}`;

const folderName = (path: string) =>
  path.split('/').filter(Boolean).at(-1) ?? path;

const slotWidth = (agent: AgentNpc) =>
  Math.max(AGENT_SLOT, (agent.helpers?.length ?? 0) * HELPER_STEP + 1.6);

/**
 * Stage offsets (u along X, v along Z) of `count` helpers relative to their
 * agent: a row in front of it, alternating between two depths so neighbouring labels
 * do not collide, and leaving the space above its head to the speech bubble.
 */
export function helperOffsets(count: number): [number, number][] {
  return Array.from({ length: count }, (_, index) => [
    (index - (count - 1) / 2) * HELPER_STEP,
    HELPER_ROWS[index % 2]!,
  ]);
}

/** Wraps stages into rows of at most `columns`; returns rows and the total extent. */
function arrange(sites: SessionSite[], columns: number) {
  const rows: SessionSite[][] = [];
  sites.forEach((site, index) =>
    (rows[Math.floor(index / columns)] ??= []).push(site),
  );
  const widths = rows.map(
    (row) =>
      row.reduce((sum, site) => sum + site.width, 0) +
      SITE_GAP * (row.length - 1),
  );
  const width = Math.max(0, ...widths);
  const depth = rows.length * SITE_DEPTH + (rows.length - 1) * ROW_GAP;
  return { rows, widths, width, depth };
}

export function sessionsLayout(world: World): SessionsLayout {
  const repos = new Map(world.repos.map((repo) => [repo.id, repo]));
  const groups = new Map<string, SessionSite>();
  for (const agent of world.agents) {
    if (agent.activity === 'ended') continue;
    const repo = agent.repoId ? repos.get(agent.repoId) : undefined;
    const id = repo ? repo.id : `folder:${agent.cwd ?? agent.id}`;
    const site = groups.get(id) ?? {
      id,
      title: repo?.name ?? folderName(agent.cwd ?? 'Unknown folder'),
      path: repo?.path ?? agent.cwd ?? '',
      repo,
      agents: [],
      centerX: 0,
      centerZ: 0,
      width: 0,
      depth: SITE_DEPTH,
    };
    site.agents.push(agent);
    groups.set(id, site);
  }
  // Stable order: stages do not jump around as sessions change state.
  const sites = [...groups.values()].sort(
    (a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id),
  );
  for (const site of sites) {
    site.agents.sort((a, b) => a.id.localeCompare(b.id));
    site.width = Math.max(
      SITE_DEPTH,
      site.agents.reduce((sum, agent) => sum + slotWidth(agent), 0) + 1.2,
    );
  }

  // The column count that lets the camera zoom in furthest. On-screen size
  // follows the ground diagonal, the same projection as the city.
  let best = arrange(sites, Math.max(1, sites.length));
  let bestScale = 0;
  for (let columns = 1; columns <= sites.length; columns++) {
    const candidate = arrange(sites, columns);
    const span = (candidate.width + candidate.depth) / Math.SQRT2;
    const scale = Math.min(ASPECT / span, 1 / (span * SQUASH + 3));
    if (scale > bestScale) [best, bestScale] = [candidate, scale];
  }

  const agents = new Map<string, [number, number]>();
  const helpers = new Map<string, [number, number]>();
  const buildings = new Map<string, [number, number]>();
  best.rows.forEach((row, rowIndex) => {
    let u = -best.widths[rowIndex]! / 2;
    const v =
      -best.depth / 2 + SITE_DEPTH / 2 + rowIndex * (SITE_DEPTH + ROW_GAP);
    for (const site of row) {
      const centerU = u + site.width / 2;
      [site.centerX, site.centerZ] = toWorld(centerU, v);
      buildings.set(site.id, toWorld(centerU, v + BUILDING_V));
      const slots = site.agents.map(slotWidth);
      let slotU = centerU - slots.reduce((sum, width) => sum + width, 0) / 2;
      site.agents.forEach((agent, index) => {
        const agentU = slotU + slots[index]! / 2;
        slotU += slots[index]!;
        agents.set(agent.id, toWorld(agentU, v + AGENT_V));
        const list = agent.helpers ?? [];
        helperOffsets(list.length).forEach(([du, dv], helperIndex) => {
          helpers.set(
            helperKey(agent.id, list[helperIndex]!.id),
            toWorld(agentU + du, v + AGENT_V + dv),
          );
        });
      });
      u += site.width + SITE_GAP;
    }
  });

  const corners = sites.flatMap((site) =>
    [-1, 1].flatMap((su) =>
      [-1, 1].map((sv) => {
        const [x, z] = toWorld((su * site.width) / 2, (sv * site.depth) / 2);
        return [site.centerX + x, site.centerZ + z] as const;
      }),
    ),
  );
  const bounds = corners.length
    ? {
        minX: Math.min(...corners.map(([x]) => x)),
        maxX: Math.max(...corners.map(([x]) => x)),
        minZ: Math.min(...corners.map(([, z]) => z)),
        maxZ: Math.max(...corners.map(([, z]) => z)),
      }
    : { minX: -4, maxX: 4, minZ: -4, maxZ: 4 };
  return {
    sites,
    bounds,
    agents,
    helpers,
    buildings,
    screen: {
      width: sites.length ? best.width : 10,
      depth: sites.length ? best.depth : 10,
      centerX: 0,
      centerZ: 0,
    },
  };
}
