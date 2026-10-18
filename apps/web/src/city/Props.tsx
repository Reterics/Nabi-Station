import { useLayoutEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  IcosahedronGeometry,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
  type InstancedMesh,
  type Material,
} from 'three';

export type PropKind =
  'tree' | 'pine' | 'poplar' | 'lamp' | 'bench' | 'car' | 'planter' | 'shrub';

export interface PropItem {
  kind: PropKind;
  x: number;
  z: number;
  /** Yaw in radians. */
  rotation?: number;
  scale?: number;
  /** Tint for the part marked `tinted` (car paint, foliage shade). */
  color?: string;
}

interface Piece {
  geometry: BufferGeometry;
  material: Material;
  offset: [number, number, number];
  scale?: [number, number, number];
  tinted?: boolean;
  shadow?: boolean;
}

const standard = (color: string, roughness = 0.8, metalness = 0) =>
  new MeshStandardMaterial({ color, roughness, metalness });
const foliage = new MeshStandardMaterial({
  color: '#ffffff',
  roughness: 0.95,
  flatShading: true,
});
const paint = new MeshStandardMaterial({
  color: '#ffffff',
  roughness: 0.35,
  metalness: 0.4,
});
const bark = standard('#7a6250', 0.9);
const metal = standard('#3d4450', 0.4, 0.7);
const bulb = new MeshStandardMaterial({
  color: '#fff1c9',
  emissive: '#ffe2a0',
  emissiveIntensity: 1.6,
  toneMapped: false,
});

/** Each prop is a few pieces; each piece becomes one instanced mesh for all copies. */
const kit: Record<PropKind, Piece[]> = {
  tree: [
    {
      geometry: new CylinderGeometry(0.05, 0.07, 0.5, 6),
      material: bark,
      offset: [0, 0.25, 0],
    },
    {
      geometry: new IcosahedronGeometry(0.38, 1),
      material: foliage,
      offset: [0, 0.78, 0],
      tinted: true,
    },
  ],
  pine: [
    {
      geometry: new CylinderGeometry(0.04, 0.06, 0.3, 6),
      material: bark,
      offset: [0, 0.15, 0],
    },
    {
      geometry: new ConeGeometry(0.34, 0.6, 7),
      material: foliage,
      offset: [0, 0.55, 0],
      tinted: true,
    },
    {
      geometry: new ConeGeometry(0.25, 0.5, 7),
      material: foliage,
      offset: [0, 0.9, 0],
      tinted: true,
    },
  ],
  poplar: [
    {
      geometry: new CylinderGeometry(0.04, 0.05, 0.4, 6),
      material: bark,
      offset: [0, 0.2, 0],
    },
    {
      geometry: new SphereGeometry(0.22, 8, 6),
      material: foliage,
      offset: [0, 0.95, 0],
      scale: [1, 2.6, 1],
      tinted: true,
    },
  ],
  lamp: [
    {
      geometry: new CylinderGeometry(0.025, 0.035, 1.3, 6),
      material: metal,
      offset: [0, 0.65, 0],
    },
    {
      geometry: new BoxGeometry(0.3, 0.03, 0.05),
      material: metal,
      offset: [0.13, 1.3, 0],
    },
    {
      geometry: new BoxGeometry(0.16, 0.04, 0.08),
      material: bulb,
      offset: [0.24, 1.27, 0],
      shadow: false,
    },
  ],
  bench: [
    {
      geometry: new BoxGeometry(0.5, 0.04, 0.16),
      material: standard('#a77b55', 0.7),
      offset: [0, 0.2, 0],
    },
    {
      geometry: new BoxGeometry(0.5, 0.14, 0.03),
      material: standard('#a77b55', 0.7),
      offset: [0, 0.3, -0.07],
    },
    {
      geometry: new BoxGeometry(0.46, 0.18, 0.12),
      material: metal,
      offset: [0, 0.09, 0],
      scale: [1, 1, 0.3],
    },
  ],
  car: [
    {
      geometry: new BoxGeometry(0.62, 0.14, 0.3),
      material: paint,
      offset: [0, 0.13, 0],
      tinted: true,
    },
    {
      geometry: new BoxGeometry(0.34, 0.12, 0.26),
      material: standard('#1f2a36', 0.15, 0.3),
      offset: [-0.03, 0.26, 0],
    },
    {
      geometry: new BoxGeometry(0.5, 0.08, 0.32),
      material: standard('#1b1d21', 0.9),
      offset: [0, 0.05, 0],
    },
  ],
  planter: [
    {
      geometry: new BoxGeometry(0.42, 0.18, 0.42),
      material: standard('#cfc6b4', 0.9),
      offset: [0, 0.09, 0],
    },
    {
      geometry: new IcosahedronGeometry(0.2, 1),
      material: foliage,
      offset: [0, 0.3, 0],
      tinted: true,
    },
  ],
  shrub: [
    {
      geometry: new IcosahedronGeometry(0.2, 1),
      material: foliage,
      offset: [0, 0.14, 0],
      scale: [1.3, 0.8, 1.3],
      tinted: true,
    },
  ],
};

const defaultTint: Record<PropKind, string> = {
  tree: '#6f9e63',
  pine: '#4b7d5a',
  poplar: '#86a85c',
  lamp: '#ffffff',
  bench: '#ffffff',
  car: '#d9dde2',
  planter: '#5e9a5c',
  shrub: '#6b9b5a',
};

const matrix = new Matrix4();
const local = new Matrix4();
const quaternion = new Quaternion();
const euler = new Euler();
const position = new Vector3();
const scale = new Vector3();
const colour = new Color();

function PieceInstances({ piece, items }: { piece: Piece; items: PropItem[] }) {
  const mesh = useRef<InstancedMesh>(null);
  const invalidate = useThree((state) => state.invalidate);
  useLayoutEffect(() => {
    const instances = mesh.current;
    if (!instances) return;
    local.compose(
      position.set(...piece.offset),
      quaternion.identity(),
      scale.set(...(piece.scale ?? [1, 1, 1])),
    );
    items.forEach((item, index) => {
      const size = item.scale ?? 1;
      matrix
        .compose(
          position.set(item.x, 0, item.z),
          quaternion.setFromEuler(euler.set(0, item.rotation ?? 0, 0)),
          scale.set(size, size, size),
        )
        .multiply(local);
      instances.setMatrixAt(index, matrix);
      if (piece.tinted)
        instances.setColorAt(
          index,
          colour.set(item.color ?? defaultTint[item.kind]),
        );
    });
    instances.instanceMatrix.needsUpdate = true;
    if (instances.instanceColor) instances.instanceColor.needsUpdate = true;
    instances.computeBoundingSphere();
    invalidate();
  }, [items, piece, invalidate]);
  return (
    <instancedMesh
      ref={mesh}
      args={[piece.geometry, piece.material, items.length]}
      castShadow={piece.shadow !== false}
      receiveShadow
    />
  );
}

/** Street furniture and greenery, drawn with one instanced mesh per piece type. */
export function Props({ items }: { items: PropItem[] }) {
  const byKind = useMemo(() => {
    const groups = new Map<PropKind, PropItem[]>();
    for (const item of items) {
      const list = groups.get(item.kind) ?? [];
      list.push(item);
      groups.set(item.kind, list);
    }
    return [...groups];
  }, [items]);
  return (
    <>
      {byKind.map(([kind, list]) =>
        kit[kind].map((piece, index) => (
          // Keyed by count too: an instanced mesh cannot grow in place.
          <PieceInstances
            key={`${kind}-${index}-${list.length}`}
            piece={piece}
            items={list}
          />
        )),
      )}
    </>
  );
}

/** Deterministic pick from a string, for stable prop variety. */
export function hashPick<T>(key: string, options: readonly T[]): T {
  let hash = 2166136261;
  for (const char of key) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return options[(hash >>> 0) % options.length]!;
}

export const carColours = [
  '#e4572e',
  '#f3f4f6',
  '#2e86ab',
  '#1f2933',
  '#f2b134',
  '#7bc67b',
  '#c0c7d1',
];
