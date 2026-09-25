import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

import {
  BUBBLE_FADE_DURATION_SEC,
  BUBBLE_SITTING_OFFSET_PX,
  BUBBLE_VERTICAL_OFFSET_PX,
  CHARACTER_SITTING_OFFSET_PX,
  CHARACTER_Z_SORT_OFFSET,
  HEADLESS_CHARACTER_ALPHA,
  THREE_ACCENT_COLOR,
  THREE_ALPHA_TEST,
  THREE_AMBIENT_INTENSITY,
  THREE_BUBBLE_RENDER_ORDER,
  THREE_HOVERED_EMISSIVE,
  THREE_SELECTED_EMISSIVE,
} from '../../constants.js';
import { getCharacterSprite } from '../engine/characters.js';
import type { OfficeState } from '../engine/officeState.js';
import { getPetSpriteData } from '../engine/petEntity.js';
import { isGhostHeadlessAgentsEnabled } from '../engine/renderer.js';
import { getPetSprites } from '../sprites/petSpriteData.js';
import {
  BUBBLE_PERMISSION_SPRITE,
  BUBBLE_WAITING_SPRITE,
  getCharacterSprites,
} from '../sprites/spriteData.js';
import type { FurnitureInstance, SpriteData } from '../types.js';
import { CharacterState, TILE_SIZE } from '../types.js';
import { getWallInstances, hasWallSprites } from '../wallTiles.js';
import type { CameraBasis } from './coords.js';
import { placeSprite } from './coords.js';
import { spriteTexture } from './textureCache.js';

/** What a pickable sprite represents; stored on `mesh.userData.pick`. */
export type SpritePick = { kind: 'agent'; id: number } | { kind: 'pet'; id: string };

interface Drawable {
  sprite: SpriteData;
  leftPx: number;
  topPx: number;
  zY: number;
  mirrored?: boolean;
  alpha?: number;
  emissive?: number;
  bubble?: boolean;
  pick?: SpritePick;
}

interface PooledSprite {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshLambertMaterial>;
  depth: THREE.MeshDepthMaterial;
}

// Unit quad anchored at its bottom-center, so scale = sprite size in world units.
const quad = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
const accent = new THREE.Color(THREE_ACCENT_COLOR);
const white = new THREE.Color(1, 1, 1);
/**
 * Sprites face the camera, so the key light (behind) never reaches their front.
 * An emissive fill with the sprite's own texture tops ambient up to 1.0, so the
 * art keeps its 2D brightness while monitor lights still add on top.
 */
const SPRITE_FILL = Math.max(0, 1 - THREE_AMBIENT_INTENSITY);

function createPooledSprite(): PooledSprite {
  const material = new THREE.MeshLambertMaterial({
    alphaTest: THREE_ALPHA_TEST,
    side: THREE.DoubleSide,
    emissive: white.clone(),
    emissiveIntensity: SPRITE_FILL,
  });
  const depth = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
    alphaTest: THREE_ALPHA_TEST,
  });
  const mesh = new THREE.Mesh(quad, material);
  mesh.customDepthMaterial = depth;
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  return { mesh, depth };
}

function collectDrawables(officeState: OfficeState, walls: FurnitureInstance[]): Drawable[] {
  const out: Drawable[] = [];
  for (const f of walls) out.push({ sprite: f.sprite, leftPx: f.x, topPx: f.y, zY: f.zY });
  for (const f of officeState.furniture) {
    out.push({ sprite: f.sprite, leftPx: f.x, topPx: f.y, zY: f.zY, mirrored: f.mirrored });
  }

  const ghosts = isGhostHeadlessAgentsEnabled();
  for (const ch of officeState.getCharacters()) {
    const sprite = getCharacterSprite(ch, getCharacterSprites(ch.palette, ch.hueShift));
    const w = sprite[0].length;
    const h = sprite.length;
    const sitting = ch.state === CharacterState.TYPE || ch.state === CharacterState.REST;
    const emissive =
      ch.id === officeState.selectedAgentId
        ? THREE_SELECTED_EMISSIVE
        : ch.id === officeState.hoveredAgentId
          ? THREE_HOVERED_EMISSIVE
          : 0;
    const charZY = ch.y + TILE_SIZE / 2 + CHARACTER_Z_SORT_OFFSET;
    out.push({
      sprite,
      leftPx: ch.x - w / 2,
      topPx: ch.y + (sitting ? CHARACTER_SITTING_OFFSET_PX : 0) - h,
      zY: charZY,
      alpha: ch.isHeadless && ghosts ? HEADLESS_CHARACTER_ALPHA : 1,
      emissive,
      pick: { kind: 'agent', id: ch.id },
    });

    // Speech bubble (same rules as the 2D renderer)
    if (!ch.bubbleType || (ch.bubbleType === 'waiting' && ch.waitingAwaitingInput)) continue;
    const bubble =
      ch.bubbleType === 'permission' ? BUBBLE_PERMISSION_SPRITE : BUBBLE_WAITING_SPRITE;
    const bubbleAlpha =
      ch.bubbleType === 'waiting' && ch.bubbleTimer < BUBBLE_FADE_DURATION_SEC
        ? ch.bubbleTimer / BUBBLE_FADE_DURATION_SEC
        : 1;
    const sittingOff = sitting ? BUBBLE_SITTING_OFFSET_PX : 0;
    out.push({
      sprite: bubble,
      leftPx: ch.x - bubble[0].length / 2,
      topPx: ch.y + sittingOff - BUBBLE_VERTICAL_OFFSET_PX - bubble.length - 1,
      zY: charZY,
      alpha: bubbleAlpha,
      bubble: true,
    });
  }

  for (const pet of officeState.pets) {
    const sprite = getPetSpriteData(pet, getPetSprites(pet.petType));
    if (!sprite) continue;
    out.push({
      sprite,
      leftPx: pet.x - sprite[0].length / 2,
      topPx: pet.y - sprite.length,
      zY: pet.y + TILE_SIZE / 2,
      pick: { kind: 'pet', id: pet.id },
    });
  }
  return out;
}

interface SpriteLayerProps {
  officeState: OfficeState;
  basis: CameraBasis;
  /** Filled every frame with the meshes that can be clicked (agents, pets). */
  pickablesRef: React.MutableRefObject<THREE.Object3D[]>;
}

// ponytail: one draw call per sprite (~500 for a 40×30 office). Switch to
// per-texture InstancedMesh batches if frame time ever becomes a problem.
export function SpriteLayer({ officeState, basis, pickablesRef }: SpriteLayerProps) {
  const camera = useThree((s) => s.camera);
  const group = useMemo(() => new THREE.Group(), []);
  const pool = useRef<PooledSprite[]>([]);
  const wallCache = useRef<{ layout: unknown; walls: FurnitureInstance[] }>({
    layout: null,
    walls: [],
  });

  useEffect(
    () => () => {
      for (const p of pool.current) {
        p.mesh.material.dispose();
        p.depth.dispose();
      }
      pool.current = [];
    },
    [],
  );

  useFrame(() => {
    const layout = officeState.getLayout();
    if (wallCache.current.layout !== layout) {
      wallCache.current = {
        layout,
        walls: hasWallSprites()
          ? getWallInstances(officeState.tileMap, layout.tileColors, layout.cols)
          : [],
      };
    }

    const drawables = collectDrawables(officeState, wallCache.current.walls);
    while (pool.current.length < drawables.length) {
      const p = createPooledSprite();
      pool.current.push(p);
      group.add(p.mesh);
    }

    const pickables: THREE.Object3D[] = [];
    for (let i = 0; i < pool.current.length; i++) {
      const { mesh, depth } = pool.current[i];
      const d = drawables[i];
      if (!d) {
        mesh.visible = false;
        continue;
      }
      const texture = spriteTexture(d.sprite);
      const material = mesh.material;
      if (material.map !== texture) {
        material.map = texture;
        material.emissiveMap = texture;
        depth.map = texture;
        material.needsUpdate = true;
        depth.needsUpdate = true;
      }
      const alpha = d.alpha ?? 1;
      material.transparent = alpha < 1;
      material.opacity = alpha;
      // Selection/hover: white fill + accent on top (emissive = fill·white + e·accent).
      const extra = d.emissive ?? 0;
      material.emissive.copy(white).lerp(accent, extra / (SPRITE_FILL + extra || 1));
      material.emissiveIntensity = SPRITE_FILL + extra;
      material.depthTest = !d.bubble;
      mesh.renderOrder = d.bubble ? THREE_BUBBLE_RENDER_ORDER : 0;
      mesh.castShadow = !d.bubble;

      const place = placeSprite(
        {
          leftPx: d.leftPx,
          topPx: d.topPx,
          widthPx: d.sprite[0].length,
          heightPx: d.sprite.length,
          zY: d.zY,
        },
        basis,
      );
      mesh.position.set(place.position.x, place.position.y, place.position.z);
      mesh.quaternion.copy(camera.quaternion);
      mesh.scale.set(d.mirrored ? -place.width : place.width, place.height, 1);
      mesh.visible = true;
      mesh.userData.pick = d.pick;
      if (d.pick) pickables.push(mesh);
    }
    pickablesRef.current = pickables;
  });

  return <primitive object={group} />;
}
