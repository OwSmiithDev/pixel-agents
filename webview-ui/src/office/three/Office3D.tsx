import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';

import {
  CAMERA_FOLLOW_LERP,
  MAX_DELTA_TIME_SEC,
  THREE_AMBIENT_COLOR,
  THREE_AMBIENT_INTENSITY,
  THREE_BG_COLOR,
  THREE_CAMERA_DISTANCE,
  THREE_CAMERA_PITCH_DEG,
  THREE_CAMERA_YAW_DEG,
  THREE_KEY_LIGHT_COLOR,
  THREE_KEY_LIGHT_INTENSITY,
  THREE_KEY_LIGHT_OFFSET,
  THREE_SHADOW_MAP_SIZE,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_SCROLL_THRESHOLD,
} from '../../constants.js';
import { unlockAudio } from '../../notificationSound.js';
import { applyOfficeClick } from '../engine/officeClick.js';
import type { OfficeState } from '../engine/officeState.js';
import { TILE_SIZE } from '../types.js';
import { cameraBasis, PX_PER_UNIT } from './coords.js';
import { Effects } from './Effects.js';
import { FloorLayer } from './FloorLayer.js';
import { MonitorLights } from './MonitorLights.js';
import type { SpritePick } from './SpriteLayer.js';
import { SpriteLayer } from './SpriteLayer.js';

interface Office3DProps {
  officeState: OfficeState;
  /** Same zoom as the 2D view: device pixels per sprite pixel. */
  zoom: number;
  onZoomChange: (zoom: number) => void;
  onAgentClick: (agentId: number) => void;
  /** Filled with a world → container-CSS-px projector for DOM overlays. */
  projectorRef: React.MutableRefObject<ScreenProjector | null>;
}

/** Ground position (sprite px) + vertical lift (sprite px, negative = up) → CSS px. */
export type ScreenProjector = (
  worldX: number,
  groundY: number,
  liftPx: number,
) => { x: number; y: number } | null;

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  );
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return;
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

interface RigProps {
  officeState: OfficeState;
  zoom: number;
  target: React.MutableRefObject<THREE.Vector3>;
  forward: THREE.Vector3;
  up: THREE.Vector3;
  projectorRef: React.MutableRefObject<ScreenProjector | null>;
}

/** Owns `officeState.update`, camera placement, zoom and agent follow. */
function CameraRig({ officeState, zoom, target, forward, up, projectorRef }: RigProps) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const dpr = useThree((s) => s.viewport.dpr);

  useEffect(() => {
    const v = new THREE.Vector3();
    projectorRef.current = (worldX, groundY, liftPx) => {
      v.set(worldX / PX_PER_UNIT, 0, groundY / PX_PER_UNIT).addScaledVector(
        up,
        -liftPx / PX_PER_UNIT,
      );
      v.project(camera);
      if (v.z < -1 || v.z > 1) return null;
      return { x: ((v.x + 1) / 2) * size.width, y: ((1 - v.y) / 2) * size.height };
    };
    return () => {
      projectorRef.current = null;
    };
  }, [camera, size, up, projectorRef]);

  useFrame((_, delta) => {
    officeState.update(Math.min(delta, MAX_DELTA_TIME_SEC));

    const followCh =
      officeState.cameraFollowId !== null
        ? officeState.characters.get(officeState.cameraFollowId)
        : undefined;
    const focus = followCh ?? officeState.greeterCameraTarget;
    if (focus) {
      const t = target.current;
      t.x += (focus.x / PX_PER_UNIT - t.x) * CAMERA_FOLLOW_LERP;
      t.z += (focus.y / PX_PER_UNIT - t.z) * CAMERA_FOLLOW_LERP;
    }

    camera.position.copy(target.current).addScaledVector(forward, -THREE_CAMERA_DISTANCE);
    camera.lookAt(target.current);
    const cameraZoom = (zoom * TILE_SIZE) / dpr;
    if (camera.zoom !== cameraZoom) {
      camera.zoom = cameraZoom;
      camera.updateProjectionMatrix();
    }
  });
  return null;
}

function KeyLight({ officeState }: { officeState: OfficeState }) {
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

/** Pointer picking (agents, pets, seats) + middle-drag pan, all on the r3f canvas. */
function Interaction({
  officeState,
  onAgentClick,
  pickablesRef,
  target,
  zoom,
}: {
  officeState: OfficeState;
  onAgentClick: (agentId: number) => void;
  pickablesRef: React.MutableRefObject<THREE.Object3D[]>;
  target: React.MutableRefObject<THREE.Vector3>;
  zoom: number;
}) {
  const { camera, gl, raycaster, pointer } = useThree();
  const dpr = useThree((s) => s.viewport.dpr);
  const ground = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);

  useEffect(() => {
    const el = gl.domElement;
    const pan = { active: false, x: 0, y: 0 };
    const yaw = (THREE_CAMERA_YAW_DEG * Math.PI) / 180;
    const pitch = (THREE_CAMERA_PITCH_DEG * Math.PI) / 180;
    const unitsPerCssPx = () => dpr / (zoom * TILE_SIZE);

    const setPointer = (e: PointerEvent | MouseEvent) => {
      const rect = el.getBoundingClientRect();
      pointer.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
    };
    const pick = (): SpritePick | null => {
      const hits = raycaster.intersectObjects(pickablesRef.current, false);
      return hits.length > 0 ? (hits[0].object.userData.pick as SpritePick) : null;
    };

    const onMove = (e: PointerEvent) => {
      if (pan.active) {
        const k = unitsPerCssPx();
        const dx = (e.clientX - pan.x) * k;
        const dy = (e.clientY - pan.y) * k;
        pan.x = e.clientX;
        pan.y = e.clientY;
        // screen right = (cos yaw, 0, -sin yaw); screen down on the ground = (sin yaw, 0, cos yaw) / sin pitch
        target.current.x -= dx * Math.cos(yaw) + (dy * Math.sin(yaw)) / Math.sin(pitch);
        target.current.z -= -dx * Math.sin(yaw) + (dy * Math.cos(yaw)) / Math.sin(pitch);
        return;
      }
      setPointer(e);
      const hit = pick();
      officeState.hoveredAgentId = hit?.kind === 'agent' ? hit.id : null;
      el.style.cursor = hit ? 'pointer' : 'default';
    };
    const onDown = (e: PointerEvent) => {
      unlockAudio();
      if (e.button !== 1) return;
      e.preventDefault();
      pan.active = true;
      pan.x = e.clientX;
      pan.y = e.clientY;
      officeState.cameraFollowId = null;
      officeState.cancelGreeterCamera();
    };
    const onUp = (e: PointerEvent) => {
      if (e.button === 1) pan.active = false;
    };
    const onClick = (e: MouseEvent) => {
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
      pan.active = false;
      officeState.hoveredAgentId = null;
    };

    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('click', onClick);
    el.addEventListener('pointerleave', onLeave);
    return () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('click', onClick);
      el.removeEventListener('pointerleave', onLeave);
    };
  }, [
    gl,
    camera,
    raycaster,
    pointer,
    officeState,
    onAgentClick,
    pickablesRef,
    target,
    ground,
    zoom,
    dpr,
  ]);

  return null;
}

export function Office3D({
  officeState,
  zoom,
  onZoomChange,
  onAgentClick,
  projectorRef,
}: Office3DProps) {
  const reducedMotion = usePrefersReducedMotion();
  const basis = useMemo(() => cameraBasis(THREE_CAMERA_PITCH_DEG, THREE_CAMERA_YAW_DEG), []);
  const forward = useMemo(
    () => new THREE.Vector3(basis.forward.x, basis.forward.y, basis.forward.z),
    [basis],
  );
  const up = useMemo(() => new THREE.Vector3(basis.up.x, basis.up.y, basis.up.z), [basis]);
  const target = useRef<THREE.Vector3>(null!);
  if (target.current === null) {
    const layout = officeState.getLayout();
    target.current = new THREE.Vector3(layout.cols / 2, 0, layout.rows / 2);
  }
  const pickablesRef = useRef<THREE.Object3D[]>([]);
  const zoomAccumulator = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Ctrl/Cmd + wheel zooms (same stepping as 2D); plain wheel pans.
  const handleWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        zoomAccumulator.current += e.deltaY;
        if (Math.abs(zoomAccumulator.current) >= ZOOM_SCROLL_THRESHOLD) {
          const step = zoomAccumulator.current < 0 ? 1 : -1;
          zoomAccumulator.current = 0;
          const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom + step));
          if (next !== zoom) onZoomChange(next);
        }
        return;
      }
      const k = (window.devicePixelRatio || 1) / (zoom * TILE_SIZE);
      officeState.cameraFollowId = null;
      officeState.cancelGreeterCamera();
      target.current.x += e.deltaX * k;
      target.current.z += (e.deltaY * k) / Math.sin((THREE_CAMERA_PITCH_DEG * Math.PI) / 180);
    },
    [zoom, onZoomChange, officeState],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  return (
    <div ref={containerRef} className="w-full h-full bg-bg" onAuxClick={(e) => e.preventDefault()}>
      <Canvas
        orthographic
        flat
        shadows="soft"
        dpr={[1, 2]}
        gl={{ antialias: false, powerPreference: 'high-performance' }}
        camera={{ near: 0.1, far: THREE_CAMERA_DISTANCE * 2 + 100, zoom: 32 }}
      >
        <color attach="background" args={[THREE_BG_COLOR]} />
        <CameraRig
          officeState={officeState}
          zoom={zoom}
          target={target}
          forward={forward}
          up={up}
          projectorRef={projectorRef}
        />
        <ambientLight color={THREE_AMBIENT_COLOR} intensity={THREE_AMBIENT_INTENSITY * Math.PI} />
        <KeyLight officeState={officeState} />
        <MonitorLights officeState={officeState} />
        <FloorLayer officeState={officeState} reducedMotion={reducedMotion} />
        <SpriteLayer officeState={officeState} basis={basis} pickablesRef={pickablesRef} />
        <Interaction
          officeState={officeState}
          onAgentClick={onAgentClick}
          pickablesRef={pickablesRef}
          target={target}
          zoom={zoom}
        />
        <Effects />
      </Canvas>
    </div>
  );
}
