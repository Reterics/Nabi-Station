import type { ReactNode } from 'react';
import { create } from 'zustand';

interface LabelState {
  labels: Record<string, ReactNode>;
  put: (id: string, node: ReactNode) => void;
  remove: (id: string) => void;
}

export const useLabels = create<LabelState>((set) => ({
  labels: {},
  put: (id, node) =>
    set((state) => ({ labels: { ...state.labels, [id]: node } })),
  remove: (id) =>
    set((state) => {
      const labels = { ...state.labels };
      delete labels[id];
      return { labels };
    }),
}));

export function SceneLabels() {
  const labels = useLabels((state) => state.labels);
  return <div className="scene-labels">{Object.values(labels)}</div>;
}
