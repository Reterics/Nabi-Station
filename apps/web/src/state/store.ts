import { create } from 'zustand';
import {
  needsAttention,
  type AnimationClip,
  type RecommendationsResult,
  type World,
} from '@nabi/protocol';
import { createDemoWorld } from '../demo/world';

/** `sessions` is home: live sessions and their helpers. `city` browses every repository. */
export type View = 'sessions' | 'city' | 'gallery';
export type GalleryKind = 'characters' | 'helpers' | 'buildings';
export type Selection = { kind: 'repo' | 'agent'; id: string } | null;
/** `demo` only when `?demo` is in the URL; the others describe the daemon socket. */
export type Connection = 'demo' | 'connecting' | 'live' | 'offline';

/** Fixture data is never shown unless explicitly asked for. */
export const demoRequested = () =>
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).has('demo');

/** What the city shows before the daemon has sent anything: nothing invented. */
const EMPTY_WORLD: World = {
  version: 0,
  mode: 'live',
  updatedAt: 0,
  repos: [],
  agents: [],
  districts: [],
};
export interface FocusStatus {
  agentId: string;
  state: 'pending' | 'ok' | 'error';
  message: string;
}
interface StationState {
  world: World;
  connection: Connection;
  focusStatus: FocusStatus | null;
  setFocusStatus: (status: FocusStatus | null) => void;
  /** Local-model recommendations per repository id, kept for the page's lifetime. */
  recommendations: Record<string, RecommendationsResult>;
  setRecommendations: (repoId: string, result: RecommendationsResult) => void;
  setWorld: (world: World) => void;
  setConnection: (connection: Connection) => void;
  view: View;
  gallery: GalleryKind;
  tier: number;
  selection: Selection;
  reducedMotion: boolean;
  paused: boolean;
  clip: AnimationClip;
  focusRevision: number;
  select: (selection: Selection) => void;
  setView: (view: View) => void;
  setGallery: (gallery: GalleryKind) => void;
  setTier: (tier: number) => void;
  setClip: (clip: AnimationClip) => void;
  setReducedMotion: (value: boolean) => void;
  togglePaused: () => void;
  focus: () => void;
  nextAttention: () => void;
}

export const useStation = create<StationState>((set, get) => ({
  world: demoRequested() ? createDemoWorld() : EMPTY_WORLD,
  connection: demoRequested() ? 'demo' : 'offline',
  focusStatus: null,
  setFocusStatus: (focusStatus) => set({ focusStatus }),
  recommendations: {},
  setRecommendations: (repoId, result) =>
    set(({ recommendations }) => ({
      recommendations: { ...recommendations, [repoId]: result },
    })),
  setWorld: (world) =>
    set(({ selection }) => ({
      world,
      // Keep the selection while it still exists; repositories and sessions come and go.
      selection: exists(world, selection) ? selection : firstSelection(world),
    })),
  setConnection: (connection) => set({ connection }),
  view: 'sessions',
  gallery: 'characters',
  tier: 3,
  selection: demoRequested() ? { kind: 'agent', id: 'claude-1' } : null,
  reducedMotion:
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  paused: false,
  clip: 'idle',
  focusRevision: 0,
  select: (selection) => set({ selection }),
  setView: (view) => set({ view, focusRevision: 0 }),
  setGallery: (gallery) => set({ gallery, focusRevision: 0 }),
  setTier: (tier) => set({ tier }),
  setClip: (clip) => set({ clip }),
  setReducedMotion: (reducedMotion) => set({ reducedMotion }),
  togglePaused: () => set(({ paused }) => ({ paused: !paused })),
  focus: () =>
    set(({ focusRevision }) => ({ focusRevision: focusRevision + 1 })),
  nextAttention: () => {
    const { world, selection } = get();
    const attention = world.agents.filter(needsAttention);
    const index = attention.findIndex(
      (agent) => selection?.kind === 'agent' && agent.id === selection.id,
    );
    const next = attention[(index + 1) % attention.length];
    if (next)
      set(({ focusRevision }) => ({
        view: get().view === 'gallery' ? 'sessions' : get().view,
        selection: { kind: 'agent', id: next.id },
        focusRevision: focusRevision + 1,
      }));
  },
}));

/** A session needing an answer first, then any session, then the first repository. */
function firstSelection(world: World): Selection {
  const agent =
    world.agents.find(needsAttention) ??
    world.agents.find((agent) => agent.activity !== 'ended');
  if (agent) return { kind: 'agent', id: agent.id };
  return world.repos[0] ? { kind: 'repo', id: world.repos[0].id } : null;
}

function exists(world: World, selection: Selection): boolean {
  if (!selection) return false;
  return selection.kind === 'repo'
    ? world.repos.some((repo) => repo.id === selection.id)
    : world.agents.some((agent) => agent.id === selection.id);
}

export function selectedRepoId(
  world: World,
  selection: Selection,
): string | undefined {
  return selection?.kind === 'repo'
    ? selection.id
    : (world.agents.find((agent) => agent.id === selection?.id)?.repoId ??
        undefined);
}
