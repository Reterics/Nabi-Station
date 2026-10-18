import { Component, Suspense, useEffect, useMemo, type ReactNode } from 'react';
import { SceneLabel } from './SceneLabel';
import { useFrame, useLoader, useThree } from '@react-three/fiber';
import { AnimationMixer, type Mesh } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import type { AnimationClip, CharacterKind } from '@nabi/protocol';

class ModelBoundary extends Component<
  { children: ReactNode; name: string },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <SceneLabel center>
        <span className="model-error" role="alert">
          Could not load {this.props.name}. Run git lfs pull and reload.
        </span>
      </SceneLabel>
    ) : (
      this.props.children
    );
  }
}

function AnimatedModel({
  kind,
  clip,
  paused,
}: {
  kind: CharacterKind;
  clip: AnimationClip;
  paused: boolean;
}) {
  const gltf = useLoader(
    GLTFLoader,
    `${import.meta.env.BASE_URL}characters/${kind}.glb`,
    (loader) => {
      loader.setMeshoptDecoder(MeshoptDecoder);
    },
  );
  const scene = useMemo(() => {
    const instance = clone(gltf.scene);
    instance.traverse((object) => {
      if ((object as Mesh).isMesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });
    return instance;
  }, [gltf.scene]);
  const mixer = useMemo(() => new AnimationMixer(scene), [scene]);
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    const animation =
      gltf.animations.find((animation) => animation.name === clip) ??
      gltf.animations.find((animation) => animation.name === 'idle');
    if (!animation) return;
    const action = mixer.clipAction(animation);
    action.reset().fadeIn(0.25).play();
    // Sample a real pose even when reduced motion starts enabled.
    mixer.update(1 / 60);
    invalidate();
    return () => {
      action.fadeOut(0.25);
    };
  }, [clip, gltf.animations, invalidate, mixer]);
  useEffect(() => {
    invalidate();
  }, [paused, invalidate]);
  useEffect(
    () => () => {
      mixer.stopAllAction();
      mixer.uncacheRoot(scene);
    },
    [mixer, scene],
  );
  useFrame((_, delta) => {
    if (paused) return;
    mixer.update(Math.min(delta, 0.05));
    invalidate();
  });
  return (
    <>
      <primitive object={scene} dispose={null} />
      <SceneLabel position={[0, 0, 0]}>
        <span hidden data-model-ready={kind} data-animation={clip} />
      </SceneLabel>
    </>
  );
}

export function Character(props: {
  kind: CharacterKind;
  clip: AnimationClip;
  paused: boolean;
}) {
  return (
    <ModelBoundary name={props.kind}>
      <Suspense
        fallback={
          <mesh position={[0, 0.5, 0]}>
            <capsuleGeometry args={[0.15, 0.5, 4, 8]} />
            <meshStandardMaterial color="#c3c9b5" />
          </mesh>
        }
      >
        <AnimatedModel {...props} />
      </Suspense>
    </ModelBoundary>
  );
}
