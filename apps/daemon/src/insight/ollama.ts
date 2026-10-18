import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  maturityNames,
  recommendationsSchema,
  type RecommendationsResult,
  type RepoAnalysis,
} from '@nabi/protocol';
import { nabiHome } from '../paths';

export const DEFAULT_MODEL = 'gemma4:12b';
const DEFAULT_HOST = 'http://127.0.0.1:11434';
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

export interface OllamaConfig {
  enabled: boolean;
  host: string;
  model: string;
  /** Why it is disabled, shown to the user instead of recommendations. */
  reason?: string;
}

/**
 * Ollama on this machine only. `OLLAMA_HOST` is honoured when it is a loopback
 * address (a bind address such as 0.0.0.0 means "this machine"); sending repository
 * facts anywhere else needs `NABI_OLLAMA_ALLOW_REMOTE=1`.
 */
export function ollamaConfig(env = process.env): OllamaConfig {
  const model = env.NABI_OLLAMA_MODEL || DEFAULT_MODEL;
  if (env.NABI_OLLAMA === 'off')
    return {
      enabled: false,
      host: DEFAULT_HOST,
      model,
      reason: 'Disabled with NABI_OLLAMA=off',
    };
  let raw = env.NABI_OLLAMA_HOST || env.OLLAMA_HOST || DEFAULT_HOST;
  if (!/^https?:\/\//.test(raw)) raw = `http://${raw}`;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return {
      enabled: false,
      host: raw,
      model,
      reason: `Invalid Ollama host ${raw}`,
    };
  }
  if (url.hostname === '0.0.0.0' || url.hostname === '[::]')
    url.hostname = '127.0.0.1';
  if (!url.port) url.port = '11434';
  const host = url.origin;
  if (!LOOPBACK.has(url.hostname) && env.NABI_OLLAMA_ALLOW_REMOTE !== '1')
    return {
      enabled: false,
      host,
      model,
      reason: `Ollama at ${host} is not on this machine; set NABI_OLLAMA_ALLOW_REMOTE=1 to allow it`,
    };
  return { enabled: true, host, model };
}

const SYSTEM = `You review software repositories for their owner. You receive facts that
deterministic tools collected, including a maturity level and a list of checks.
Those are final: do not dispute or recompute them. Write specific, practical advice
grounded only in the facts. Never invent files, tools or numbers that are not in
the facts. Strengths: short phrases about what is already good. Improvements: at most
5, most important first, each with a priority (high, medium, low), an area (one or
two words), a reason and a concrete suggestion. The reason is one sentence in your
own words on why it matters for this repository, not a copy of a check line.
Plain text, no markdown.`;

/**
 * Second, focused request: a small model follows "cover exactly these items" far more
 * reliably when the items are its only task.
 */
const AGENT_SYSTEM = `You write a task for an AI coding agent (such as Claude Code or Codex)
that runs inside the repository described by the facts. The owner will paste it
as-is. Address the agent directly. Start with one sentence naming the repository
and its stack. Then write exactly one numbered step for each item in the task list,
in order, and nothing else: the concrete change and the files or scripts involved,
using only names that appear in the facts. Then tell it to inspect the existing
setup before changing anything, keep changes minimal and consistent with the
codebase, leave unrelated code alone, and finish by running the existing test,
lint or typecheck scripts. End with a short list of acceptance criteria, one per
step. Plain text.`;

/** JSON schemas handed to Ollama's structured output; they mirror `recommendationsSchema`. */
const FORMAT = {
  type: 'object',
  properties: {
    strengths: { type: 'array', items: { type: 'string' }, maxItems: 6 },
    recommendedImprovements: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        properties: {
          priority: { type: 'string', enum: ['high', 'medium', 'low'] },
          area: { type: 'string' },
          reason: { type: 'string' },
          suggestion: { type: 'string' },
        },
        required: ['priority', 'area', 'reason', 'suggestion'],
      },
    },
  },
  required: ['strengths', 'recommendedImprovements'],
};
const AGENT_FORMAT = {
  type: 'object',
  properties: { agentPrompt: { type: 'string' } },
  required: ['agentPrompt'],
};

const EXCERPT_CHARS = 2500;

/**
 * The model's whole view of the repository: the deterministic analysis plus short
 * excerpts of its README and architecture notes. No author names, emails, commit
 * messages, source files or secrets are included.
 */
export function buildPrompt(
  name: string,
  analysis: RepoAnalysis,
  excerpts: Record<string, string> = {},
): string {
  const facts = {
    repository: name,
    maturity: `${analysis.maturity} (${maturityNames[analysis.maturity]})`,
    score: `${analysis.score}/100`,
    activity: analysis.activity,
    size: `${analysis.fileCount} tracked files, ${Math.round(analysis.trackedBytes / 1024)} KiB`,
    languages: analysis.languages.map(
      (language) => `${language.name} ${Math.round(language.share * 100)}%`,
    ),
    frameworks: analysis.frameworks,
    packageManagers: analysis.packageManagers,
    scripts: analysis.scripts,
    dependencies: analysis.dependencies,
    folders: analysis.folders.map(
      (folder) => `${folder.name} (${folder.files})`,
    ),
    gitActivity: {
      commits: analysis.commits.total,
      last30Days: analysis.commits.last30Days,
      last90Days: analysis.commits.last90Days,
      contributors90Days: analysis.commits.authors90Days,
    },
    todoFixme: analysis.todos,
    checks: analysis.checks.map(
      (check) =>
        `${check.status.toUpperCase()} ${check.label}: ${check.evidence}`,
    ),
  };
  const notes = Object.entries(excerpts)
    .map(
      ([path, text]) =>
        `--- ${path} (excerpt) ---\n${text.slice(0, EXCERPT_CHARS).trim()}`,
    )
    .join('\n\n');
  return `Facts:\n${JSON.stringify(facts, null, 2)}${notes ? `\n\n${notes}` : ''}`;
}

type Fetch = typeof fetch;

/** A model or HTTP failure whose message is shown to the user as-is. */
class ModelError extends Error {}

/** Numbered steps (`1.` or `1)` at the start of a line) in an agent prompt. */
export const countSteps = (text: string) =>
  text.match(/^\s*\d+[.)]\s/gm)?.length ?? 0;

/** The configured model if installed, otherwise another local Gemma, otherwise null. */
async function pickModel(
  config: OllamaConfig,
  fetcher: Fetch,
): Promise<string | null> {
  const response = await fetcher(`${config.host}/api/tags`, {
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`Ollama answered ${response.status}`);
  const { models = [] } = (await response.json()) as {
    models?: { name: string }[];
  };
  const names = models.map((model) => model.name);
  if (names.includes(config.model)) return config.model;
  return names.find((name) => /^gemma/i.test(name)) ?? null;
}

export interface RecommendOptions {
  config?: OllamaConfig;
  cacheDir?: string;
  fetcher?: Fetch;
  timeoutMs?: number;
  now?: () => number;
}

/**
 * Recommendation prose for one repository from the local model, cached by the exact
 * prompt so unchanged repositories never hit the GPU twice. Never throws: failures
 * come back as `unavailable` with a reason, and nothing is made up in their place.
 */
export async function recommend(
  prompt: string,
  options: RecommendOptions = {},
): Promise<RecommendationsResult> {
  const config = options.config ?? ollamaConfig();
  if (!config.enabled)
    return { state: 'unavailable', message: config.reason ?? 'Disabled' };
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  const cacheDir =
    options.cacheDir ?? join(nabiHome(), 'cache', 'recommendations');
  try {
    const model = await pickModel(config, fetcher);
    if (!model)
      return {
        state: 'unavailable',
        message: `No Gemma model is installed in Ollama. Run: ollama pull ${config.model}`,
      };
    const key = createHash('sha256')
      .update(`${model}\n${SYSTEM}\n${AGENT_SYSTEM}\n${prompt}`)
      .digest('hex')
      .slice(0, 32);
    const cacheFile = join(cacheDir, `${key}.json`);
    const cached = await readFile(cacheFile, 'utf8').then(
      (text) =>
        JSON.parse(text) as { generatedAt: number; recommendations: unknown },
      () => null,
    );
    const valid =
      cached && recommendationsSchema.safeParse(cached.recommendations);
    if (cached && valid?.success)
      return {
        state: 'ready',
        recommendations: valid.data,
        model,
        generatedAt: cached.generatedAt,
        cached: true,
      };

    const chat = async (
      system: string,
      user: string,
      format: object,
      seed: number,
    ): Promise<unknown> => {
      const response = await fetcher(`${config.host}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: AbortSignal.timeout(options.timeoutMs ?? 180_000),
        body: JSON.stringify({
          model,
          stream: false,
          think: false,
          format,
          options: { temperature: 0, seed },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
      });
      if (!response.ok)
        throw new ModelError(`Ollama answered ${response.status}`);
      const body = (await response.json()) as {
        message?: { content?: string };
      };
      try {
        return JSON.parse(body.message?.content ?? '');
      } catch {
        throw new ModelError(`${model} did not return valid JSON`);
      }
    };

    const advice = recommendationsSchema
      .omit({ agentPrompt: true })
      .safeParse(await chat(SYSTEM, prompt, FORMAT, 7));
    if (!advice.success)
      return {
        state: 'unavailable',
        message: `${model} returned an unexpected shape`,
      };
    const { recommendedImprovements } = advice.data;
    const high = recommendedImprovements.filter(
      (item) => item.priority === 'high',
    );
    const targets = high.length
      ? high
      : recommendedImprovements.filter((item) => item.priority === 'medium');
    let agentPrompt: string | undefined;
    if (targets.length) {
      const list = targets
        .map(
          (item, index) =>
            `${index + 1}. [${item.area}] ${item.suggestion} (Why: ${item.reason})`,
        )
        .join('\n');
      const count = `${targets.length} ${targets.length === 1 ? 'item' : 'items'}`;
      const tasks = `${prompt}\n\nTask list for the agent (${count}):\n${list}`;
      // One retry, with another seed, when a step went missing; keep the fuller one.
      for (const seed of [7, 11]) {
        const written = (
          (await chat(AGENT_SYSTEM, tasks, AGENT_FORMAT, seed)) as {
            agentPrompt?: unknown;
          } | null
        )?.agentPrompt;
        if (typeof written !== 'string' || !written.trim()) continue;
        if (!agentPrompt || countSteps(written) > countSteps(agentPrompt))
          agentPrompt = written.trim();
        if (countSteps(agentPrompt) >= targets.length) break;
      }
    }
    const result = recommendationsSchema.safeParse({
      ...advice.data,
      ...(agentPrompt && { agentPrompt }),
    });
    if (!result.success)
      return {
        state: 'unavailable',
        message: `${model} returned an unexpected shape`,
      };
    const generatedAt = now();
    await mkdir(cacheDir, { recursive: true });
    await writeFile(
      cacheFile,
      JSON.stringify({ model, generatedAt, recommendations: result.data }),
    );
    return {
      state: 'ready',
      recommendations: result.data,
      model,
      generatedAt,
      cached: false,
    };
  } catch (error) {
    const message = (error as Error).message;
    if (error instanceof ModelError) return { state: 'unavailable', message };
    return {
      state: 'unavailable',
      message: /ECONNREFUSED|fetch failed/i.test(message)
        ? `Ollama is not running at ${config.host}`
        : /abort|timeout/i.test(message)
          ? 'Ollama took too long to answer'
          : `Ollama request failed: ${message}`,
    };
  }
}
