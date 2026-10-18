import {
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Group, Vector3 } from 'three';
import { useLabels } from './LabelLayer';

/** Labels live in the app's one DOM root; the scene only projects their positions.
 * This avoids the competing React roots in drei Html (pmndrs/drei#2867).
 * Per-frame positions update DOM refs, never React state.
 */
export function SceneLabel({
  children,
  position = [0, 0, 0],
  zIndexRange = [10, 0],
}: {
  children: ReactNode;
  position?: [number, number, number];
  center?: boolean;
  zIndexRange?: [number, number];
}) {
  const id = useId();
  const group = useRef<Group>(null);
  const element = useRef<HTMLDivElement | null>(null);
  const projected = useMemo(() => new Vector3(), []);
  const invalidate = useThree((state) => state.invalidate);
  const attach = useCallback(
    (node: HTMLDivElement | null) => {
      element.current = node;
      if (node) invalidate();
    },
    [invalidate],
  );
  const zIndex = zIndexRange[0];
  useLayoutEffect(() => {
    useLabels.getState().put(
      id,
      <div key={id} ref={attach} className="scene-label" style={{ zIndex }}>
        {children}
      </div>,
    );
    return () => useLabels.getState().remove(id);
  }, [attach, children, id, zIndex]);
  useFrame(({ camera, size }) => {
    if (!group.current || !element.current) return;
    group.current.getWorldPosition(projected).project(camera);
    element.current.style.display =
      projected.z > 1 || projected.z < -1 ? 'none' : '';
    element.current.style.transform = `translate(${((projected.x + 1) * size.width) / 2}px, ${((-projected.y + 1) * size.height) / 2}px) translate(-50%, -50%)`;
  });
  return <group ref={group} position={position} />;
}
