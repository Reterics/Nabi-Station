import {
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
  type RefObject,
} from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Color, type Group } from 'three';
import type { HelperCategory, HelperState } from '@nabi/protocol';
import { Character } from './Character';

/** One colour per category; also used by the DOM chips in the panel. */
export const helperColors: Record<HelperCategory, string> = {
  '3d': '#f08a3c',
  media: '#e2609c',
  design: '#b07cf0',
  browser: '#4f9df2',
  web: '#3fbfb0',
  database: '#58b86a',
  ide: '#6f7ff0',
  'code-host': '#9a7fd6',
  docs: '#e3c27a',
  cloud: '#7cc4f2',
  comms: '#f2cf4f',
  subagent: '#c8ced8',
  tool: '#9aa5b3',
};

const stateRing: Record<HelperState, string> = {
  active: '',
  waiting: '#e8b66a',
  failed: '#e0605a',
  recent: '#6f7a88',
};

type Motion = 'spin' | 'swing' | 'bob' | 'blink' | 'roll';
const motions: Record<HelperCategory, Motion> = {
  '3d': 'spin',
  media: 'swing',
  design: 'swing',
  browser: 'spin',
  web: 'spin',
  database: 'bob',
  ide: 'blink',
  'code-host': 'spin',
  docs: 'swing',
  cloud: 'bob',
  comms: 'swing',
  subagent: 'bob',
  tool: 'roll',
};

function Part({
  children,
  color,
  position,
  rotation,
  glow = false,
  wireframe = false,
}: {
  children: ReactNode;
  color: string;
  position?: [number, number, number];
  rotation?: [number, number, number];
  glow?: boolean;
  wireframe?: boolean;
}) {
  return (
    <mesh position={position} rotation={rotation} castShadow>
      {children}
      <meshStandardMaterial
        color={color}
        roughness={0.7}
        flatShading
        wireframe={wireframe}
        emissive={glow ? color : '#000000'}
        emissiveIntensity={glow ? 0.55 : 0}
      />
    </mesh>
  );
}

/**
 * A procedural figure per category, so a 3D tool, a media generator and a database
 * read differently at a glance. The moving part (`emblem`) animates while active.
 * Geometry is local to `/helpers/<category>` and can be replaced by a GLB later.
 */
function Figure({
  category,
  color,
  dark,
  glow,
  emblem,
}: {
  category: HelperCategory;
  color: string;
  dark: string;
  glow: boolean;
  emblem: RefObject<Group | null>;
}) {
  switch (category) {
    case '3d':
      return (
        <>
          <Part color={dark} position={[0, 0.25, 0]}>
            <cylinderGeometry args={[0.08, 0.13, 0.32, 6]} />
          </Part>
          <group ref={emblem} position={[0, 0.62, 0]}>
            <Part color={color} glow={glow}>
              <icosahedronGeometry args={[0.2, 0]} />
            </Part>
            <Part color={color} rotation={[Math.PI / 2.4, 0, 0]} glow={glow}>
              <torusGeometry args={[0.31, 0.016, 6, 32]} />
            </Part>
          </group>
        </>
      );
    case 'media':
      return (
        <>
          {[0, (2 * Math.PI) / 3, (4 * Math.PI) / 3].map((angle) => (
            <Part
              key={angle}
              color={dark}
              position={[Math.sin(angle) * 0.12, 0.25, Math.cos(angle) * 0.12]}
              rotation={[Math.cos(angle) * 0.35, 0, -Math.sin(angle) * 0.35]}
            >
              <cylinderGeometry args={[0.018, 0.018, 0.5, 5]} />
            </Part>
          ))}
          <group ref={emblem} position={[0, 0.58, 0]}>
            <Part color={color}>
              <boxGeometry args={[0.36, 0.22, 0.22]} />
            </Part>
            <Part
              color={dark}
              position={[0, 0, 0.17]}
              rotation={[Math.PI / 2, 0, 0]}
            >
              <cylinderGeometry args={[0.08, 0.09, 0.14, 12]} />
            </Part>
            <Part color="#ffffff" position={[0, 0, 0.245]} glow={glow}>
              <sphereGeometry args={[0.05, 10, 8]} />
            </Part>
            <Part color={dark} position={[-0.08, 0.16, 0]}>
              <cylinderGeometry args={[0.07, 0.07, 0.08, 10]} />
            </Part>
          </group>
        </>
      );
    case 'design':
      return (
        <>
          <Part
            color={dark}
            position={[-0.13, 0.32, 0]}
            rotation={[0, 0, 0.12]}
          >
            <boxGeometry args={[0.03, 0.62, 0.03]} />
          </Part>
          <Part
            color={dark}
            position={[0.13, 0.32, 0]}
            rotation={[0, 0, -0.12]}
          >
            <boxGeometry args={[0.03, 0.62, 0.03]} />
          </Part>
          <Part
            color="#f4f1ea"
            position={[0, 0.5, 0.03]}
            rotation={[-0.12, 0, 0]}
          >
            <boxGeometry args={[0.46, 0.4, 0.025]} />
          </Part>
          {['#e2609c', '#4f9df2', '#f2cf4f'].map((swatch, index) => (
            <Part
              key={swatch}
              color={swatch}
              position={[-0.12 + index * 0.12, 0.5, 0.06]}
              glow={glow}
            >
              <sphereGeometry args={[0.045, 8, 6]} />
            </Part>
          ))}
          <group ref={emblem} position={[0.2, 0.42, 0.12]}>
            <Part color={color} rotation={[0, 0, 0.6]}>
              <cylinderGeometry args={[0.015, 0.02, 0.3, 5]} />
            </Part>
          </group>
        </>
      );
    case 'browser':
      return (
        <>
          <Part color={dark} position={[0, 0.2, 0]}>
            <boxGeometry args={[0.05, 0.3, 0.05]} />
          </Part>
          <Part color={dark} position={[0, 0.52, 0]}>
            <boxGeometry args={[0.56, 0.38, 0.05]} />
          </Part>
          <Part color={color} position={[0, 0.52, 0.03]} glow={glow}>
            <boxGeometry args={[0.5, 0.32, 0.01]} />
          </Part>
          <Part color="#ffffff" position={[0, 0.66, 0.035]}>
            <boxGeometry args={[0.5, 0.04, 0.01]} />
          </Part>
          <group ref={emblem} position={[0, 0.5, 0.15]}>
            <Part color="#ffffff" wireframe>
              <sphereGeometry args={[0.11, 10, 8]} />
            </Part>
          </group>
        </>
      );
    case 'web':
      return (
        <>
          <Part color={dark} position={[0, 0.3, 0]}>
            <cylinderGeometry args={[0.025, 0.04, 0.6, 6]} />
          </Part>
          <group ref={emblem} position={[0, 0.58, 0]}>
            <Part color={color} rotation={[-0.9, 0, 0]} glow={glow}>
              <sphereGeometry args={[0.24, 14, 6, 0, Math.PI * 2, 0, 1.0]} />
            </Part>
            <Part
              color={dark}
              position={[0, 0.07, 0.07]}
              rotation={[0.7, 0, 0]}
            >
              <cylinderGeometry args={[0.01, 0.01, 0.2, 4]} />
            </Part>
            <Part color="#ffffff" position={[0, 0.15, 0.15]} glow={glow}>
              <sphereGeometry args={[0.03, 8, 6]} />
            </Part>
          </group>
        </>
      );
    case 'database':
      return (
        <group ref={emblem}>
          {[0.18, 0.36, 0.54].map((y, index) => (
            <Part
              key={y}
              color={index === 2 ? color : dark}
              position={[0, y, 0]}
              glow={glow && index === 2}
            >
              <cylinderGeometry args={[0.22, 0.22, 0.14, 18]} />
            </Part>
          ))}
          {[0.18, 0.36, 0.54].map((y) => (
            <Part key={y} color={color} position={[0, y, 0]} glow={glow}>
              <torusGeometry args={[0.222, 0.012, 4, 24]} />
            </Part>
          ))}
        </group>
      );
    case 'ide':
      return (
        <>
          <Part color={dark} position={[0, 0.16, 0]}>
            <boxGeometry args={[0.6, 0.06, 0.34]} />
          </Part>
          <Part color={dark} position={[0, 0.48, -0.1]}>
            <boxGeometry args={[0.64, 0.4, 0.04]} />
          </Part>
          <Part color="#1d2230" position={[0, 0.48, -0.075]}>
            <boxGeometry args={[0.58, 0.34, 0.01]} />
          </Part>
          {[0.3, 0.2, 0.36, 0.14].map((width, index) => (
            <Part
              key={index}
              color={index % 2 ? '#e3c27a' : color}
              position={[
                -0.2 + width / 2 + (index === 2 ? 0.06 : 0),
                0.6 - index * 0.07,
                -0.065,
              ]}
              glow={glow}
            >
              <boxGeometry args={[width, 0.03, 0.005]} />
            </Part>
          ))}
          <group ref={emblem} position={[0.08, 0.32, -0.065]}>
            <Part color="#ffffff" glow={glow}>
              <boxGeometry args={[0.025, 0.05, 0.005]} />
            </Part>
          </group>
        </>
      );
    case 'code-host':
      return (
        <group ref={emblem}>
          <Part color={dark} position={[0, 0.38, 0]}>
            <cylinderGeometry args={[0.03, 0.03, 0.6, 6]} />
          </Part>
          <Part color={dark} position={[0.1, 0.46, 0]} rotation={[0, 0, -0.6]}>
            <cylinderGeometry args={[0.025, 0.025, 0.26, 6]} />
          </Part>
          {(
            [
              [0, 0.12],
              [0, 0.4],
              [0, 0.68],
              [0.18, 0.58],
            ] as const
          ).map(([x, y]) => (
            <Part
              key={`${x}/${y}`}
              color={color}
              position={[x, y, 0]}
              glow={glow}
            >
              <sphereGeometry args={[0.07, 10, 8]} />
            </Part>
          ))}
        </group>
      );
    case 'docs':
      return (
        <>
          {['#7c6a55', color, '#6f8fae'].map((cover, index) => (
            <Part
              key={cover}
              color={cover}
              position={[0, 0.12 + index * 0.09, 0]}
              rotation={[0, index * 0.25, 0]}
            >
              <boxGeometry args={[0.42, 0.08, 0.3]} />
            </Part>
          ))}
          <Part
            color="#f4f1ea"
            position={[-0.1, 0.42, 0]}
            rotation={[0, 0, 0.25]}
          >
            <boxGeometry args={[0.22, 0.015, 0.28]} />
          </Part>
          <group ref={emblem} position={[0, 0.42, 0]}>
            <Part
              color="#ffffff"
              position={[0.1, 0, 0]}
              rotation={[0, 0, -0.25]}
              glow={glow}
            >
              <boxGeometry args={[0.22, 0.015, 0.28]} />
            </Part>
          </group>
        </>
      );
    case 'cloud':
      return (
        <>
          <Part color={dark} position={[0, 0.17, 0]}>
            <boxGeometry args={[0.3, 0.2, 0.26]} />
          </Part>
          {[0.13, 0.2].map((y) => (
            <Part key={y} color={color} position={[0.08, y, 0.135]} glow={glow}>
              <boxGeometry args={[0.06, 0.02, 0.005]} />
            </Part>
          ))}
          <group ref={emblem} position={[0, 0.58, 0]}>
            {(
              [
                [-0.14, 0, 0.13],
                [0.02, 0.06, 0.17],
                [0.17, -0.01, 0.12],
                [0.02, -0.04, 0.13],
              ] as const
            ).map(([x, y, radius]) => (
              <Part
                key={`${x}/${y}`}
                color="#f4f7fb"
                position={[x, y, 0]}
                glow={glow}
              >
                <icosahedronGeometry args={[radius, 1]} />
              </Part>
            ))}
          </group>
        </>
      );
    case 'comms':
      return (
        <>
          <Part color={dark} position={[0, 0.22, 0]}>
            <boxGeometry args={[0.05, 0.42, 0.05]} />
          </Part>
          <Part color={color} position={[0, 0.5, 0]}>
            <boxGeometry args={[0.24, 0.2, 0.36]} />
          </Part>
          <Part
            color={color}
            position={[0, 0.6, 0]}
            rotation={[Math.PI / 2, 0, 0]}
          >
            <cylinderGeometry
              args={[0.12, 0.12, 0.36, 12, 1, false, 0, Math.PI]}
            />
          </Part>
          <group ref={emblem} position={[0.13, 0.5, -0.1]}>
            <Part color="#e0605a" position={[0, 0.14, 0]} glow={glow}>
              <boxGeometry args={[0.02, 0.28, 0.02]} />
            </Part>
            <Part color="#e0605a" position={[0, 0.24, 0.06]} glow={glow}>
              <boxGeometry args={[0.02, 0.08, 0.12]} />
            </Part>
          </group>
        </>
      );
    case 'subagent':
      return null;
    case 'tool':
      return (
        <>
          <Part color={dark} position={[0, 0.2, 0]}>
            <boxGeometry args={[0.06, 0.3, 0.06]} />
          </Part>
          <group ref={emblem} position={[0, 0.52, 0]}>
            <Part color={color} glow={glow}>
              <torusGeometry args={[0.16, 0.05, 6, 16]} />
            </Part>
            {Array.from({ length: 8 }, (_, index) => (index * Math.PI) / 4).map(
              (angle) => (
                <Part
                  key={angle}
                  color={color}
                  position={[Math.cos(angle) * 0.23, Math.sin(angle) * 0.23, 0]}
                  rotation={[0, 0, angle]}
                >
                  <boxGeometry args={[0.07, 0.06, 0.08]} />
                </Part>
              ),
            )}
          </group>
        </>
      );
  }
}

export function HelperFigure({
  category,
  state,
  paused,
}: {
  category: HelperCategory;
  state: HelperState;
  paused: boolean;
}) {
  const emblem = useRef<Group>(null);
  const invalidate = useThree((three) => three.invalidate);
  const active = state === 'active';
  const [color, dark] = useMemo(() => {
    const base = new Color(helperColors[category]);
    // Helpers that are not working fade towards the ground colour.
    if (!active) base.lerp(new Color('#8a94a1'), 0.45);
    const shade = base.clone().multiplyScalar(0.55);
    return [`#${base.getHexString()}`, `#${shade.getHexString()}`];
  }, [active, category]);
  const ring = active ? helperColors[category] : stateRing[state];
  const motion = motions[category];
  useEffect(() => invalidate(), [state, paused, invalidate]);
  useFrame(({ clock }, delta) => {
    const part = emblem.current;
    if (!part) return;
    const restY = (part.userData.restY ??= part.position.y) as number;
    if (!active || paused) {
      // Rest pose, so a paused or finished helper looks still rather than frozen mid-move.
      part.visible = true;
      part.position.y = restY;
      return;
    }
    const t = clock.elapsedTime;
    if (motion === 'spin') part.rotation.y += Math.min(delta, 0.05) * 1.8;
    if (motion === 'roll') part.rotation.z += Math.min(delta, 0.05) * 2.2;
    if (motion === 'swing') part.rotation.y = Math.sin(t * 2.2) * 0.45;
    if (motion === 'bob') part.position.y = restY + Math.sin(t * 3.4) * 0.04;
    if (motion === 'blink') part.visible = Math.sin(t * 7) > 0;
    invalidate();
  });
  return (
    <group>
      <mesh position={[0, 0.04, 0]} receiveShadow castShadow>
        <cylinderGeometry args={[0.36, 0.4, 0.08, 20]} />
        <meshStandardMaterial color="#59636f" roughness={0.9} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.085, 0]}>
        <ringGeometry args={[0.3, 0.38, 28]} />
        <meshBasicMaterial color={ring} />
      </mesh>
      {category === 'subagent' ? (
        <group ref={emblem} position={[0, 0.08, 0]}>
          <group scale={0.62}>
            <Character
              kind="generic"
              clip={active ? 'operate' : state === 'failed' ? 'failed' : 'idle'}
              paused={paused}
            />
          </group>
        </group>
      ) : (
        <Figure
          category={category}
          color={color}
          dark={dark}
          glow={active}
          emblem={emblem}
        />
      )}
    </group>
  );
}
