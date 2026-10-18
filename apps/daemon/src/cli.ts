import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { AgentNpc } from '@nabi/protocol';
import {
  defaultAdapters,
  discoverAgents,
  type AgentObservation,
} from './agents';
import { nabiHome } from './paths';
import { serve } from './server';
import { Station } from './station';
import { isDirectory } from './workspace/scan';

// node:sqlite (Codex adapter) warns that it is experimental on every start; that is
// known and pinned by `engines`, so keep it out of the user's terminal.
const emitWarning = process.emitWarning.bind(process);
process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  if (String(warning).includes('SQLite is an experimental feature')) return;
  (emitWarning as (...args: unknown[]) => void)(warning, ...rest);
}) as typeof process.emitWarning;

const usage = `Usage:
  nabi agents [--json] [--watch]          List live Claude Code, Codex and Cursor sessions
  nabi scan [roots...] [--json]           Scan roots once and print the world
  nabi serve [roots...] [--port 7357]     Run the daemon for the web app

Roots default to "roots" in ~/.nabi/config.json.
`;

function formatAgents(agents: (AgentObservation | AgentNpc)[]): string {
  if (agents.length === 0) return 'No live agent sessions found.';
  return agents
    .map((agent) =>
      [
        `${agent.name}  [${agent.kind}]`,
        `  ${agent.activity} (${agent.confidence})${agent.detail ? ` — ${agent.detail}` : ''}`,
        `  cwd: ${agent.cwd ?? 'unknown'}${agent.pid ? `   pid: ${agent.pid}` : ''}`,
      ].join('\n'),
    )
    .join('\n\n');
}

async function resolveRoots(positionals: string[]): Promise<string[]> {
  let roots = positionals;
  if (roots.length === 0) {
    try {
      const config = JSON.parse(
        await readFile(join(nabiHome(), 'config.json'), 'utf8'),
      );
      roots = Array.isArray(config.roots)
        ? config.roots.filter((r: unknown) => typeof r === 'string')
        : [];
    } catch {
      roots = [];
    }
  }
  if (roots.length === 0)
    throw new Error(
      'No roots given. Pass folders, or set "roots" in ~/.nabi/config.json.',
    );
  for (const root of roots)
    if (!(await isDirectory(root))) throw new Error(`Not a folder: ${root}`);
  return roots;
}

async function agentsCommand(args: string[]) {
  const { values } = parseArgs({
    args,
    options: { json: { type: 'boolean' }, watch: { type: 'boolean' } },
  });
  const adapters = defaultAdapters();
  const print = async () => {
    const agents = await discoverAgents(adapters, Date.now(), (kind, error) =>
      console.error(`${kind} adapter failed: ${(error as Error).message}`),
    );
    if (values.json) console.log(JSON.stringify(agents, null, 2));
    else {
      if (values.watch) console.clear();
      console.log(formatAgents(agents));
    }
  };
  await print();
  if (values.watch) setInterval(print, 2000);
}

async function scanCommand(args: string[]) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { json: { type: 'boolean' } },
  });
  const station = new Station({ roots: await resolveRoots(positionals) });
  await station.start();
  station.stop();
  const world = station.world!;
  if (values.json) return console.log(JSON.stringify(world, null, 2));
  for (const district of world.districts) {
    console.log(`${district.name}  (${district.rootPath})`);
    for (const plot of district.plots) {
      const repo = world.repos.find((repo) => repo.id === plot.repoId)!;
      const { archetype, tier, modules } = repo.building;
      const { branch, modified, untracked, ahead, behind } = repo.git;
      console.log(
        `  ${repo.name.padEnd(32)} ${repo.language.padEnd(11)} ${archetype.padEnd(10)} tier ${tier}  ` +
          `${branch || '-'} ±${modified} ?${untracked} ↑${ahead} ↓${behind}  [${modules.join(', ')}]`,
      );
    }
  }
  console.log(`\nAgents:\n${formatAgents(world.agents)}`);
}

async function serveCommand(args: string[]) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { port: { type: 'string', default: '7357' } },
  });
  const port = Number(values.port);
  const token = randomBytes(24).toString('hex');
  const station = new Station({
    roots: await resolveRoots(positionals),
    log: (message) => console.log(`[station] ${message}`),
  });
  const webRoot = fileURLToPath(new URL('../../web/dist', import.meta.url));
  await serve({
    station,
    port,
    token,
    webRoot: (await isDirectory(webRoot)) ? webRoot : undefined,
    // The Vite dev server and production preview, both loopback-only.
    extraOrigins: ['http://127.0.0.1:5173', 'http://127.0.0.1:4173'],
  });
  await station.start();
  // Lets the Vite dev server point the page at this daemon (apps/web/vite.config.ts).
  // Only this user's profile can read it; it is removed again on exit.
  const discovery = join(nabiHome(), 'daemon.json');
  await mkdir(nabiHome(), { recursive: true });
  await writeFile(
    discovery,
    JSON.stringify({ port, token, pid: process.pid }),
    'utf8',
  );
  const cleanUp = () => {
    try {
      rmSync(discovery, { force: true });
    } catch {
      // Already gone.
    }
    process.exit(0);
  };
  process.once('SIGINT', cleanUp);
  process.once('SIGTERM', cleanUp);
  process.once('SIGBREAK', cleanUp);

  console.log(
    `\nNabi Station is watching ${station.world?.repos.length ?? 0} repositories.`,
  );
  if (await isDirectory(webRoot))
    console.log(`Open:      http://127.0.0.1:${port}/`);
  else
    console.log('No web build found; run `pnpm build` to serve the app here.');
  console.log('Dev app:   http://127.0.0.1:5173/ (with `pnpm dev`)');
  console.log('Press Ctrl+C to stop.');
}

const [command, ...rest] = process.argv.slice(2);
try {
  switch (command) {
    case 'agents':
      await agentsCommand(rest);
      break;
    case 'scan':
      await scanCommand(rest);
      break;
    case 'serve':
      await serveCommand(rest);
      break;
    default:
      console.log(usage);
      process.exitCode = command ? 1 : 0;
  }
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
}
