import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';

const PORT = 7358;
let root: string;
let daemon: ChildProcess;
let appUrl: string;

function makeRepo(
  name: string,
  files: Record<string, string>,
  { commits, untracked = [] }: { commits: number; untracked?: string[] },
) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'Nabi Test');
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(join(dir, file, '..'), { recursive: true });
    writeFileSync(join(dir, file), content);
  }
  git('add', '--all');
  for (let commit = 0; commit < commits; commit++)
    git('commit', '-q', '--allow-empty', '-m', `commit ${commit}`);
  for (const file of untracked)
    writeFileSync(join(dir, file), 'work in progress');
}

function stopDaemon() {
  if (!daemon?.pid) return;
  if (process.platform === 'win32')
    execFileSync('taskkill', ['/pid', String(daemon.pid), '/T', '/F'], {
      stdio: 'ignore',
    });
  else process.kill(-daemon.pid, 'SIGTERM');
}

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'nabi-live-'));
  makeRepo(
    'garden-api',
    {
      'README.md': '# Garden',
      'src/index.ts': 'export {};',
      'src/index.test.ts': '',
      '.github/workflows/ci.yml': 'on: push',
      Dockerfile: 'FROM scratch',
    },
    { commits: 3, untracked: ['scratch.txt'] },
  );
  makeRepo('notes', { 'README.md': '# Notes', 'guide.md': '' }, { commits: 2 });
  daemon = spawn(
    process.execPath,
    [
      'apps/daemon/node_modules/tsx/dist/cli.mjs',
      'apps/daemon/src/cli.ts',
      'serve',
      root,
      '--port',
      String(PORT),
    ],
    {
      env: {
        ...process.env,
        NABI_ADAPTERS: 'none',
        // Keep the test daemon's discovery file out of the real ~/.nabi.
        NABI_HOME: join(root, '.nabi-home'),
        NODE_NO_WARNINGS: '1',
      },
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  appUrl = await new Promise<string>((resolve, reject) => {
    let output = '';
    const timer = setTimeout(
      () => reject(new Error(`daemon did not start:\n${output}`)),
      30_000,
    );
    const read = (chunk: Buffer) => {
      output += chunk.toString();
      const match = /Open:\s+(http:\/\/127\.0\.0\.1:\d+\/)/.exec(output);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]!);
      }
    };
    daemon.stdout!.on('data', read);
    daemon.stderr!.on('data', read);
    daemon.once('exit', (code) =>
      reject(new Error(`daemon exited (${code}):\n${output}`)),
    );
  });
});

test.afterAll(() => {
  stopDaemon();
  rmSync(root, { recursive: true, force: true });
});

test('the daemon serves a live city over an authenticated local socket', async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  const external: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('request', (request) => {
    if (
      /^(https?|wss?):/.test(request.url()) &&
      new URL(request.url()).hostname !== '127.0.0.1'
    )
      external.push(request.url());
  });

  // A plain URL is enough: the daemon tells its own page where it is.
  await page.goto(appUrl);
  await expect(page.locator('.demo-badge')).toHaveText('Live workspace');
  await expect(page.locator('.connection')).toContainText('Live');
  await expect(page.locator('.plot-label')).toHaveCount(2);
  await page
    .getByLabel('Select repository')
    .selectOption({ label: 'garden-api' });
  await expect(
    page.getByRole('heading', { name: 'garden-api', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('TypeScript · office')).toBeVisible();
  await expect(page.getByText('Tier 3/4')).toBeVisible();
  await expect(page.locator('.git-stats')).toContainText('1 untracked');
  await expect(
    page.getByText('Live data · read on this device; nothing leaves it.'),
  ).toBeVisible();

  await page.reload();
  await expect(page.locator('.demo-badge')).toHaveText('Live workspace');

  // Wrong token, wrong origin, or a foreign Host header are refused.
  const refused = await page.evaluate(
    (port) =>
      new Promise<boolean>((resolve) => {
        const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, [
          'nabi.v1',
          'f'.repeat(48),
        ]);
        socket.onopen = () => resolve(false);
        socket.onerror = () => resolve(true);
      }),
    PORT,
  );
  expect(refused).toBe(true);
  const rebound = await request.get(`http://127.0.0.1:${PORT}/api/health`, {
    headers: { host: 'attacker.example' },
  });
  expect(rebound.status()).toBe(421);

  expect(errors.filter((error) => !/WebSocket/.test(error))).toEqual([]);
  expect(external).toEqual([]);
});
