import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RepoAnalysis } from '@nabi/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { buildPrompt, countSteps, ollamaConfig, recommend } from './ollama';

const analysis: RepoAnalysis = {
  maturity: 'developing',
  activity: 'active',
  score: 52,
  sizeBand: 2,
  trackedBytes: 40_960,
  fileCount: 80,
  languages: [{ name: 'TypeScript', share: 0.9 }],
  frameworks: ['React'],
  packageManagers: ['pnpm'],
  scripts: ['dev', 'test'],
  dependencies: { runtime: 4, dev: 9 },
  folders: [{ name: 'src/', files: 60 }],
  commits: {
    total: 30,
    last30Days: 5,
    last90Days: 12,
    authors90Days: 2,
  },
  todos: { todo: 3, fixme: 0 },
  checks: [
    {
      id: 'ci',
      label: 'Continuous integration',
      area: 'automation',
      status: 'missing',
      weight: 1,
      evidence: 'No CI workflow',
    },
  ],
};

const reply = {
  strengths: ['Strict TypeScript'],
  recommendedImprovements: [
    {
      priority: 'high',
      area: 'CI',
      reason: 'No CI workflow was detected.',
      suggestion: 'Run lint, typecheck and tests on pull requests.',
    },
  ],
};
const agentReply = '1. Add a CI workflow that runs pnpm test.';

describe('Ollama configuration', () => {
  it('uses this machine by default and refuses remote hosts', () => {
    expect(ollamaConfig({})).toMatchObject({
      enabled: true,
      host: 'http://127.0.0.1:11434',
      model: 'gemma4:12b',
    });
    expect(ollamaConfig({ OLLAMA_HOST: '0.0.0.0' }).host).toBe(
      'http://127.0.0.1:11434',
    );
    expect(
      ollamaConfig({ OLLAMA_HOST: 'gpu.example.com:11434' }),
    ).toMatchObject({ enabled: false });
    expect(
      ollamaConfig({
        OLLAMA_HOST: 'gpu.example.com:11434',
        NABI_OLLAMA_ALLOW_REMOTE: '1',
      }).enabled,
    ).toBe(true);
    expect(ollamaConfig({ NABI_OLLAMA: 'off' }).enabled).toBe(false);
  });
});

describe('prompt', () => {
  it('states the deterministic verdict and evidence, bounded excerpts only', () => {
    const prompt = buildPrompt('demo', analysis, {
      'README.md': `# Demo\n${'x'.repeat(10_000)}`,
    });
    expect(prompt).toContain('developing (Developing)');
    expect(prompt).toContain('MISSING Continuous integration: No CI workflow');
    expect(prompt.length).toBeLessThan(5_000);
  });
});

describe('recommend', () => {
  let server: Server | undefined;
  let cacheDir: string;
  afterEach(async () => {
    server?.close();
    if (cacheDir) await rm(cacheDir, { recursive: true, force: true });
  });

  /** Answers the advice request with `content` and agent-prompt requests from `agent`. */
  async function fakeOllama(
    content: string,
    models = ['gemma4:12b'],
    agent: (seed: number) => string = () => agentReply,
  ) {
    const requests: string[] = [];
    const chats: { seed: number; user: string; agent: boolean }[] = [];
    server = createServer((request, response) => {
      requests.push(request.url ?? '');
      let body = '';
      request.on('data', (chunk) => (body += chunk));
      request.on('end', () => {
        response.setHeader('content-type', 'application/json');
        if (request.url === '/api/tags')
          return response.end(
            JSON.stringify({ models: models.map((name) => ({ name })) }),
          );
        const sent = JSON.parse(body);
        expect(sent).toMatchObject({ stream: false, think: false });
        const isAgent = 'agentPrompt' in sent.format.properties;
        chats.push({
          seed: sent.options.seed,
          user: sent.messages[1].content,
          agent: isAgent,
        });
        response.end(
          JSON.stringify({
            message: {
              content: isAgent
                ? JSON.stringify({ agentPrompt: agent(sent.options.seed) })
                : content,
            },
          }),
        );
      });
    });
    await new Promise<void>((resolve) =>
      server!.listen(0, '127.0.0.1', resolve),
    );
    const { port } = server.address() as { port: number };
    cacheDir = await mkdtemp(join(tmpdir(), 'nabi-ollama-'));
    return {
      requests,
      chats,
      options: {
        config: ollamaConfig({ OLLAMA_HOST: `127.0.0.1:${port}` }),
        cacheDir,
        now: () => 1234,
      },
    };
  }

  it('returns validated recommendations and serves repeats from the cache', async () => {
    const { requests, chats, options } = await fakeOllama(
      JSON.stringify(reply),
    );
    expect(await recommend('facts', options)).toEqual({
      state: 'ready',
      recommendations: { ...reply, agentPrompt: agentReply },
      model: 'gemma4:12b',
      generatedAt: 1234,
      cached: false,
    });
    expect(await recommend('facts', options)).toMatchObject({
      state: 'ready',
      cached: true,
    });
    // Advice, then one focused request for the fix prompt; nothing on the cache hit.
    expect(requests.filter((url) => url === '/api/chat')).toHaveLength(2);
    expect(chats[1]!.user).toContain(
      'Task list for the agent (1 item):\n1. [CI] Run lint, typecheck and tests on pull requests.',
    );
  });

  it('only asks for a fix prompt for high items, and retries when a step is missing', async () => {
    const mixed = {
      ...reply,
      recommendedImprovements: [
        { ...reply.recommendedImprovements[0]!, area: 'Licence' },
        { ...reply.recommendedImprovements[0]!, priority: 'low', area: 'Docs' },
        reply.recommendedImprovements[0]!,
      ],
    };
    const { chats, options } = await fakeOllama(
      JSON.stringify(mixed),
      undefined,
      (seed) =>
        seed === 7 ? '1. Add a licence.' : '1. Add a licence.\n2. Add CI.',
    );
    const result = await recommend('facts', options);
    expect(chats.filter((chat) => chat.agent).map((chat) => chat.seed)).toEqual(
      [7, 11],
    );
    expect(chats[1]!.user).toContain('(2 items)');
    expect(chats[1]!.user).not.toContain('[Docs]');
    expect(result).toMatchObject({
      recommendations: { agentPrompt: '1. Add a licence.\n2. Add CI.' },
    });
    expect(countSteps('1. a\n  2) b\n3 c\n10. d')).toBe(3);
  });

  it('reports instead of inventing when the model misbehaves or is missing', async () => {
    const broken = await fakeOllama('not json');
    expect(await recommend('facts', broken.options)).toMatchObject({
      state: 'unavailable',
      message: 'gemma4:12b did not return valid JSON',
    });
    server?.close();
    const wrong = await fakeOllama(JSON.stringify({ strengths: 'x' }));
    expect(await recommend('facts', wrong.options)).toMatchObject({
      state: 'unavailable',
    });
    server?.close();
    const none = await fakeOllama('{}', ['llama3:8b']);
    expect(await recommend('facts', none.options)).toMatchObject({
      state: 'unavailable',
      message: expect.stringContaining('ollama pull gemma4:12b'),
    });
  });

  it('says so when Ollama is not running', async () => {
    expect(
      await recommend('facts', {
        config: ollamaConfig({ OLLAMA_HOST: '127.0.0.1:9' }),
      }),
    ).toMatchObject({
      state: 'unavailable',
      message: 'Ollama is not running at http://127.0.0.1:9',
    });
  });
});
