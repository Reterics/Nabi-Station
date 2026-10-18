import { useEffect, useRef, type ReactNode } from 'react';
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

/** Labels sit above the canvas. A wheel over one would otherwise never
 * reach MapControls, so zoom dies while the pointer is on a name. */
function forwardWheelToCanvas(event: WheelEvent) {
  const overlay = event.currentTarget;
  if (!(overlay instanceof HTMLElement)) return;
  const canvas = overlay.parentElement?.querySelector('canvas');
  if (!canvas) return;
  event.preventDefault();
  canvas.dispatchEvent(
    new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: event.clientX,
      clientY: event.clientY,
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      deltaZ: event.deltaZ,
      deltaMode: event.deltaMode,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
    }),
  );
}

export function SceneLabels() {
  const labels = useLabels((state) => state.labels);
  const overlay = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = overlay.current;
    if (!node) return;
    node.addEventListener('wheel', forwardWheelToCanvas, { passive: false });
    return () => node.removeEventListener('wheel', forwardWheelToCanvas);
  }, []);
  return (
    <div className="scene-labels" ref={overlay}>
      {Object.values(labels)}
    </div>
  );
}
