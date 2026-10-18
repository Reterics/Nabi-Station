import { z } from 'zod';

/**
 * Tools a session hands work to (MCP servers, web access, subagents). Each category
 * has its own figure in the scene so Blender, Higgsfield and a database never look alike.
 */
export const helperCategories = [
  '3d',
  'media',
  'design',
  'browser',
  'web',
  'database',
  'ide',
  'code-host',
  'docs',
  'cloud',
  'comms',
  'subagent',
  'tool',
] as const;
export type HelperCategory = (typeof helperCategories)[number];

/**
 * `active`: the session is waiting on it right now. `waiting`: called but not
 * yet allowed (likely a permission prompt). `recent`: used earlier in this session.
 */
export const helperStates = ['active', 'waiting', 'recent', 'failed'] as const;
export type HelperState = (typeof helperStates)[number];

export const helperSchema = z.object({
  id: z.string(),
  label: z.string(),
  category: z.enum(helperCategories),
  state: z.enum(helperStates),
  /** Last tool name called on it, e.g. `execute_blender_code`. Never its arguments. */
  tool: z.string().optional(),
  calls: z.number().int().nonnegative(),
  lastUsedAt: z.number().optional(),
});
export type Helper = z.infer<typeof helperSchema>;

export const helperCategoryNames: Record<HelperCategory, string> = {
  '3d': '3D modelling',
  media: 'Image & video',
  design: 'Design',
  browser: 'Browser',
  web: 'Web & search',
  database: 'Database',
  ide: 'IDE',
  'code-host': 'Code hosting',
  docs: 'Documents',
  cloud: 'Cloud & deploy',
  comms: 'Messaging & calendar',
  subagent: 'Subagent',
  tool: 'Tool',
};

/** First match wins; tested against the server name, then the namespaced tool. */
const rules: [RegExp, HelperCategory][] = [
  [
    /blender|meshy|sketchfab|unity|unreal|godot|scene_?builder|tripo|rodin|spline/i,
    '3d',
  ],
  [
    /higgsfield|midjourney|runway|elevenlabs|replicate|fal\b|stability|dall-?e|suno|heygen|kling|image|video|audio/i,
    'media',
  ],
  [/figma|canva|penpot|excalidraw|framer|sketch\b/i, 'design'],
  [/chrome|playwright|puppeteer|browser|selenium/i, 'browser'],
  [
    /tiger|postgres|supabase|sqlite|mysql|mongo|redis|neon|timescale|database|bigquery|snowflake|clickhouse|prisma|\bdb\b/i,
    'database',
  ],
  [
    /phpstorm|idea|jetbrains|intellij|webstorm|pycharm|rider|vscode|cursor|\bide\b/i,
    'ide',
  ],
  [/github|gitlab|bitbucket|\bgit\b/i, 'code-host'],
  [/docs?\b|notion|confluence|obsidian|drive|sheets|context7|wiki/i, 'docs'],
  [
    /vercel|netlify|aws|azure|gcp|cloudflare|docker|kubernetes|k8s|tiger_?cloud|render|fly\.io|railway|sentry/i,
    'cloud',
  ],
  [
    /slack|gmail|mail|calendar|discord|teams|linear|jira|asana|trello|telegram/i,
    'comms',
  ],
  [
    /search|fetch|web|devrelay|dev\.?to|brave|exa|tavily|perplexity|firecrawl/i,
    'web',
  ],
];

const knownLabels: Record<string, string> = {
  'claude-in-chrome': 'Chrome',
  devrelay: 'DevRelay',
  phpstorm: 'PhpStorm',
  idea: 'IntelliJ IDEA',
  github: 'GitHub',
  gitlab: 'GitLab',
};

/** `claude_ai_Claude_Docs` → "Claude Docs", `meshy-mcp-server` → "Meshy". */
export function helperLabel(server: string): string {
  const core = server
    .replace(/^claude_ai_/i, '')
    .replace(/[-_]?(mcp[-_]?server|mcp|server|gateway)$/i, '')
    .replace(/^mcp[-_]/i, '');
  const known = knownLabels[core.toLowerCase()];
  if (known) return known;
  return (
    core
      .split(/[-_\s]+/)
      .filter(Boolean)
      .map((word) => word[0]!.toUpperCase() + word.slice(1))
      .join(' ') || server
  );
}

export function helperCategory(server: string, tool = ''): HelperCategory {
  for (const subject of [helperLabel(server), server, tool])
    for (const [pattern, category] of rules)
      if (pattern.test(subject)) return category;
  return 'tool';
}

/**
 * Identity of an MCP call. Gateways that front several apps (Codex's `codex_apps`)
 * name the app in the tool's namespace: `github.fetch_file` → GitHub.
 */
export function mcpHelper(
  server: string,
  tool: string,
): Pick<Helper, 'id' | 'label' | 'category' | 'tool'> {
  const namespaced = /^([a-z0-9_-]+)\.(.+)$/i.exec(tool);
  const app = /apps?$/i.test(server) && namespaced ? namespaced[1]! : server;
  const name = namespaced && app !== server ? namespaced[2]! : tool;
  return {
    id: `mcp:${app.toLowerCase()}`,
    label: helperLabel(app),
    category: helperCategory(app, name),
    tool: name,
  };
}

/** Claude Code names MCP tools `mcp__<server>__<tool>`. */
export function parseMcpToolName(
  name: string,
): { server: string; tool: string } | null {
  const match = /^mcp__(.+?)__(.+)$/.exec(name);
  return match ? { server: match[1]!, tool: match[2]! } : null;
}
