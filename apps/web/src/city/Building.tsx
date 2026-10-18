import { memo, useEffect, useMemo } from 'react';
import {
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  Matrix4,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
  type Material,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  generateBuilding,
  type BuildingPart,
  type PartMaterial,
} from '@nabi/building-gen';
import type { BuildingSpec } from '@nabi/protocol';

/** A gable: a triangular prism with its ridge along Z, normalised to a unit box. */
function unitPrism() {
  const geometry = new CylinderGeometry(1, 1, 1, 3).rotateX(-Math.PI / 2);
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const centre = box.getCenter(new Vector3());
  const size = box.getSize(new Vector3());
  return geometry
    .translate(-centre.x, -centre.y, -centre.z)
    .scale(1 / size.x, 1 / size.y, 1 / size.z);
}

function partGeometry(part: BuildingPart): BufferGeometry {
  const [x, y, z] = part.size;
  const segments = part.segments ?? 8;
  switch (part.shape) {
    case 'box':
      return new BoxGeometry(x, y, z);
    case 'cylinder':
      return new CylinderGeometry(x / 2, z / 2, y, segments);
    case 'cone':
      return new ConeGeometry(x / 2, y, part.segments ?? 4);
    case 'sphere':
      return new SphereGeometry(x / 2, segments, Math.max(4, segments - 2));
    case 'prism':
      return unitPrism().scale(x, y, z);
  }
}

const matrix = new Matrix4();
const rotation = new Quaternion();
const euler = new Euler();
const unit = new Vector3(1, 1, 1);

/**
 * One merged geometry per material and colour: a building is a handful of draw
 * calls however detailed it is.
 */
function mergeParts(parts: BuildingPart[]) {
  const groups = new Map<
    string,
    { part: BuildingPart; geometries: BufferGeometry[] }
  >();
  for (const part of parts) {
    const geometry = partGeometry(part).toNonIndexed();
    // Merging needs the same attributes everywhere; uvs are unused.
    geometry.deleteAttribute('uv');
    euler.set(...(part.rotation ?? [0, 0, 0]));
    rotation.setFromEuler(euler);
    geometry.applyMatrix4(
      matrix.compose(new Vector3(...part.position), rotation, unit),
    );
    const key = `${part.material}|${part.color}|${part.emissive ? 1 : 0}`;
    const group = groups.get(key) ?? { part, geometries: [] };
    group.geometries.push(geometry);
    groups.set(key, group);
  }
  return [...groups].map(([key, { part, geometries }]) => {
    const merged = mergeGeometries(geometries)!;
    for (const geometry of geometries) geometry.dispose();
    return { key, part, geometry: merged };
  });
}

/** Physically based looks per surface class; cached, since buildings share them. */
const materials = new Map<string, Material>();
function materialFor(
  kind: PartMaterial,
  color: string,
  emissive: boolean,
  bright: boolean,
): Material {
  const key = `${kind}|${color}|${emissive}|${bright}`;
  const cached = materials.get(key);
  if (cached) return cached;
  const base = new Color(color);
  let material: Material;
  switch (kind) {
    case 'glass':
      // Lit glass reads as an occupied floor: tinted pane, warm light behind it.
      material = new MeshPhysicalMaterial({
        color: base,
        metalness: 0.2,
        roughness: 0.08,
        clearcoat: 1,
        clearcoatRoughness: 0.05,
        envMapIntensity: 1.8,
        emissive: emissive ? new Color('#ffc46b') : new Color('#000000'),
        emissiveIntensity: emissive ? (bright ? 0.16 : 0.1) : 0,
      });
      break;
    case 'metal':
      material = new MeshStandardMaterial({
        color: base,
        metalness: 0.75,
        roughness: 0.32,
      });
      break;
    case 'light':
      material = new MeshStandardMaterial({
        color: base,
        emissive: emissive ? base : new Color('#000000'),
        emissiveIntensity: emissive ? (bright ? 1.9 : 1.2) : 0,
        roughness: 0.4,
        toneMapped: !emissive,
      });
      break;
    case 'foliage':
      material = new MeshStandardMaterial({
        color: base,
        roughness: 0.95,
        flatShading: true,
      });
      break;
    case 'brick':
      material = new MeshStandardMaterial({ color: base, roughness: 0.92 });
      break;
    case 'concrete':
      material = new MeshStandardMaterial({ color: base, roughness: 0.88 });
      break;
    case 'wood':
      material = new MeshStandardMaterial({ color: base, roughness: 0.8 });
      break;
    default:
      material = new MeshStandardMaterial({ color: base, roughness: 0.55 });
  }
  materials.set(key, material);
  return material;
}

export const Building = memo(function Building({
  spec,
  active = false,
}: {
  spec: BuildingSpec;
  active?: boolean;
}) {
  const meshes = useMemo(() => mergeParts(generateBuilding(spec)), [spec]);
  useEffect(
    () => () => {
      for (const mesh of meshes) mesh.geometry.dispose();
    },
    [meshes],
  );
  return (
    <group>
      {meshes.map(({ key, part, geometry }) => (
        <mesh
          key={key}
          geometry={geometry}
          material={materialFor(
            part.material,
            part.color,
            Boolean(part.emissive),
            active,
          )}
          castShadow={part.material !== 'light'}
          receiveShadow
        />
      ))}
    </group>
  );
});
