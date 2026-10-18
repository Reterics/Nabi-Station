import { ClaudeCodeAdapter } from './claude';
import { CodexAdapter } from './codex';
import type { AgentAdapter, AgentObservation } from './types';

export type { AgentObservation } from './types';

/** `NABI_ADAPTERS=none` or a comma list (`claude-code,codex`) limits discovery; tests use it. */
export function defaultAdapters(
  selection = process.env.NABI_ADAPTERS,
): AgentAdapter[] {
  const all = [new ClaudeCodeAdapter(), new CodexAdapter()];
  if (!selection) return all;
  const wanted = new Set(selection.split(',').map((kind) => kind.trim()));
  return all.filter((adapter) => wanted.has(adapter.kind));
}

/** One failing adapter (format drift, locked file) must not hide the others. */
export async function discoverAgents(
  adapters: AgentAdapter[],
  now = Date.now(),
  onError: (kind: string, error: unknown) => void = () => {},
): Promise<AgentObservation[]> {
  const results = await Promise.all(
    adapters.map((adapter) =>
      adapter.discover(now).catch((error: unknown) => {
        onError(adapter.kind, error);
        return [];
      }),
    ),
  );
  return results.flat();
}
