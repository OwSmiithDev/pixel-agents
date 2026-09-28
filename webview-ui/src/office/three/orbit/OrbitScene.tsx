import { Canvas } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';

import {
  ORBIT_PERSP_FOV_DEG,
  THREE_AMBIENT_COLOR,
  THREE_AMBIENT_INTENSITY,
  THREE_BG_COLOR,
} from '../../../constants.js';
import type { OrbitProjection } from '../../../viewMode.js';
import type { OfficeState } from '../../engine/officeState.js';
import { Effects } from '../Effects.js';
import { FloorLayer } from '../FloorLayer.js';
import { KeyLight } from '../KeyLight.js';
import { MonitorLights } from '../MonitorLights.js';
import type { ScreenProjector } from '../Office3D.js';
import { usePrefersReducedMotion } from '../usePrefersReducedMotion.js';
import { OrbitActors } from './OrbitActors.js';
import { OrbitRig, type OrbitViewState } from './OrbitRig.js';

interface OrbitSceneProps {
  officeState: OfficeState;
  zoom: number;
  projection: OrbitProjection;
  onAgentClick: (agentId: number) => void;
  projectorRef: React.MutableRefObject<ScreenProjector | null>;
}

export function OrbitScene({
  officeState,
  zoom,
  projection,
  onAgentClick,
  projectorRef,
}: OrbitSceneProps) {
  const reducedMotion = usePrefersReducedMotion();
  const viewRef = useRef<OrbitViewState>({ yaw: 0, target: new THREE.Vector3() });
  const pickablesRef = useRef<THREE.Object3D[]>([]);
  const ortho = projection === 'ortho';
  return (
    <div
      className="w-full h-full bg-bg"
      data-testid="orbit-view"
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* key: switching projection remounts the canvas with the other camera type. */}
      <Canvas
        key={projection}
        orthographic={ortho}
        flat
        shadows="soft"
        dpr={[1, 2]}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        camera={
          ortho
            ? { near: 0.1, far: 400, zoom: 32, position: [0, 60, 60] }
            : { fov: ORBIT_PERSP_FOV_DEG, near: 0.1, far: 400, position: [0, 30, 30] }
        }
      >
        <color attach="background" args={[THREE_BG_COLOR]} />
        <OrbitRig
          officeState={officeState}
          zoom={zoom}
          projection={projection}
          projectorRef={projectorRef}
          viewRef={viewRef}
          pickablesRef={pickablesRef}
          onAgentClick={onAgentClick}
          reducedMotion={reducedMotion}
        />
        <ambientLight color={THREE_AMBIENT_COLOR} intensity={THREE_AMBIENT_INTENSITY * Math.PI} />
        <KeyLight officeState={officeState} />
        <MonitorLights officeState={officeState} />
        <FloorLayer officeState={officeState} reducedMotion={reducedMotion} />
        <OrbitActors officeState={officeState} viewRef={viewRef} pickablesRef={pickablesRef} />
        <Effects />
      </Canvas>
    </div>
  );
}
