import { CameraControls, CameraControlsImpl } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

import {
  CAMERA_FOLLOW_LERP,
  MAX_DELTA_TIME_SEC,
  ORBIT_CLICK_SLOP_PX,
  ORBIT_PERSP_FOV_DEG,
  ORBIT_PITCH_MAX_DEG,
  ORBIT_PITCH_MIN_DEG,
  ZOOM_MAX,
  ZOOM_MIN,
} from '../../../constants.js';
import { unlockAudio } from '../../../notificationSound.js';
import {
  defaultOrbitCamera,
  type OrbitProjection,
  readStoredOrbitCamera,
  storeOrbitCamera,
} from '../../../viewMode.js';
import { applyOfficeClick } from '../../engine/officeClick.js';
import type { OfficeState } from '../../engine/officeState.js';
import { TILE_SIZE } from '../../types.js';
import type { ScreenProjector } from '../Office3D.js';
import { perspDistance, snapYaw } from './orbitMath.js';

export interface OrbitViewState {
  yaw: number;
  target: THREE.Vector3;
}
export type OrbitPick = { kind: 'agent'; id: number } | { kind: 'pet'; id: string };

const { ACTION } = CameraControlsImpl;
const DEG = Math.PI / 180;

interface OrbitRigProps {
  officeState: OfficeState;
  zoom: number;
  projection: OrbitProjection;
  projectorRef: React.MutableRefObject<ScreenProjector | null>;
  viewRef: React.MutableRefObject<OrbitViewState>;
  pickablesRef: React.MutableRefObject<THREE.Object3D[]>;
  onAgentClick: (agentId: number) => void;
  reducedMotion: boolean;
}

export function OrbitRig({
  officeState,
  zoom,
  projection,
  projectorRef,
  viewRef,
  pickablesRef,
  onAgentClick,
  reducedMotion,
}: OrbitRigProps) {
  const controls = useRef<CameraControlsImpl>(null);
  const { camera, gl, size, raycaster, pointer } = useThree();
  const dpr = useThree((s) => s.viewport.dpr);
  const ortho = projection === 'ortho';
  const ground = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);

  // Initial framing: layout center, stored angles, bounded target.
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const layout = officeState.getLayout();
    c.setBoundary(
      new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(layout.cols, 0, layout.rows)),
    );
    c.setTarget(layout.cols / 2, 0, layout.rows / 2, false);
    const saved = readStoredOrbitCamera();
    c.rotateTo(saved.yaw, saved.polar, false);
    c.mouseButtons.left = ACTION.ROTATE;
    c.mouseButtons.right = ACTION.TRUCK;
    c.mouseButtons.middle = ACTION.TRUCK;
    c.mouseButtons.wheel = ortho ? ACTION.ZOOM : ACTION.DOLLY;
    c.touches.one = ACTION.TOUCH_ROTATE;
    c.touches.two = ortho ? ACTION.TOUCH_ZOOM_TRUCK : ACTION.TOUCH_DOLLY_TRUCK;
    c.smoothTime = reducedMotion ? 0 : 0.2;
    c.draggingSmoothTime = reducedMotion ? 0 : 0.1;
    // Persist the angle whenever the camera comes to rest.
    const onRest = () => storeOrbitCamera({ yaw: c.azimuthAngle, polar: c.polarAngle });
    const onStart = () => {
      officeState.cameraFollowId = null;
      officeState.cancelGreeterCamera();
    };
    c.addEventListener('rest', onRest);
    c.addEventListener('controlstart', onStart);
    return () => {
      c.removeEventListener('rest', onRest);
      c.removeEventListener('controlstart', onStart);
    };
  }, [officeState, ortho, reducedMotion]);

  // App zoom (ZoomControls +/−) drives the camera scale; limits follow ZOOM_MIN/MAX.
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    if (ortho) {
      c.minZoom = (ZOOM_MIN * TILE_SIZE) / dpr;
      c.maxZoom = (ZOOM_MAX * TILE_SIZE) / dpr;
      void c.zoomTo((zoom * TILE_SIZE) / dpr, !reducedMotion);
    } else {
      c.minDistance = perspDistance(size.height, ZOOM_MAX, dpr, ORBIT_PERSP_FOV_DEG);
      c.maxDistance = perspDistance(size.height, ZOOM_MIN, dpr, ORBIT_PERSP_FOV_DEG);
      void c.dollyTo(perspDistance(size.height, zoom, dpr, ORBIT_PERSP_FOV_DEG), !reducedMotion);
    }
  }, [zoom, ortho, dpr, size.height, reducedMotion]);

  // Screen projector for ToolOverlay / agent panel (lift = sprite px, negative = up).
  useEffect(() => {
    const v = new THREE.Vector3();
    projectorRef.current = (worldX, groundY, liftPx) => {
      v.set(worldX / TILE_SIZE, -liftPx / TILE_SIZE, groundY / TILE_SIZE).project(camera);
      if (v.z < -1 || v.z > 1) return null;
      return { x: ((v.x + 1) / 2) * size.width, y: ((1 - v.y) / 2) * size.height };
    };
    return () => {
      projectorRef.current = null;
    };
  }, [camera, size, projectorRef]);

  // Q / E rotate a quarter turn, R resets.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const c = controls.current;
      if (!c) return;
      const k = e.key.toLowerCase();
      if (k === 'q' || k === 'e') {
        const step = k === 'q' ? -Math.PI / 2 : Math.PI / 2;
        void c.rotateTo(snapYaw(c.azimuthAngle) + step, c.polarAngle, !reducedMotion);
      } else if (k === 'r') {
        const layout = officeState.getLayout();
        const def = defaultOrbitCamera();
        void c.setTarget(layout.cols / 2, 0, layout.rows / 2, !reducedMotion);
        void c.rotateTo(def.yaw, def.polar, !reducedMotion);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [officeState, reducedMotion]);

  // Click (not drag) → same office click as 2D/3D; hover → cursor + hoveredAgentId.
  useEffect(() => {
    const el = gl.domElement;
    const down = { x: 0, y: 0 };
    const setPointer = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      pointer.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
    };
    const pick = (): OrbitPick | null => {
      const hits = raycaster.intersectObjects(pickablesRef.current, false);
      return hits.length > 0 ? (hits[0].object.userData.pick as OrbitPick) : null;
    };
    const onDown = (e: PointerEvent) => {
      unlockAudio();
      down.x = e.clientX;
      down.y = e.clientY;
    };
    const onMove = (e: PointerEvent) => {
      if (e.buttons !== 0) return;
      setPointer(e);
      const hit = pick();
      officeState.hoveredAgentId = hit?.kind === 'agent' ? hit.id : null;
      el.style.cursor = hit ? 'pointer' : 'grab';
    };
    const onClick = (e: MouseEvent) => {
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > ORBIT_CLICK_SLOP_PX) return;
      setPointer(e);
      const hit = pick();
      applyOfficeClick(
        officeState,
        {
          agentId: hit?.kind === 'agent' ? hit.id : null,
          petId: hit?.kind === 'pet' ? hit.id : null,
          getTile: () => {
            const p = raycaster.ray.intersectPlane(ground, new THREE.Vector3());
            return p ? { col: Math.floor(p.x), row: Math.floor(p.z) } : null;
          },
        },
        onAgentClick,
      );
    };
    const onLeave = () => {
      officeState.hoveredAgentId = null;
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('click', onClick);
    el.addEventListener('pointerleave', onLeave);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('click', onClick);
      el.removeEventListener('pointerleave', onLeave);
    };
  }, [gl, camera, raycaster, pointer, officeState, onAgentClick, pickablesRef, ground]);

  // Simulation tick, follow target, shared view state. Runs before the layers (mounted first).
  const tmp = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, delta) => {
    officeState.update(Math.min(delta, MAX_DELTA_TIME_SEC));
    const c = controls.current;
    if (!c) return;
    const followCh =
      officeState.cameraFollowId !== null
        ? officeState.characters.get(officeState.cameraFollowId)
        : undefined;
    const focus = followCh ?? officeState.greeterCameraTarget;
    c.getTarget(tmp);
    if (focus) {
      const tx = tmp.x + (focus.x / TILE_SIZE - tmp.x) * CAMERA_FOLLOW_LERP;
      const tz = tmp.z + (focus.y / TILE_SIZE - tmp.z) * CAMERA_FOLLOW_LERP;
      void c.moveTo(tx, 0, tz, false);
      tmp.set(tx, 0, tz);
    }
    viewRef.current.yaw = c.azimuthAngle;
    viewRef.current.target.copy(tmp);
  });

  return (
    <CameraControls
      ref={controls}
      makeDefault
      minPolarAngle={(90 - ORBIT_PITCH_MAX_DEG) * DEG}
      maxPolarAngle={(90 - ORBIT_PITCH_MIN_DEG) * DEG}
    />
  );
}
