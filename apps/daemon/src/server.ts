import { timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import {
  clientMessageSchema,
  type AgentNpc,
  type ServerMessage,
} from '@nabi/protocol';
import { WebSocketServer, type WebSocket } from 'ws';
import { focusAgentWindow, type FocusResult } from './focus';
import type { Station } from './station';

export const PROTOCOL = 'nabi.v1';
const LOOPBACK = '127.0.0.1';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.glb': 'model/gltf-binary',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.wasm': 'application/wasm',
};

export interface ServeOptions {
  station: Station;
  port: number;
  token: string;
  /** Built web app to serve on the same origin, if present. */
  webRoot?: string;
  /** Extra page origins allowed to open the socket (the Vite dev and preview servers). */
  extraOrigins?: string[];
  /** Brings an agent's window forward; replaceable so tests never steal focus. */
  focus?: (agent: AgentNpc) => Promise<FocusResult>;
}

const sameToken = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Loopback-only HTTP + WebSocket server (plan §16): DNS-rebinding is blocked by the
 * Host check, other web pages by the Origin allowlist, and anything else local by
 * the per-run token, which the browser sends as a WebSocket subprotocol.
 */
export async function serve(options: ServeOptions) {
  const { station, port, token, focus = focusAgentWindow } = options;
  const allowedHosts = new Set([`${LOOPBACK}:${port}`, `localhost:${port}`]);
  const allowedOrigins = new Set([
    `http://${LOOPBACK}:${port}`,
    `http://localhost:${port}`,
    ...(options.extraOrigins ?? []),
  ]);

  const server = createServer((request, response) => {
    if (!allowedHosts.has(request.headers.host ?? ''))
      return reply(response, 421, 'Misdirected');
    if (request.method !== 'GET' && request.method !== 'HEAD')
      return reply(response, 405, 'GET only');
    const url = new URL(request.url ?? '/', `http://${LOOPBACK}`);
    if (url.pathname === '/api/health')
      return reply(response, 200, '{"ok":true}', '.json');
    if (options.webRoot)
      return void serveStatic(
        options.webRoot,
        url.pathname,
        request,
        response,
        daemonMeta(port, token),
      );
    reply(response, 404, 'Not found');
  });

  const sockets = new WebSocketServer({
    noServer: true,
    maxPayload: 1024,
    handleProtocols: (protocols) =>
      protocols.has(PROTOCOL) ? PROTOCOL : false,
  });
  server.on('upgrade', (request, socket, head) => {
    const offered = (request.headers['sec-websocket-protocol'] ?? '')
      .split(',')
      .map((value) => value.trim());
    const authorised =
      allowedHosts.has(request.headers.host ?? '') &&
      allowedOrigins.has(request.headers.origin ?? '') &&
      request.url?.split('?')[0] === '/ws' &&
      offered.includes(PROTOCOL) &&
      offered.some((value) => sameToken(value, token));
    if (!authorised) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    sockets.handleUpgrade(request, socket, head, (ws) =>
      sockets.emit('connection', ws),
    );
  });

  const send = (ws: WebSocket, message: ServerMessage) =>
    ws.send(JSON.stringify(message));
  sockets.on('connection', (ws) => {
    if (station.world) send(ws, { type: 'world', world: station.world });
    let busy = false;
    ws.on('message', async (data) => {
      // Anything but a well-formed focus request for a currently observed agent is
      // ignored: the page can point at a session, never at an arbitrary process.
      let parsed;
      try {
        parsed = clientMessageSchema.safeParse(JSON.parse(String(data)));
      } catch {
        return;
      }
      if (!parsed.success || busy) return;
      const { agentId } = parsed.data;
      const agent = station.world?.agents.find((agent) => agent.id === agentId);
      if (!agent) return;
      busy = true;
      try {
        const result = await focus(agent);
        send(ws, { type: 'focus-result', agentId, ...result });
      } finally {
        busy = false;
      }
    });
  });
  station.on('world', (world) => {
    for (const client of sockets.clients)
      send(client, { type: 'world', world });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, LOOPBACK, resolve);
  });
  return server;
}

function reply(
  response: ServerResponse,
  status: number,
  body: string,
  type = '.txt',
) {
  response.writeHead(status, {
    'content-type': CONTENT_TYPES[type] ?? 'text/plain; charset=utf-8',
    'x-content-type-options': 'nosniff',
  });
  response.end(body);
}

/**
 * Tells the page where the daemon is, so a plain http://127.0.0.1:<port>/ connects.
 * Other sites cannot read this page (no CORS headers; foreign Host headers are refused).
 */
export const daemonMeta = (port: number, token: string) =>
  `<meta name="nabi-daemon" content="${port}:${token}" />`;

async function serveStatic(
  root: string,
  pathname: string,
  request: IncomingMessage,
  response: ServerResponse,
  meta: string,
) {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return reply(response, 400, 'Bad path');
  }
  const relative = normalize(decoded).replace(/^([/\\])+/, '');
  let file = join(root, relative);
  if (!file.startsWith(normalize(root + sep)) && file !== normalize(root))
    return reply(response, 403, 'Forbidden');
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) {
    // Single-page app: unknown paths without an extension get the shell.
    if (extname(relative)) return reply(response, 404, 'Not found');
    file = join(root, 'index.html');
  }
  const headers = {
    'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'cache-control': 'no-cache',
  };
  if (extname(file) === '.html') {
    const html = (await readFile(file, 'utf8')).replace(
      '</head>',
      `${meta}</head>`,
    );
    response.writeHead(200, { ...headers, 'cache-control': 'no-store' });
    return response.end(request.method === 'HEAD' ? undefined : html);
  }
  response.writeHead(200, headers);
  if (request.method === 'HEAD') return response.end();
  createReadStream(file).pipe(response);
}
