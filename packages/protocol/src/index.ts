import { z } from 'zod';

export const archetypes = [
  'office',
  'laboratory',
  'factory',
  'tower',
  'townhouse',
  'library',
] as const;
export const characterKinds = ['claude-code', 'codex', 'generic'] as const;
export const animationClips = [
  'idle',
  'think',
  'wave',
  'failed',
  'celebrate',
  'walk',
  'run',
  'type',
  'read',
  'operate',
] as const;
export const activities = [
  'working',
  'reading',
  'editing',
  'running-tool',
  'waiting-input',
  'waiting-permission',
  'idle',
  'failed',
  'ended',
] as const;
export type AnimationClip = (typeof animationClips)[number];
export type CharacterKind = (typeof characterKinds)[number];
export type AgentActivity = (typeof activities)[number];

export const clipForActivity: Record<AgentActivity, AnimationClip> = {
  working: 'think',
  reading: 'read',
  editing: 'type',
  'running-tool': 'operate',
  'waiting-input': 'wave',
  'waiting-permission': 'wave',
  idle: 'idle',
  failed: 'failed',
  ended: 'idle',
};

export const buildingSchema = z.object({
  archetype: z.enum(archetypes),
  tier: z.number().int().min(0).max(4),
  seed: z.number().int().nonnegative(),
  modules: z.array(z.enum(['tests', 'ci', 'docs', 'container', 'deploy'])),
  footprint: z.number().int().min(1).max(3),
});
export type BuildingSpec = z.infer<typeof buildingSchema>;

const pointSchema = z.object({
  x: z.number().finite(),
  z: z.number().finite(),
});
export const repoSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  path: z.string(),
  districtId: z.string(),
  language: z.string(),
  description: z.string(),
  building: buildingSchema,
  git: z.object({
    branch: z.string(),
    modified: z.number().int().nonnegative(),
    untracked: z.number().int().nonnegative(),
    ahead: z.number().int().nonnegative(),
    behind: z.number().int().nonnegative(),
  }),
});
export const confidences = ['reported', 'high', 'medium', 'low'] as const;
export const agentSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(characterKinds),
  /** null when the session's directory is outside every scanned repository. */
  repoId: z.string().nullable(),
  activity: z.enum(activities),
  source: z.string(),
  confidence: z.enum(confidences),
  /** Raw observation behind `activity`, e.g. the last tool or an unmapped status. */
  detail: z.string().optional(),
  pid: z.number().int().positive().optional(),
  sessionId: z.string().optional(),
  cwd: z.string().optional(),
  updatedAt: z.number().optional(),
});
export const worldSchema = z
  .object({
    version: z.number().int().nonnegative(),
    mode: z.enum(['demo', 'live']),
    updatedAt: z.number(),
    repos: z.array(repoSchema),
    agents: z.array(agentSchema),
    districts: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        rootPath: z.string(),
        plots: z.array(
          z.object({
            id: z.string(),
            repoId: z.string(),
            position: pointSchema,
          }),
        ),
      }),
    ),
  })
  .superRefine((world, ctx) => {
    const repos = new Map(world.repos.map((repo) => [repo.id, repo]));
    const districts = new Set(world.districts.map((district) => district.id));
    const invalid = (message: string) =>
      ctx.addIssue({ code: 'custom', message });
    if (repos.size !== world.repos.length)
      invalid('Repository IDs must be unique');
    if (districts.size !== world.districts.length)
      invalid('District IDs must be unique');
    if (
      new Set(world.agents.map((agent) => agent.id)).size !==
      world.agents.length
    )
      invalid('Agent IDs must be unique');
    const placed = new Set<string>();
    for (const district of world.districts) {
      for (const plot of district.plots) {
        if (repos.get(plot.repoId)?.districtId !== district.id)
          invalid('Plot must reference a repository in its district');
        if (placed.has(plot.repoId))
          invalid('Repository must have exactly one plot');
        placed.add(plot.repoId);
      }
    }
    for (const repo of world.repos) {
      if (!districts.has(repo.districtId) || !placed.has(repo.id))
        invalid('Repository requires a district and plot');
    }
    for (const agent of world.agents) {
      if (agent.repoId !== null && !repos.has(agent.repoId))
        invalid('Agent must reference an existing repository');
    }
  });

export type World = z.infer<typeof worldSchema>;
export type Repo = z.infer<typeof repoSchema>;
export type AgentNpc = z.infer<typeof agentSchema>;
export const needsAttention = (agent: AgentNpc) =>
  ['waiting-input', 'waiting-permission', 'failed'].includes(agent.activity);

/** Messages the daemon sends over its WebSocket. */
export type ServerMessage =
  | { type: 'world'; world: World }
  | { type: 'error'; message: string }
  | { type: 'focus-result'; agentId: string; ok: boolean; message: string };

/** The only request the page can make: bring a known session's window forward. */
export const clientMessageSchema = z.object({
  type: z.literal('focus-agent'),
  agentId: z.string().max(200),
});
export type ClientMessage = z.infer<typeof clientMessageSchema>;
