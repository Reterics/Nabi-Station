import { memo, useMemo } from 'react';
import { generateBuilding } from '@nabi/building-gen';
import type { BuildingSpec } from '@nabi/protocol';

export const Building = memo(function Building({
  spec,
  active = false,
}: {
  spec: BuildingSpec;
  active?: boolean;
}) {
  const parts = useMemo(() => generateBuilding(spec), [spec]);
  return (
    <group>
      {parts.map((part) => (
        <mesh key={part.id} position={part.position} castShadow receiveShadow>
          {part.shape === 'box' ? (
            <boxGeometry args={part.size} />
          ) : part.shape === 'cone' ? (
            <coneGeometry args={[part.size[0] / 2, part.size[1], 4]} />
          ) : (
            <cylinderGeometry
              args={[part.size[0] / 2, part.size[2] / 2, part.size[1], 8]}
            />
          )}
          <meshStandardMaterial
            color={part.color}
            roughness={0.88}
            flatShading
            emissive={part.emissive && active ? '#f6c56c' : '#000000'}
            emissiveIntensity={0.28}
          />
        </mesh>
      ))}
    </group>
  );
});
