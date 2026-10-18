import { EventEmitter } from 'node:events';
import type { World } from '@nabi/protocol';
import {
  defaultAdapters,
  discoverAgents,
  type AgentObservation,
} from './agents';
import type { AgentAdapter } from './agents/types';
import { pathKey } from './paths';
import { analyzeRepo, type RepoSignals } from './workspace/analyze';
import { gitStatus, mapLimit, type GitState } from './workspace/git';
import { discoverRepos, type DiscoveredRepo } from './workspace/scan';
import { buildWorld } from './world';

export interface StationOptions {
  roots: string[];
  adapters?: AgentAdapter[];
  agentIntervalMs?: number;
  gitIntervalMs?: number;
  scanIntervalMs?: number;
  log?: (message: string) => void;
}

/** Runs `task` unless a previous run is still in flight. */
function singleFlight(task: () => Promise<void>) {
  let running: Promise<void> | null = null;
  return () => (running ??= task().finally(() => (running = null)));
}

const CLEAN: GitState = {
  branch: '',
  modified: 0,
  untracked: 0,
  ahead: 0,
  behind: 0,
};

/**
 * Owns the observed state and emits `world` whenever the derived World changes.
 * Agents are polled often (cheap file reads); git status less often; the
 * directory scan and repository analysis rarely.
 */
export class Station extends EventEmitter<{ world: [World] }> {
  world: World | null = null;
  private repos: DiscoveredRepo[] = [];
  private signals = new Map<string, RepoSignals>();
  private git = new Map<string, GitState>();
  private agents: AgentObservation[] = [];
  private timers: NodeJS.Timeout[] = [];
  private lastFingerprint = '';
  private version = 0;
  private readonly adapters: AgentAdapter[];
  private readonly log: (message: string) => void;

  constructor(private readonly options: StationOptions) {
    super();
    this.adapters = options.adapters ?? defaultAdapters();
    this.log = options.log ?? (() => {});
  }

  readonly scan = singleFlight(async () => {
    this.repos = await discoverRepos(this.options.roots);
    const missing = this.repos.filter(
      (repo) => !this.signals.has(pathKey(repo.path)),
    );
    await mapLimit(missing, 2, async (repo) =>
      this.signals.set(pathKey(repo.path), await analyzeRepo(repo.path)),
    );
    this.log(`Scanned ${this.repos.length} repositories`);
    await this.refreshGit();
  });

  readonly refreshGit = singleFlight(async () => {
    await mapLimit(this.repos, 4, async (repo) => {
      try {
        this.git.set(pathKey(repo.path), await gitStatus(repo.path));
      } catch (error) {
        this.log(
          `git status failed for ${repo.path}: ${(error as Error).message}`,
        );
      }
    });
    this.publish();
  });

  readonly refreshAgents = singleFlight(async () => {
    this.agents = await discoverAgents(
      this.adapters,
      Date.now(),
      (kind, error) =>
        this.log(`${kind} adapter failed: ${(error as Error).message}`),
    );
    this.publish();
  });

  async start() {
    await Promise.all([this.scan(), this.refreshAgents()]);
    // An unhandled rejection would end the process; a failed poll must only skip a beat.
    const every = (ms: number, task: () => Promise<void>) =>
      this.timers.push(
        setInterval(
          () =>
            task().catch((error: unknown) =>
              this.log(`refresh failed: ${(error as Error).message}`),
            ),
          ms,
        ),
      );
    every(this.options.agentIntervalMs ?? 2_000, this.refreshAgents);
    every(this.options.gitIntervalMs ?? 10_000, this.refreshGit);
    every(this.options.scanIntervalMs ?? 5 * 60_000, () => {
      // Re-analyse on rescans so tier changes (new CI, tests…) show up.
      this.signals.clear();
      return this.scan();
    });
  }

  /** What the local model may see about a repository; undefined until analysed. */
  insight(path: string) {
    const signals = this.signals.get(pathKey(path));
    return signals?.analysis
      ? { analysis: signals.analysis, excerpts: signals.excerpts ?? {} }
      : undefined;
  }

  stop() {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
  }

  private publish() {
    const now = Date.now();
    const world = buildWorld({
      roots: this.options.roots,
      repos: this.repos.flatMap((repo) => {
        const signals = this.signals.get(pathKey(repo.path));
        return signals
          ? [{ repo, signals, git: this.git.get(pathKey(repo.path)) ?? CLEAN }]
          : [];
      }),
      agents: this.agents,
      version: this.version,
      now,
    });
    // Agents' updatedAt ticks constantly; only meaningful changes bump the version.
    const fingerprint = JSON.stringify({
      ...world,
      version: 0,
      updatedAt: 0,
      agents: world.agents.map(({ updatedAt: _, ...agent }) => agent),
    });
    if (fingerprint === this.lastFingerprint && this.world) return;
    this.lastFingerprint = fingerprint;
    this.world = { ...world, version: ++this.version };
    this.emit('world', this.world);
  }
}
