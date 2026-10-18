import { useEffect, useLayoutEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { PMREMGenerator, type DirectionalLight } from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/**
 * Image-based lighting from three's procedural room (generated locally, no HDR
 * download), so glass and metal have something to reflect; plus a warm sun whose
 * shadow camera fits whatever is on screen.
 */
export function Lighting({ bounds }: { bounds: Bounds }) {
  const { gl, scene, invalidate } = useThree();
  const sun = useRef<DirectionalLight>(null);
  useEffect(() => {
    const generator = new PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const environment = generator.fromScene(room, 0.04).texture;
    scene.environment = environment;
    scene.environmentIntensity = 0.4;
    invalidate();
    return () => {
      scene.environment = null;
      environment.dispose();
      room.dispose();
      generator.dispose();
    };
  }, [gl, scene, invalidate]);

  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerZ = (bounds.minZ + bounds.maxZ) / 2;
  // The ground diagonal, plus room for tall buildings' shadows.
  const reach =
    Math.hypot(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) / 2 + 4;
  useLayoutEffect(() => {
    const light = sun.current;
    if (!light) return;
    light.target.position.set(centerX, 0, centerZ);
    light.target.updateMatrixWorld();
    const camera = light.shadow.camera;
    camera.left = -reach;
    camera.right = reach;
    camera.top = reach;
    camera.bottom = -reach;
    camera.far = reach * 4;
    camera.updateProjectionMatrix();
    light.shadow.needsUpdate = true;
    invalidate();
  }, [centerX, centerZ, reach, invalidate]);

  return (
    <>
      <hemisphereLight args={['#dfe9ff', '#4a4338', 0.75]} />
      <directionalLight
        ref={sun}
        position={[centerX + reach * 0.6, reach * 1.6, centerZ + reach * 0.35]}
        intensity={2.2}
        color="#fff2df"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
        shadow-radius={4}
      />
      {/* Cool fill from the opposite side keeps shadowed faces readable. */}
      <directionalLight
        position={[centerX - 10, 6, centerZ - 6]}
        intensity={0.5}
        color="#bcd2ff"
      />
    </>
  );
}
