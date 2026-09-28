import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';

import {
  ORBIT_WALL_CUT_HALF_ANGLE_DEG,
  ORBIT_WALL_CUT_HEIGHT,
  ORBIT_WALL_CUT_RADIUS,
  ORBIT_WALL_DEFAULT_COLOR,
  ORBIT_WALL_HEIGHT,
} from '../../../constants.js';
import type { OfficeState } from '../../engine/officeState.js';
import { TileType } from '../../types.js';
import { wallColorToHex } from '../../wallTiles.js';
import { shouldCutWall } from './orbitMath.js';
import type { OrbitViewState } from './OrbitRig.js';

const BOX = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);

interface Props {
  officeState: OfficeState;
  viewRef: React.MutableRefObject<OrbitViewState>;
  cutRef: React.MutableRefObject<Set<string>>;
  reducedMotion: boolean;
}

export function OrbitWalls({ officeState, viewRef, cutRef, reducedMotion }: Props) {
  const [layout, setLayout] = useState(() => officeState.getLayout());
  const walls = useMemo(() => {
    const out: Array<{ col: number; row: number; color: string }> = [];
    officeState.tileMap.forEach((rowTiles, row) =>
      rowTiles.forEach((t, col) => {
        if (t !== TileType.WALL) return;
        const c = layout.tileColors?.[row * layout.cols + col];
        out.push({ col, row, color: c ? wallColorToHex(c) : ORBIT_WALL_DEFAULT_COLOR });
      }),
    );
    return out;
  }, [layout, officeState]);

  const mesh = useMemo(() => {
    const m = new THREE.InstancedMesh(
      BOX,
      new THREE.MeshLambertMaterial(),
      Math.max(1, walls.length),
    );
    m.count = walls.length;
    const color = new THREE.Color();
    walls.forEach((w, i) => m.setColorAt(i, color.set(w.color)));
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }, [walls]);
  const heights = useMemo(() => new Float32Array(walls.length).fill(ORBIT_WALL_HEIGHT), [walls]);

  useEffect(() => () => mesh.material.dispose(), [mesh]);

  const m4 = useMemo(() => new THREE.Matrix4(), []);
  const pos = useMemo(() => new THREE.Vector3(), []);
  const scale = useMemo(() => new THREE.Vector3(), []);
  const quat = useMemo(() => new THREE.Quaternion(), []);
  useFrame((_, delta) => {
    const current = officeState.getLayout();
    if (current !== layout) setLayout(current);
    const { yaw, target } = viewRef.current;
    const cut = cutRef.current;
    cut.clear();
    const k = reducedMotion ? 1 : Math.min(1, delta * 10);
    walls.forEach((w, i) => {
      const isCut = shouldCutWall(
        { x: w.col + 0.5, z: w.row + 0.5 },
        target,
        yaw,
        ORBIT_WALL_CUT_RADIUS,
        ORBIT_WALL_CUT_HALF_ANGLE_DEG,
      );
      if (isCut) cut.add(`${w.col},${w.row}`);
      const goal = isCut ? ORBIT_WALL_CUT_HEIGHT : ORBIT_WALL_HEIGHT;
      heights[i] += (goal - heights[i]) * k;
      mesh.setMatrixAt(
        i,
        m4.compose(pos.set(w.col + 0.5, 0, w.row + 0.5), quat, scale.set(1, heights[i], 1)),
      );
    });
    mesh.instanceMatrix.needsUpdate = true;
  });

  return <primitive object={mesh} />;
}
