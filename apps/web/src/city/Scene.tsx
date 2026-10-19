import { Component, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Canvas } from '@react-three/fiber';
import { PCFSoftShadowMap } from 'three';
import { Lighting } from './Lighting';
import {
  carColours,
  flowerColours,
  hashPick,
  Props,
  type PropItem,
} from './Props';
import { sessionsLayout } from './sessionsLayout';
import { SceneLabel } from './SceneLabel';
import { seedFromString } from '@nabi/building-gen';
import {
  archetypes,
  buildingModules,
  characterForAgent,
  characterKinds,
  helperCategories,
  helperCategoryNames,
  maturities,
  maturityNames,
  needsAttention,
} from '@nabi/protocol';
import { agentKindName } from '../panel/sessionLine';
import { selectedRepoId, useStation } from '../state/store';
import { Building } from './Building';
import { Camera } from './Camera';
import { Effects } from './Effects';
import { AgentCharacter, Character } from './Character';
import { HelperFigure } from './Helper';
import { cityLayout, type DistrictArea } from './layout';
import { Sessions } from './Sessions';

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

const midpoints = (values: number[]) =>
  values.slice(1).map((value, index) => (values[index]! + value) / 2);

/** Street lamps and parked cars along the roads, mixed trees along the edges. */
function districtProps(area: DistrictArea): PropItem[] {
  const { centerX, width } = area;
  const items: PropItem[] = [];
  for (const road of midpoints(area.rows)) {
    for (
      let x = centerX - width / 2 + 1.2;
      x < centerX + width / 2 - 1;
      x += 2.3
    ) {
      items.push(
        { kind: 'lamp', x, z: road - 0.78, rotation: -Math.PI / 2 },
        { kind: 'lamp', x: x + 1.15, z: road + 0.78, rotation: Math.PI / 2 },
      );
      const key = `${area.id}/${x.toFixed(1)}/${road}`;
      const kerbside = hashPick(`${key}k`, [
        'bin',
        'hydrant',
        'bin',
        null,
      ] as const);
      if (kerbside)
        items.push({
          kind: kerbside,
          x: x + 0.55,
          z: road + (kerbside === 'bin' ? -0.85 : 0.85),
        });
      if (hashPick(key, [true, false, false]))
        items.push({
          kind: 'car',
          x: x + 0.6,
          z: road + 0.33,
          color: hashPick(`${key}c`, carColours),
        });
      if (hashPick(`${key}w`, [true, false, false, false]))
        items.push({
          kind: 'car',
          x: x - 0.4,
          z: road - 0.33,
          rotation: Math.PI,
          color: hashPick(`${key}d`, carColours),
        });
    }
  }
  for (const x of [centerX - width / 2 + 0.95, centerX + width / 2 - 0.95])
    for (const row of area.rows)
      for (const z of [row - 1.4, row + 1.4])
        items.push({
          kind: hashPick(`${x}/${z}`, [
            'tree',
            'pine',
            'poplar',
            'tree',
          ] as const),
          x,
          z,
          scale: hashPick(`${x}/${z}s`, [0.9, 1, 1.15]),
        });
  // Zebra crossings where the lanes between columns meet a road, either side.
  for (const road of midpoints(area.rows))
    for (const lane of midpoints(area.columns))
      for (const side of [-1, 1])
        items.push({ kind: 'crosswalk', x: lane + side * 0.6, z: road });
  return items;
}

/**
 * Lawn dressing on each plot: flower beds either side of the entrance path and
 * hedges along the back corners, clear of the widest foundations (3.4 × 3.1).
 */
function plotProps(x: number, z: number, key: string): PropItem[] {
  const items: PropItem[] = [];
  /** Top of the lawn (plot group at 0.04, lawn slab to 0.075). */
  const y = 0.115;
  for (const side of [-1, 1]) {
    items.push(
      {
        kind: 'flowers',
        x: x + side * 1.45,
        y,
        z: z + 1.68,
        color: hashPick(`${key}${side}f`, flowerColours),
      },
      {
        kind: 'hedge',
        x: x + side * 1.3,
        y,
        z: z - 1.72,
        scale: hashPick(`${key}${side}h`, [0.8, 1, 1.1]),
      },
    );
    if (hashPick(`${key}${side}b`, [true, false]))
      items.push({ kind: 'bollard', x: x + side * 0.45, y, z: z + 1.78 });
  }
  return items;
}

/** Tended lawns for repositories in use, drier ones for those left alone. */
const lawnColour = (activity?: string) =>
  activity === 'dormant'
    ? '#9aa37a'
    : activity === 'quiet'
      ? '#86a466'
      : '#74a65f';

function District({ area }: { area: DistrictArea }) {
  const { centerX, centerZ, width, depth } = area;
  const roadsZ = midpoints(area.rows);
  const roadsX = midpoints(area.columns);
  const dashes = Array.from(
    { length: Math.max(0, Math.floor((width - 2) / 2)) },
    (_, index) => centerX - (width - 2) / 2 + 1 + index * 2,
  );
  const props = useMemo(() => districtProps(area), [area]);
  return (
    <>
      <Props items={props} />
      <mesh receiveShadow position={[centerX, -0.18, centerZ]}>
        <boxGeometry args={[width, 0.35, depth]} />
        <meshStandardMaterial color="#7d8a83" roughness={0.95} />
      </mesh>
      {roadsZ.map((z) => (
        <group key={`road-${z}`}>
          {[-1, 1].map((side) => (
            <mesh
              key={side}
              receiveShadow
              position={[centerX, 0.025, z + side * 0.8]}
            >
              <boxGeometry args={[width - 1, 0.05, 0.35]} />
              <meshStandardMaterial color="#c9ccc8" roughness={0.85} />
            </mesh>
          ))}
          <mesh receiveShadow position={[centerX, 0.01, z]}>
            <boxGeometry args={[width - 1, 0.02, 1.25]} />
            <meshStandardMaterial color="#3d4550" roughness={0.9} />
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
  const lawns = useMemo(
    () =>
      world.districts
        .flatMap((district) => district.plots)
        .flatMap((plot) =>
          plotProps(plot.position.x, plot.position.z, plot.id),
        ),
    [world],
  );
  return (
    <>
      <Props items={lawns} />
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
              {/* A kerbed plot: lawn, with a paved path from the street to the door. */}
              <mesh position={[0, 0.02, 0]} receiveShadow>
                <boxGeometry args={[3.6, 0.08, 3.75]} />
                <meshStandardMaterial
                  color={selected === repo.id ? '#7faae4' : '#c9cdc8'}
                  roughness={0.85}
                />
              </mesh>
              <mesh position={[0, 0.065, 0]} receiveShadow>
                <boxGeometry args={[3.36, 0.02, 3.51]} />
                <meshStandardMaterial
                  color={lawnColour(repo.building.activity)}
                  roughness={1}
                />
              </mesh>
              <mesh position={[0, 0.08, 1.45]} receiveShadow>
                <boxGeometry args={[0.7, 0.02, 0.85]} />
                <meshStandardMaterial color="#d8d4ca" roughness={0.8} />
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
              <AgentCharacter
                kind={characterForAgent(agent.kind)}
                activity={agent.activity}
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
  const { gallery, clip, tier } = useStation();
  return (
    <>
      <mesh receiveShadow position={[0, -0.2, 0]}>
        <boxGeometry args={[17, 0.4, 12]} />
        <meshStandardMaterial color="#687480" />
      </mesh>
      {gallery === 'helpers'
        ? helperCategories.map((category, index) => (
            <group
              key={category}
              position={[
                ((index % 5) - 2) * 3.1,
                0.05,
                (Math.floor(index / 5) - 1) * 3.4,
              ]}
            >
              <group scale={2}>
                <HelperFigure
                  category={category}
                  state="active"
                  paused={paused}
                />
              </group>
              <SceneLabel position={[0, 0.2, 1.05]} center>
                <span className="gallery-label">
                  {helperCategoryNames[category]}
                  <small>{category}</small>
                </span>
              </SceneLabel>
            </group>
          ))
        : gallery === 'characters'
          ? characterKinds.map((kind, index) => (
              <group
                key={kind}
                position={[
                  (index - (characterKinds.length - 1) / 2) * 4,
                  0.05,
                  0,
                ]}
              >
                <mesh receiveShadow position={[0, 0.08, 0]}>
                  <cylinderGeometry args={[1.35, 1.45, 0.16, 48]} />
                  <meshStandardMaterial color="#a6b1c0" />
                </mesh>
                <group position={[0, 0.17, 0]} scale={2.4}>
                  <Character kind={kind} clip={clip} paused={paused} />
                </group>
                <SceneLabel position={[0, 0.2, 1.85]} center>
                  <span className="gallery-label">
                    {agentKindName(kind)}
                    <small>{clip}</small>
                  </span>
                </SceneLabel>
              </group>
            ))
          : // A fixed showcase, one per archetype: live workspaces can have dozens of
            // repositories. The slider sets tier and maturity together.
            archetypes.map((archetype, index) => (
              <group
                key={archetype}
                position={[
                  ((index % 4) - 1.5) * 4,
                  0.05,
                  index < 4 ? -2.8 : 2.8,
                ]}
              >
                <Building
                  spec={{
                    archetype,
                    tier,
                    maturity: maturities[tier],
                    activity: 'active',
                    seed: seedFromString(archetype),
                    footprint: 1 + (index % 2),
                    modules: [...buildingModules],
                  }}
                  active
                />
                <SceneLabel position={[0, 0.1, 1.8]} center>
                  <span className="gallery-label">
                    {archetype}
                    <small>{maturityNames[maturities[tier]!]}</small>
                  </span>
                </SceneLabel>
              </group>
            ))}
    </>
  );
}

/** Lights fitted to what the current view shows. */
function ViewLighting() {
  const view = useStation((state) => state.view);
  const world = useStation((state) => state.world);
  const bounds = useMemo(
    () =>
      view === 'sessions'
        ? sessionsLayout(world).bounds
        : view === 'city'
          ? cityLayout(world).bounds
          : { minX: -8.5, maxX: 8.5, minZ: -6, maxZ: 6 },
    [view, world],
  );
  return <Lighting bounds={bounds} />;
}

export function Scene() {
  const { view, paused, reducedMotion } = useStation();
  const visible = usePageVisible();
  return (
    <SceneBoundary>
      <Canvas
        orthographic
        shadows={{ type: PCFSoftShadowMap }}
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
        <ViewLighting />
        <Camera />
        <Effects />
        {view === 'sessions' ? (
          <Sessions paused={paused || reducedMotion || !visible} />
        ) : view === 'city' ? (
          <City paused={paused || reducedMotion || !visible} />
        ) : (
          <Gallery paused={paused || reducedMotion || !visible} />
        )}
      </Canvas>
    </SceneBoundary>
  );
}
