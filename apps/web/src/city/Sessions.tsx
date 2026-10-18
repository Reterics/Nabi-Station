import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { Mesh } from 'three';
import {
  characterForAgent,
  clipForActivity,
  needsAttention,
  type AgentNpc,
  type Helper,
} from '@nabi/protocol';
import { useStation } from '../state/store';
import { sessionLine, truncate } from '../panel/sessionLine';
import { Building } from './Building';
import { Character } from './Character';
import { HelperFigure, helperColors } from './Helper';
import { hashPick, Props, type PropItem } from './Props';
import { SceneLabel } from './SceneLabel';
import {
  helperKey,
  sessionsLayout,
  toWorld,
  type SessionSite,
} from './sessionsLayout';

/** A strip from session to helper, with a packet travelling along it while it works. */
function Link({
  from,
  to,
  color,
  active,
  paused,
}: {
  from: [number, number];
  to: [number, number];
  color: string;
  active: boolean;
  paused: boolean;
}) {
  const packet = useRef<Mesh>(null);
  const invalidate = useThree((state) => state.invalidate);
  const [dx, dz] = [to[0] - from[0], to[1] - from[1]];
  const length = Math.hypot(dx, dz);
  useFrame(({ clock }) => {
    if (!packet.current || !active || paused) return;
    const t = (clock.elapsedTime * 0.8) % 1;
    // Work flows out to the helper and results come back: ping-pong.
    const along = t < 0.5 ? t * 2 : 2 - t * 2;
    packet.current.position.set(
      from[0] + dx * along,
      0.2,
      from[1] + dz * along,
    );
    invalidate();
  });
  return (
    <>
      <mesh
        position={[(from[0] + to[0]) / 2, 0.075, (from[1] + to[1]) / 2]}
        rotation={[0, -Math.atan2(dz, dx), 0]}
      >
        <boxGeometry args={[length, 0.012, active ? 0.07 : 0.035]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={active ? 0.9 : 0.45}
        />
      </mesh>
      {active && (
        <mesh ref={packet} position={[from[0], 0.2, from[1]]}>
          <sphereGeometry args={[0.07, 10, 8]} />
          <meshBasicMaterial color={color} />
        </mesh>
      )}
    </>
  );
}

function HelperStation({
  agent,
  helper,
  position,
  origin,
  paused,
}: {
  agent: AgentNpc;
  helper: Helper;
  position: [number, number];
  origin: [number, number];
  paused: boolean;
}) {
  const select = useStation((state) => state.select);
  const engaged = helper.state === 'active' || helper.state === 'waiting';
  const color =
    helper.state === 'waiting' ? '#e8b66a' : helperColors[helper.category];
  return (
    <>
      {engaged && (
        <Link
          from={origin}
          to={position}
          color={color}
          active={helper.state === 'active'}
          paused={paused}
        />
      )}
      <group
        position={[position[0], 0.08, position[1]]}
        onClick={(event) => {
          if (event.delta > 4) return;
          event.stopPropagation();
          select({ kind: 'agent', id: agent.id });
        }}
      >
        <HelperFigure
          category={helper.category}
          state={helper.state}
          paused={paused}
        />
        {/* Under the figure, towards the camera: the arc's labels read as a row. */}
        <SceneLabel
          position={[0.4, 0, 0.4]}
          zIndexRange={helper.state === 'recent' ? [3, 0] : [8, 0]}
        >
          <span
            className={`helper-chip ${helper.state}`}
            data-helper={helper.category}
            style={{ ['--helper' as string]: helperColors[helper.category] }}
          >
            <i aria-hidden="true" />
            {helper.label}
            {helper.state === 'active' && helper.tool && (
              <small>{truncate(helper.tool, 28)}</small>
            )}
            {helper.state === 'waiting' && <small>awaiting approval</small>}
            {helper.state === 'failed' && <small>last call failed</small>}
          </span>
        </SceneLabel>
      </group>
    </>
  );
}

function SessionAgent({
  agent,
  position,
  helperSpots,
  selected,
  paused,
}: {
  agent: AgentNpc;
  position: [number, number];
  helperSpots: Map<string, [number, number]>;
  selected: boolean;
  paused: boolean;
}) {
  const select = useStation((state) => state.select);
  const helpers = agent.helpers ?? [];
  // Face the helper being waited on; otherwise face +Z, like a city resident.
  const engaged = helpers.find((helper) => helper.state === 'active');
  const target = engaged && helperSpots.get(helperKey(agent.id, engaged.id));
  const facing = target
    ? Math.atan2(target[0] - position[0], target[1] - position[1])
    : 0;
  const attention = needsAttention(agent);
  return (
    <>
      {helpers.map((helper) => {
        const spot = helperSpots.get(helperKey(agent.id, helper.id));
        return spot ? (
          <HelperStation
            key={helper.id}
            agent={agent}
            helper={helper}
            position={spot}
            origin={position}
            paused={paused}
          />
        ) : null;
      })}
      <group
        position={[position[0], 0.08, position[1]]}
        onClick={(event) => {
          if (event.delta > 4) return;
          event.stopPropagation();
          select({ kind: 'agent', id: agent.id });
        }}
      >
        <mesh position={[0, 0.03, 0]} receiveShadow>
          <cylinderGeometry args={[0.55, 0.6, 0.06, 28]} />
          <meshStandardMaterial color={selected ? '#7faae4' : '#76828f'} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.065, 0]}>
          <ringGeometry args={[0.47, 0.55, 36]} />
          <meshBasicMaterial
            color={
              attention
                ? '#e8b66a'
                : agent.activity === 'idle'
                  ? '#8a94a1'
                  : '#80aaff'
            }
          />
        </mesh>
        <group position={[0, 0.06, 0]} rotation={[0, facing, 0]} scale={1.6}>
          <Character
            kind={characterForAgent(agent.kind)}
            clip={clipForActivity[agent.activity]}
            paused={paused}
          />
        </group>
        <SceneLabel position={[0, 1.75, 0]} zIndexRange={[12, 6]}>
          <button
            className={`session-bubble ${attention ? 'attention' : agent.activity}`}
            onClick={() => select({ kind: 'agent', id: agent.id })}
            aria-label={`Inspect ${agent.name}`}
          >
            <strong>{agent.name}</strong>
            <span>{truncate(sessionLine(agent), 64)}</span>
          </button>
        </SceneLabel>
      </group>
    </>
  );
}

function Site({
  site,
  building,
  agents,
  helpers,
  paused,
}: {
  site: SessionSite;
  building: [number, number];
  agents: Map<string, [number, number]>;
  helpers: Map<string, [number, number]>;
  paused: boolean;
}) {
  const { selection, select } = useStation();
  const busy = site.agents.some(
    (agent) => !['idle', 'ended'].includes(agent.activity),
  );
  const [plateX, plateZ] = toWorld(
    -site.width / 2 + 1.5,
    -site.depth / 2 - 0.35,
  );
  return (
    <group>
      {/* Axis-aligned, so the isometric camera shows the same corner as the city. */}
      <group position={[site.centerX, 0, site.centerZ]}>
        <mesh receiveShadow position={[0, -0.15, 0]}>
          <boxGeometry args={[site.width, 0.3, site.depth]} />
          <meshStandardMaterial color="#687480" />
        </mesh>
        {/* A plaza: paving, planted edges, and a path up to the entrance. */}
        <mesh receiveShadow position={[0, 0.01, 0]}>
          <boxGeometry args={[site.width - 0.6, 0.02, site.depth - 0.6]} />
          <meshStandardMaterial color="#9aa4ae" roughness={0.85} />
        </mesh>
        {[-1, 1].map((side) => (
          <mesh
            key={side}
            receiveShadow
            position={[side * (site.width / 2 - 0.55), 0.035, -0.6]}
          >
            <boxGeometry args={[0.5, 0.05, site.depth - 2.4]} />
            <meshStandardMaterial color="#6f9e63" roughness={1} />
          </mesh>
        ))}
        <mesh receiveShadow position={[0, 0.03, site.depth / 4 - 0.6]}>
          <boxGeometry args={[1.1, 0.02, site.depth / 2 + 0.6]} />
          <meshStandardMaterial color="#c3c8cc" roughness={0.7} />
        </mesh>
      </group>
      {site.repo ? (
        <group
          position={[building[0], 0.02, building[1]]}
          scale={0.95}
          onClick={(event) => {
            if (event.delta > 4) return;
            event.stopPropagation();
            select({ kind: 'repo', id: site.repo!.id });
          }}
        >
          <Building spec={site.repo.building} active={busy} />
        </group>
      ) : (
        // A folder outside the scanned repositories: a bare workbench, no invented building.
        <mesh position={[building[0], 0.2, building[1]]} castShadow>
          <boxGeometry args={[2.2, 0.36, 1.1]} />
          <meshStandardMaterial color="#8b7760" flatShading />
        </mesh>
      )}
      {site.agents.map((agent) => (
        <SessionAgent
          key={agent.id}
          agent={agent}
          position={agents.get(agent.id) ?? [site.centerX, site.centerZ]}
          helperSpots={helpers}
          selected={selection?.kind === 'agent' && selection.id === agent.id}
          paused={paused}
        />
      ))}
      <SceneLabel
        // At the far corner of the stage, above it on screen and clear of the
        // speech bubbles and of the helpers in front of the agents.
        position={[site.centerX + plateX, 0.1, site.centerZ + plateZ]}
        zIndexRange={[5, 0]}
      >
        <button
          className="site-label"
          onClick={() =>
            site.repo
              ? select({ kind: 'repo', id: site.repo.id })
              : select({ kind: 'agent', id: site.agents[0]!.id })
          }
        >
          <strong>{site.title}</strong>
          <small>
            {site.repo
              ? `${site.repo.git.branch} · ${site.repo.git.modified} modified`
              : 'Outside scanned repositories'}
          </small>
        </button>
      </SceneLabel>
    </group>
  );
}

/**
 * Lamps on the corners, trees in the back corners, planters and benches along the
 * edges: furniture placed clear of the building, the agents and their helpers.
 */
function plazaProps(site: SessionSite): PropItem[] {
  const u = site.width / 2;
  const v = site.depth / 2;
  const at = (du: number, dv: number) => {
    const [x, z] = toWorld(du, dv);
    return { x: site.centerX + x, z: site.centerZ + z };
  };
  const items: PropItem[] = [];
  for (const su of [-1, 1]) {
    for (const sv of [-1, 1])
      items.push({
        kind: 'lamp',
        ...at(su * (u - 0.35), sv * (v - 0.35)),
        rotation: su > 0 ? Math.PI : 0,
      });
    items.push(
      {
        kind: hashPick(`${site.id}${su}`, ['tree', 'pine', 'poplar'] as const),
        ...at(su * (u - 0.55), -v + 0.9),
        scale: 1.1,
      },
      {
        kind: hashPick(`${site.id}${su}b`, ['tree', 'poplar'] as const),
        ...at(su * (u - 0.55), -0.9),
        scale: 0.9,
      },
      { kind: 'shrub', ...at(su * (u - 0.55), 0.6) },
      {
        kind: 'bench',
        ...at(su * (u - 0.55), v - 1.1),
        rotation: (su * Math.PI) / 2,
      },
      { kind: 'planter', ...at(su * 0.85, v - 0.45) },
    );
  }
  return items;
}

export function Sessions({ paused }: { paused: boolean }) {
  const world = useStation((state) => state.world);
  const layout = useMemo(() => sessionsLayout(world), [world]);
  const props = useMemo(() => layout.sites.flatMap(plazaProps), [layout]);
  return (
    <>
      <Props items={props} />
      {layout.sites.map((site) => (
        <Site
          key={site.id}
          site={site}
          building={layout.buildings.get(site.id)!}
          agents={layout.agents}
          helpers={layout.helpers}
          paused={paused}
        />
      ))}
    </>
  );
}
