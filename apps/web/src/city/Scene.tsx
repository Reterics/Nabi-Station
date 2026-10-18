import { Component, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Canvas } from '@react-three/fiber';
import { PCFShadowMap } from 'three';
import { SceneLabel } from './SceneLabel';
import {
  characterKinds,
  clipForActivity,
  needsAttention,
} from '@nabi/protocol';
import { selectedRepoId, useStation } from '../state/store';
import { Building } from './Building';
import { Camera } from './Camera';
import { Character } from './Character';
import { cityLayout, type DistrictArea } from './layout';

class SceneBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="scene-fallback" role="alert">
        <h2>The city couldn’t start</h2>
        <p>
          Try a browser with WebGL 2 and hardware acceleration enabled.
          Repository details are still available in the panel.
        </p>
      </div>
    ) : (
      this.props.children
    );
  }
}

function usePageVisible() {
  const [visible, setVisible] = useState(!document.hidden);
  useEffect(() => {
    const update = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return visible;
}

function Tree({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.35, 0]} castShadow>
        <cylinderGeometry args={[0.08, 0.1, 0.7, 6]} />
        <meshStandardMaterial color="#8b7760" />
      </mesh>
      <mesh position={[0, 0.92, 0]} castShadow>
        <icosahedronGeometry args={[0.48, 0]} />
        <meshStandardMaterial color="#64786f" flatShading />
      </mesh>
    </group>
  );
}

const midpoints = (values: number[]) =>
  values.slice(1).map((value, index) => (values[index]! + value) / 2);

function District({ area }: { area: DistrictArea }) {
  const { centerX, centerZ, width, depth } = area;
  const roadsZ = midpoints(area.rows);
  const roadsX = midpoints(area.columns);
  const dashes = Array.from(
    { length: Math.max(0, Math.floor((width - 2) / 2)) },
    (_, index) => centerX - (width - 2) / 2 + 1 + index * 2,
  );
  return (
    <>
      <mesh receiveShadow position={[centerX, -0.18, centerZ]}>
        <boxGeometry args={[width, 0.35, depth]} />
        <meshStandardMaterial color="#687480" />
      </mesh>
      {roadsZ.map((z) => (
        <group key={`road-${z}`}>
          <mesh receiveShadow position={[centerX, 0.01, z]}>
            <boxGeometry args={[width - 1, 0.02, 1.25]} />
            <meshStandardMaterial color="#465261" />
          </mesh>
          {dashes.map((x) => (
            <mesh
              key={x}
              position={[x, 0.03, z]}
              rotation={[-Math.PI / 2, 0, 0]}
            >
              <planeGeometry args={[0.5, 0.05]} />
              <meshBasicMaterial color="#aebccc" />
            </mesh>
          ))}
        </group>
      ))}
      {roadsX.map((x) => (
        <mesh key={`lane-${x}`} receiveShadow position={[x, 0.01, centerZ]}>
          <boxGeometry args={[0.65, 0.025, depth - 1.2]} />
          <meshStandardMaterial color="#465261" />
        </mesh>
      ))}
      {[centerX - width / 2 + 0.95, centerX + width / 2 - 0.95].flatMap((x) =>
        area.rows.flatMap((row) =>
          [row - 1.4, row + 1.4].map((z) => (
            <Tree key={`${x}/${z}`} x={x} z={z} />
          )),
        ),
      )}
    </>
  );
}

function City({ paused }: { paused: boolean }) {
  const { world, selection, select } = useStation();
  const selected = selectedRepoId(world, selection);
  const layout = useMemo(() => cityLayout(world), [world]);
  const repos = useMemo(
    () => new Map(world.repos.map((repo) => [repo.id, repo])),
    [world],
  );
  return (
    <>
      {layout.districts.map((area) => (
        <District key={area.id} area={area} />
      ))}
      {world.districts
        .flatMap((district) => district.plots)
        .map((plot) => {
          const repo = repos.get(plot.repoId);
          if (!repo) return null;
          return (
            <group
              key={plot.id}
              position={[plot.position.x, 0.04, plot.position.z]}
              onClick={(event) => {
                if (event.delta > 4) return;
                event.stopPropagation();
                select({ kind: 'repo', id: repo.id });
              }}
            >
              <mesh position={[0, 0.02, 0]} receiveShadow>
                <boxGeometry args={[3.6, 0.08, 3.75]} />
                <meshStandardMaterial
                  color={selected === repo.id ? '#7faae4' : '#8995a3'}
                />
              </mesh>
              <Building
                spec={repo.building}
                active={world.agents.some((agent) => agent.repoId === repo.id)}
              />
              <SceneLabel
                position={[0, 0.15, -1.85]}
                center
                zIndexRange={[5, 0]}
              >
                <button
                  className={`plot-label ${selected === repo.id ? 'selected' : ''}`}
                  onClick={() => select({ kind: 'repo', id: repo.id })}
                >
                  {repo.name}
                </button>
              </SceneLabel>
            </group>
          );
        })}
      {world.agents.map((agent) => {
        const [x, z] = layout.agents.get(agent.id) ?? [0, 0];
        return (
          <group
            key={agent.id}
            position={[x, 0.13, z]}
            onClick={(event) => {
              if (event.delta > 4) return;
              event.stopPropagation();
              select({ kind: 'agent', id: agent.id });
            }}
          >
            <group scale={1.05}>
              <Character
                kind={agent.kind}
                clip={clipForActivity[agent.activity]}
                paused={paused}
              />
            </group>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]}>
              <ringGeometry args={[0.33, 0.39, 32]} />
              <meshBasicMaterial
                color={needsAttention(agent) ? '#e8b66a' : '#80aaff'}
              />
            </mesh>
            {needsAttention(agent) && (
              <SceneLabel position={[0, 1.35, 0]} center zIndexRange={[10, 6]}>
                <button
                  className="attention-bubble"
                  aria-label={`Inspect ${agent.name}`}
                  onClick={() => select({ kind: 'agent', id: agent.id })}
                >
                  ?
                </button>
              </SceneLabel>
            )}
          </group>
        );
      })}
    </>
  );
}

function Gallery({ paused }: { paused: boolean }) {
  const { world, gallery, clip, tier } = useStation();
  return (
    <>
      <mesh receiveShadow position={[0, -0.2, 0]}>
        <boxGeometry args={[17, 0.4, 12]} />
        <meshStandardMaterial color="#687480" />
      </mesh>
      {gallery === 'characters'
        ? characterKinds.map((kind, index) => (
            <group key={kind} position={[(index - 1) * 4, 0.05, 0]}>
              <mesh receiveShadow position={[0, 0.08, 0]}>
                <cylinderGeometry args={[1.35, 1.45, 0.16, 48]} />
                <meshStandardMaterial color="#a6b1c0" />
              </mesh>
              <group position={[0, 0.17, 0]} scale={2.4}>
                <Character kind={kind} clip={clip} paused={paused} />
              </group>
              <SceneLabel position={[0, 0.2, 1.85]} center>
                <span className="gallery-label">
                  {kind === 'claude-code'
                    ? 'Claude Code'
                    : kind === 'codex'
                      ? 'Codex'
                      : 'Generic'}
                  <small>{clip}</small>
                </span>
              </SceneLabel>
            </group>
          ))
        : world.repos.map((repo, index) => (
            <group
              key={repo.id}
              position={[((index % 3) - 1) * 4.5, 0.05, index < 3 ? -2.8 : 2.8]}
            >
              <Building spec={{ ...repo.building, tier }} active />
              <SceneLabel position={[0, 0.1, 1.8]} center>
                <span className="gallery-label">
                  {repo.building.archetype}
                  <small>Tier {tier}</small>
                </span>
              </SceneLabel>
            </group>
          ))}
    </>
  );
}

export function Scene() {
  const { view, paused, reducedMotion } = useStation();
  const visible = usePageVisible();
  return (
    <SceneBoundary>
      <Canvas
        orthographic
        shadows={{ type: PCFShadowMap }}
        frameloop="demand"
        dpr={[1, 2]}
        camera={{ position: [18, 18, 18], zoom: 40, near: 0.1, far: 150 }}
        gl={{ antialias: true, alpha: true }}
        fallback={
          <div className="scene-fallback">
            WebGL 2 is required to display the city.
          </div>
        }
      >
        <hemisphereLight args={['#edf2ff', '#576172', 2.5]} />
        <directionalLight
          position={[8, 15, 7]}
          intensity={3}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-12}
          shadow-camera-right={12}
          shadow-camera-top={12}
          shadow-camera-bottom={-12}
          shadow-normalBias={0.04}
        />
        <Camera />
        {view === 'city' ? (
          <City paused={paused || reducedMotion || !visible} />
        ) : (
          <Gallery paused={paused || reducedMotion || !visible} />
        )}
      </Canvas>
    </SceneBoundary>
  );
}
