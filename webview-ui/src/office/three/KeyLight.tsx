import { useEffect, useRef } from 'react';
import * as THREE from 'three';

import {
  THREE_KEY_LIGHT_COLOR,
  THREE_KEY_LIGHT_INTENSITY,
  THREE_KEY_LIGHT_OFFSET,
  THREE_SHADOW_MAP_SIZE,
} from '../../constants.js';
import type { OfficeState } from '../engine/officeState.js';

export function KeyLight({ officeState }: { officeState: OfficeState }) {
  const light = useRef<THREE.DirectionalLight>(null);
  const layout = officeState.getLayout();
  const cx = layout.cols / 2;
  const cz = layout.rows / 2;
  const half = Math.max(layout.cols, layout.rows) * 0.75;
  useEffect(() => {
    const l = light.current;
    if (!l) return;
    l.target.position.set(cx, 0, cz);
    l.target.updateMatrixWorld();
    const cam = l.shadow.camera;
    cam.left = -half;
    cam.right = half;
    cam.top = half;
    cam.bottom = -half;
    cam.near = 1;
    cam.far = 200;
    cam.updateProjectionMatrix();
  }, [cx, cz, half]);
  return (
    <directionalLight
      ref={light}
      color={THREE_KEY_LIGHT_COLOR}
      intensity={THREE_KEY_LIGHT_INTENSITY * Math.PI}
      position={[
        cx + THREE_KEY_LIGHT_OFFSET.x,
        THREE_KEY_LIGHT_OFFSET.y,
        cz + THREE_KEY_LIGHT_OFFSET.z,
      ]}
      castShadow
      shadow-mapSize-width={THREE_SHADOW_MAP_SIZE}
      shadow-mapSize-height={THREE_SHADOW_MAP_SIZE}
      shadow-bias={-0.0005}
    />
  );
}
