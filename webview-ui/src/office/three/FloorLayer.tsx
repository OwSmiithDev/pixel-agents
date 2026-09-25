import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

import type { ColorValue } from '../../components/ui/types.js';
import {
  THREE_ACCENT_COLOR,
  THREE_GLOW_HUE_MAX,
  THREE_GLOW_HUE_MIN,
  THREE_GLOW_INTENSITY,
  THREE_GLOW_PULSE_AMPLITUDE,
  THREE_GLOW_PULSE_SPEED,
  THREE_GLOW_SAT_MIN,
} from '../../constants.js';
import type { OfficeState } from '../engine/officeState.js';
import { renderCarpetLayer, renderTileGrid } from '../engine/renderer.js';
import { TILE_SIZE, TileType } from '../types.js';
import { configurePixelTexture } from './textureCache.js';

type Layout = ReturnType<OfficeState['getLayout']>;

function isGlowTile(color: ColorValue | null | undefined): boolean {
  return (
    !!color &&
    color.h >= THREE_GLOW_HUE_MIN &&
    color.h <= THREE_GLOW_HUE_MAX &&
    color.s >= THREE_GLOW_SAT_MIN
  );
}

/** Bake the 2D floor (tiles + carpets) and a glow mask for accent tiles. */
function bakeFloor(officeState: OfficeState, layout: Layout) {
  const w = layout.cols * TILE_SIZE;
  const h = layout.rows * TILE_SIZE;
  const color = document.createElement('canvas');
  color.width = w;
  color.height = h;
  const ctx = color.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  renderTileGrid(ctx, officeState.tileMap, 0, 0, 1, layout.tileColors, layout.cols);
  if (layout.carpetTiles && layout.carpetTiles.length > 0) {
    renderCarpetLayer(ctx, layout.carpetTiles, layout.cols, layout.rows, 0, 0, 1);
  }

  const glow = document.createElement('canvas');
  glow.width = w;
  glow.height = h;
  const gctx = glow.getContext('2d')!;
  gctx.fillStyle = THREE_ACCENT_COLOR;
  let hasGlow = false;
  for (let r = 0; r < layout.rows; r++) {
    for (let c = 0; c < layout.cols; c++) {
      const i = r * layout.cols + c;
      if (layout.tiles[i] === TileType.WALL || layout.tiles[i] === TileType.VOID) continue;
      if (!isGlowTile(layout.tileColors?.[i])) continue;
      gctx.fillRect(c * TILE_SIZE, r * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      hasGlow = true;
    }
  }
  return { color, glow: hasGlow ? glow : null };
}

interface FloorLayerProps {
  officeState: OfficeState;
  reducedMotion: boolean;
}

export function FloorLayer({ officeState, reducedMotion }: FloorLayerProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const layoutRef = useRef<Layout | null>(null);
  const material = useMemo(
    () => new THREE.MeshLambertMaterial({ emissive: new THREE.Color(1, 1, 1) }),
    [],
  );

  useEffect(
    () => () => {
      material.map?.dispose();
      material.emissiveMap?.dispose();
      material.dispose();
    },
    [material],
  );

  useFrame(({ clock }) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const layout = officeState.getLayout();
    if (layout !== layoutRef.current) {
      layoutRef.current = layout;
      const { color, glow } = bakeFloor(officeState, layout);
      material.map?.dispose();
      material.emissiveMap?.dispose();
      material.map = configurePixelTexture(new THREE.CanvasTexture(color));
      material.emissiveMap = glow ? configurePixelTexture(new THREE.CanvasTexture(glow)) : null;
      material.emissiveIntensity = glow ? THREE_GLOW_INTENSITY : 0;
      material.needsUpdate = true;
      mesh.scale.set(layout.cols, layout.rows, 1);
      mesh.position.set(layout.cols / 2, 0, layout.rows / 2);
    }
    if (material.emissiveMap && !reducedMotion) {
      material.emissiveIntensity =
        THREE_GLOW_INTENSITY +
        THREE_GLOW_PULSE_AMPLITUDE * Math.sin(clock.elapsedTime * THREE_GLOW_PULSE_SPEED);
    }
  });

  // Drawn first and without depth writes: sprites whose z-sort key sits behind
  // their bottom edge (side chairs, sofas) dip below y=0 and must not be hidden.
  return (
    <mesh
      ref={meshRef}
      rotation-x={-Math.PI / 2}
      receiveShadow
      material={material}
      renderOrder={-1}
      material-depthWrite={false}
    >
      <planeGeometry args={[1, 1]} />
    </mesh>
  );
}
