import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';

import {
  BUBBLE_FADE_DURATION_SEC,
  BUBBLE_VERTICAL_OFFSET_PX,
  CHARACTER_SITTING_OFFSET_PX,
  HEADLESS_CHARACTER_ALPHA,
  THREE_BUBBLE_RENDER_ORDER,
  THREE_HOVERED_EMISSIVE,
  THREE_SELECTED_EMISSIVE,
} from '../../../constants.js';
import { getCharacterSprite } from '../../engine/characters.js';
import type { OfficeState } from '../../engine/officeState.js';
import { getPetSpriteData } from '../../engine/petEntity.js';
import { isGhostHeadlessAgentsEnabled } from '../../engine/renderer.js';
import { getPetSprites } from '../../sprites/petSpriteData.js';
import {
  BUBBLE_PERMISSION_SPRITE,
  BUBBLE_WAITING_SPRITE,
  getCharacterSprites,
} from '../../sprites/spriteData.js';
import { CharacterState, type SpriteData, TILE_SIZE } from '../../types.js';
import { spriteTexture } from '../textureCache.js';
import { CARD_FILL, createCard } from './card.js';
import { relativeDirection } from './orbitMath.js';
import type { OrbitPick, OrbitViewState } from './OrbitRig.js';

interface Props {
  officeState: OfficeState;
  viewRef: React.MutableRefObject<OrbitViewState>;
  pickablesRef: React.MutableRefObject<THREE.Object3D[]>;
}

export function OrbitActors({ officeState, viewRef, pickablesRef }: Props) {
  const group = useMemo(() => new THREE.Group(), []);
  const pool = useMemo<Array<ReturnType<typeof createCard>>>(() => [], []);

  useEffect(
    () => () => {
      for (const m of pool) {
        m.material.dispose();
        (m.customDepthMaterial as THREE.Material).dispose();
      }
    },
    [pool],
  );

  useFrame(() => {
    const yaw = viewRef.current.yaw;
    const picks: THREE.Object3D[] = [];
    let used = 0;
    const place = (
      sprite: SpriteData,
      x: number,
      z: number,
      y: number,
      o: { alpha?: number; emissive?: number; bubble?: boolean; pick?: OrbitPick } = {},
    ) => {
      let mesh = pool[used];
      if (!mesh) {
        mesh = createCard();
        pool.push(mesh);
        group.add(mesh);
      }
      used++;
      const tex = spriteTexture(sprite);
      const mat = mesh.material;
      if (mat.map !== tex) {
        mat.map = tex;
        mat.emissiveMap = tex;
        (mesh.customDepthMaterial as THREE.MeshDepthMaterial).map = tex;
        mat.needsUpdate = true;
      }
      const alpha = o.alpha ?? 1;
      mat.transparent = alpha < 1;
      mat.opacity = alpha;
      mat.emissiveIntensity = CARD_FILL + (o.emissive ?? 0);
      mat.depthTest = !o.bubble;
      mesh.renderOrder = o.bubble ? THREE_BUBBLE_RENDER_ORDER : 0;
      mesh.castShadow = !o.bubble;
      mesh.scale.set(sprite[0].length / TILE_SIZE, sprite.length / TILE_SIZE, 1);
      mesh.position.set(x, y, z);
      mesh.rotation.set(0, yaw, 0);
      mesh.visible = true;
      mesh.userData.pick = o.pick;
      if (o.pick) picks.push(mesh);
    };

    const ghosts = isGhostHeadlessAgentsEnabled();
    for (const ch of officeState.getCharacters()) {
      const dir = relativeDirection(ch.dir, yaw);
      const sprite = getCharacterSprite(
        { ...ch, dir },
        getCharacterSprites(ch.palette, ch.hueShift),
      );
      const sitting = ch.state === CharacterState.TYPE || ch.state === CharacterState.REST;
      const lift = sitting ? -CHARACTER_SITTING_OFFSET_PX / TILE_SIZE : 0;
      const emissive =
        ch.id === officeState.selectedAgentId
          ? THREE_SELECTED_EMISSIVE
          : ch.id === officeState.hoveredAgentId
            ? THREE_HOVERED_EMISSIVE
            : 0;
      const x = ch.x / TILE_SIZE;
      const z = ch.y / TILE_SIZE;
      place(sprite, x, z, lift, {
        alpha: ch.isHeadless && ghosts ? HEADLESS_CHARACTER_ALPHA : 1,
        emissive,
        pick: { kind: 'agent', id: ch.id },
      });
      if (!ch.bubbleType || (ch.bubbleType === 'waiting' && ch.waitingAwaitingInput)) continue;
      const bubble =
        ch.bubbleType === 'permission' ? BUBBLE_PERMISSION_SPRITE : BUBBLE_WAITING_SPRITE;
      const bubbleAlpha =
        ch.bubbleType === 'waiting' && ch.bubbleTimer < BUBBLE_FADE_DURATION_SEC
          ? ch.bubbleTimer / BUBBLE_FADE_DURATION_SEC
          : 1;
      // Bubble bottom = lift + (2D vertical offset, in world units) + half the
      // character's own height. The character card's top already sits at
      // `lift + sprite.length / TILE_SIZE` (bottom-anchored quad), so this
      // formula floats the bubble ~0.5 tile above the head — tuned visually
      // in Step 2 against the isometric SpriteLayer look.
      // Deliberately reuses the character's own `lift` (world units) rather than
      // SpriteLayer's BUBBLE_SITTING_OFFSET_PX (a 2D screen-space nudge tuned for
      // isometric foreshortening): `lift` cancels out of the head-to-bubble gap
      // exactly, so seated and standing agents keep the same ~0.5-tile clearance
      // in this 3D view — measured via a debug world-position log (seated+bubble:
      // gapAboveHead = 0.5, same as standing).
      const bubbleY = lift + BUBBLE_VERTICAL_OFFSET_PX / TILE_SIZE + sprite.length / TILE_SIZE / 2;
      place(bubble, x, z, bubbleY, {
        alpha: bubbleAlpha,
        bubble: true,
      });
    }

    for (const pet of officeState.pets) {
      const sprite = getPetSpriteData(
        { ...pet, dir: relativeDirection(pet.dir, yaw) },
        getPetSprites(pet.petType),
      );
      if (!sprite) continue;
      place(sprite, pet.x / TILE_SIZE, pet.y / TILE_SIZE, 0, { pick: { kind: 'pet', id: pet.id } });
    }

    for (let i = used; i < pool.length; i++) pool[i].visible = false;
    pickablesRef.current = picks;
  });

  return <primitive object={group} />;
}
