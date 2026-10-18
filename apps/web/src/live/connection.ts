import {
  recommendationsSchema,
  worldSchema,
  type ClientMessage,
  type ServerMessage,
} from '@nabi/protocol';
import { demoRequested, useStation } from '../state/store';

/** Must match the daemon's subprotocol (apps/daemon/src/server.ts). */
const PROTOCOL = 'nabi.v1';
const STORAGE_KEY = 'nabi.daemon';

interface Target {
  port: string;
  token: string;
}

const valid = (port: unknown, token: unknown): port is string =>
  typeof port === 'string' &&
  /^\d{1,5}$/.test(port) &&
  typeof token === 'string' &&
  /^[0-9a-f]{16,128}$/.test(token);

/**
 * Where the daemon is, in order:
 * 1. `<meta name="nabi-daemon" content="port:token">`, injected into the page by the
 *    daemon itself and by the Vite dev server (from ~/.nabi/daemon.json), so a plain
 *    http://127.0.0.1:7357/ or :5173/ just works while the daemon runs;
 * 2. a `#token=…` / `#daemon=<port>&token=…` fragment, moved into session storage
 *    and removed from the address bar;
 * 3. session storage from an earlier fragment.
 */
function readTarget(): Target | null {
  const meta = document
    .querySelector<HTMLMetaElement>('meta[name="nabi-daemon"]')
    ?.content.split(':');
  if (meta && valid(meta[0], meta[1]))
    return { port: meta[0], token: meta[1]! };
  const params = new URLSearchParams(window.location.hash.slice(1));
  const token = params.get('token');
  if (token && /^[0-9a-f]{16,128}$/.test(token)) {
    const port = params.get('daemon') ?? window.location.port;
    if (/^\d{1,5}$/.test(port)) {
      const target = { port, token };
      try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(target));
      } catch {
        // Private windows may refuse storage; the connection still works until reload.
      }
      history.replaceState(
        null,
        '',
        window.location.pathname + window.location.search,
      );
      return target;
    }
  }
  try {
    const stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null');
    return stored &&
      typeof stored.port === 'string' &&
      typeof stored.token === 'string'
      ? stored
      : null;
  } catch {
    return null;
  }
}

let started = false;
let socket: WebSocket | null = null;

/** Asks the daemon to bring a session's terminal or editor window to the front. */
export function requestAgentFocus(agentId: string) {
  const { setFocusStatus } = useStation.getState();
  if (socket?.readyState !== WebSocket.OPEN) {
    setFocusStatus({
      agentId,
      state: 'error',
      message: 'The daemon is not connected.',
    });
    return;
  }
  const message: ClientMessage = { type: 'focus-agent', agentId };
  socket.send(JSON.stringify(message));
  setFocusStatus({
    agentId,
    state: 'pending',
    message: 'Looking for the window…',
  });
}

/** Asks the daemon for the local model's recommendations for a repository. */
export function requestRecommendations(repoId: string) {
  const { setRecommendations } = useStation.getState();
  if (socket?.readyState !== WebSocket.OPEN) {
    setRecommendations(repoId, {
      state: 'unavailable',
      message: 'The daemon is not connected.',
    });
    return;
  }
  const message: ClientMessage = { type: 'recommend-repo', repoId };
  socket.send(JSON.stringify(message));
  setRecommendations(repoId, { state: 'pending' });
}

/** Connects to the local daemon. Without one the city stays empty (never demo data). */
export function startLiveConnection() {
  if (started || demoRequested()) return;
  started = true;
  const target = readTarget();
  if (!target) return;
  const { setWorld, setConnection } = useStation.getState();
  let retry = 1000;

  const connect = () => {
    setConnection('connecting');
    // Always 127.0.0.1: "localhost" may resolve to ::1, where the daemon is not listening.
    const current = new WebSocket(`ws://127.0.0.1:${target.port}/ws`, [
      PROTOCOL,
      target.token,
    ]);
    socket = current;
    current.onmessage = (event) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (message.type === 'focus-result') {
        useStation.getState().setFocusStatus({
          agentId: message.agentId,
          state: message.ok ? 'ok' : 'error',
          message: message.message,
        });
        return;
      }
      if (message.type === 'recommendations') {
        const { type: _, repoId, ...result } = message;
        if (result.state !== 'ready') {
          useStation.getState().setRecommendations(repoId, result);
          return;
        }
        // Model output is untrusted text: keep it only if it has the expected shape.
        const checked = recommendationsSchema.safeParse(result.recommendations);
        useStation
          .getState()
          .setRecommendations(
            repoId,
            checked.success
              ? { ...result, recommendations: checked.data }
              : { state: 'unavailable', message: 'Malformed recommendations' },
          );
        return;
      }
      if (message.type !== 'world') return;
      const parsed = worldSchema.safeParse(message.world);
      if (!parsed.success) return;
      retry = 1000;
      setConnection('live');
      setWorld(parsed.data);
    };
    current.onclose = () => {
      setConnection('offline');
      setTimeout(connect, retry);
      retry = Math.min(retry * 2, 15_000);
    };
  };
  connect();
}
