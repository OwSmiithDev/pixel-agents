import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';

import {
  THREE_BLOOM_INTENSITY,
  THREE_BLOOM_RADIUS,
  THREE_BLOOM_THRESHOLD,
  THREE_VIGNETTE_DARKNESS,
} from '../../constants.js';

export function Effects() {
  return (
    <EffectComposer multisampling={0}>
      <Bloom
        mipmapBlur
        luminanceThreshold={THREE_BLOOM_THRESHOLD}
        intensity={THREE_BLOOM_INTENSITY}
        radius={THREE_BLOOM_RADIUS}
      />
      <Vignette eskil={false} offset={0.25} darkness={THREE_VIGNETTE_DARKNESS} />
    </EffectComposer>
  );
}
