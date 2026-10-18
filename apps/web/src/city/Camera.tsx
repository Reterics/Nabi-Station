import { useEffect, useMemo, useRef, type ComponentRef } from 'react';
import { MapControls } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { MOUSE, OrthographicCamera, Vector3 } from 'three';
import { selectedRepoId, useStation } from '../state/store';
import { cityLayout } from './layout';
import { sessionsLayout } from './sessionsLayout';

export function Camera() {
  const controls = useRef<ComponentRef<typeof MapControls>>(null);
  const { camera, size, invalidate } = useThree();
  const revision = useStation((s) => s.focusRevision);
  const view = useStation((s) => s.view);
  const gallery = useStation((s) => s.gallery);
  const world = useStation((s) => s.world);
  const layout = useMemo(
    () => (view === 'sessions' ? sessionsLayout(world) : cityLayout(world)),
    [view, world],
  );
  const { minX, maxX, minZ, maxZ } = layout.bounds;
  const fitted = view !== 'gallery';
  // 1 for the six-plot demo board (16.5 × 13); larger cities zoom out to fit.
  const span = fitted
    ? Math.max(1, (maxX - minX) / 16.5, (maxZ - minZ) / 13)
    : 1;
  // Sessions use the city's axes, so a stage's on-screen span is the ground
  // diagonal. Elevation squashes that (sin 35.26° ≈ 0.58); buildings need headroom.
  const screen = 'screen' in layout ? layout.screen : undefined;
  const screenSpan = screen ? (screen.width + screen.depth) / Math.SQRT2 : 0;
  const baseZoom =
    view === 'sessions' && screen
      ? Math.max(
          12,
          Math.min(
            size.width / (screenSpan + 2.4),
            size.height / (screenSpan * 0.58 + 3.5),
            110,
          ),
        )
      : Math.max(
          18 / span,
          Math.min(
            size.width /
              (view === 'gallery' && gallery === 'characters' ? 13 : 22 * span),
            size.height / (17 * span),
          ),
        );
  const centerX = screen ? screen.centerX : fitted ? (minX + maxX) / 2 : 0;
  const centerZ = screen ? screen.centerZ : fitted ? (minZ + maxZ) / 2 : 0;
  useEffect(() => {
    if (!(camera instanceof OrthographicCamera)) return;
    const { world, selection } = useStation.getState();
    let focus: [number, number] | undefined;
    if (selection?.kind === 'agent') focus = layout.agents.get(selection.id);
    if (!focus && view === 'sessions' && 'buildings' in layout) {
      const repoId = selectedRepoId(world, selection);
      focus = repoId ? layout.buildings.get(repoId) : undefined;
    }
    if (!focus) {
      const repoId = selectedRepoId(world, selection);
      const plot = world.districts
        .flatMap((district) => district.plots)
        .find((plot) => plot.repoId === repoId);
      if (plot) focus = [plot.position.x, plot.position.z];
    }
    const target =
      revision > 0 && fitted && focus
        ? new Vector3(focus[0], 0, focus[1])
        : new Vector3(centerX, 0, centerZ);
    camera.position.copy(target).add(new Vector3(18, 18, 18));
    camera.zoom = revision > 0 ? baseZoom * 1.5 : baseZoom;
    camera.lookAt(target);
    camera.updateProjectionMatrix();
    controls.current?.target.copy(target);
    controls.current?.update();
    invalidate();
    // `layout` is deliberately not a dependency: live updates must not yank the
    // camera; it re-centres on focus, view changes, or when the city grows.
  }, [baseZoom, camera, centerX, centerZ, gallery, invalidate, revision, view]);
  return (
    <MapControls
      ref={controls}
      makeDefault
      enableRotate={false}
      enableDamping={false}
      screenSpacePanning={false}
      minZoom={baseZoom * 0.25}
      maxZoom={baseZoom * 2}
      mouseButtons={{ LEFT: MOUSE.PAN, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN }}
    />
  );
}
