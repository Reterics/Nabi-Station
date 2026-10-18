import { layoutDistricts, seedFromString } from '@nabi/building-gen';
import { archetypes, worldSchema, type World } from '@nabi/protocol';

const names = [
  'nabi-station',
  'model-lab',
  'forge-engine',
  'cloud-control',
  'little-commerce',
  'field-notes',
];
const languages = ['TypeScript', 'Python', 'Rust', 'C#', 'Ruby', 'Markdown'];
const descriptions = [
  'A little city for your development workspace.',
  'Experiments, evaluations, and model notebooks.',
  'Native tools that keep the workshop moving.',
  'Services and infrastructure for the team.',
  'A small storefront with a lot of character.',
  'The shared knowledge of the workspace.',
];

export function createDemoWorld(): World {
  const positions = layoutDistricts([names.length])[0]!;
  return worldSchema.parse({
    version: 1,
    mode: 'demo',
    updatedAt: Date.UTC(2026, 9, 18, 10),
    repos: names.map((name, index) => ({
      id: name,
      name,
      path: `D:/workspace/${name}`,
      districtId: 'workspace',
      language: languages[index],
      description: descriptions[index],
      building: {
        archetype: archetypes[index],
        tier: [3, 2, 2, 4, 2, 1][index],
        seed: seedFromString(name),
        footprint: index === 3 ? 2 : 1,
        modules:
          index % 2 === 0
            ? ['tests', 'ci', 'docs']
            : ['docs', 'container', 'deploy'],
      },
      git: {
        branch: index === 0 ? 'feat/city-scaffold' : 'main',
        modified: index === 0 ? 4 : 0,
        untracked: index === 1 ? 2 : 0,
        ahead: index === 0 ? 2 : 0,
        behind: 0,
      },
    })),
    districts: [
      {
        id: 'workspace',
        name: 'Workshop district',
        rootPath: 'D:/workspace',
        plots: names.map((name, index) => ({
          id: `plot-${name}`,
          repoId: name,
          position: positions[index],
        })),
      },
    ],
    agents: [
      {
        id: 'claude-1',
        name: 'Claude Code',
        kind: 'claude-code',
        repoId: 'nabi-station',
        activity: 'waiting-input',
        source: 'Demo fixture',
        confidence: 'reported',
      },
      {
        id: 'codex-1',
        name: 'Codex',
        kind: 'codex',
        repoId: 'model-lab',
        activity: 'editing',
        source: 'Demo fixture',
        confidence: 'high',
      },
      {
        id: 'generic-1',
        name: 'Workshop agent',
        kind: 'generic',
        repoId: 'forge-engine',
        activity: 'running-tool',
        source: 'Demo fixture',
        confidence: 'medium',
      },
    ],
  });
}
