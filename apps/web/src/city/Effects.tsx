import {
  Bloom,
  EffectComposer,
  N8AO,
  ToneMapping,
} from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';

/**
 * Contact shadows where buildings, props and characters meet the ground, and a
 * glow on whatever is lit past white: lamp bulbs, beacons, signs and neon (the
 * `light` parts render untonemapped, so only they cross the bloom threshold).
 */
export function Effects() {
  return (
    <EffectComposer multisampling={4} enableNormalPass={false}>
      <N8AO
        aoRadius={0.9}
        distanceFalloff={0.6}
        intensity={3.5}
        quality="medium"
        halfRes
      />
      <Bloom
        mipmapBlur
        luminanceThreshold={1}
        luminanceSmoothing={0.2}
        intensity={1.1}
        radius={0.55}
      />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  );
}
