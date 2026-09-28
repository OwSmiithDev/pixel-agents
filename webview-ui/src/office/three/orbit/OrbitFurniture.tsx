import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';

import {
  ORBIT_CHAIR_BACK_OFFSET,
  ORBIT_VOXEL_DEPTH_PX,
  THREE_ALPHA_TEST,
} from '../../../constants.js';
import type { OfficeState } from '../../engine/officeState.js';
import {
  getCatalogEntry,
  getOrientationInGroup,
  getRotatedType,
  isRotatable,
} from '../../layout/furnitureCatalog.js';
import { furnitureSprite } from '../../layout/layoutSerializer.js';
import { getCachedSprite } from '../../sprites/spriteCache.js';
import {
  Direction,
  type FurnitureInstance,
  type SpriteData,
  TILE_SIZE,
  TileType,
} from '../../types.js';
import { configurePixelTexture, spriteTexture } from '../textureCache.js';
import { boxFaces } from './boxFaces.js';
import { createCard } from './card.js';
import {
  directionToOrientation,
  type OrbitKind,
  orbitKind,
  orientationToDirection,
} from './orbitKind.js';
import { relativeDirection } from './orbitMath.js';
import type { OrbitViewState } from './OrbitRig.js';
import { maskKey, opaqueBounds, type VoxelCell, voxelize } from './voxelize.js';

const S = 1 / TILE_SIZE;
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);

type Card = ReturnType<typeof createCard>;

interface Built {
  kind: OrbitKind;
  sprite: SpriteData;
  object: THREE.Object3D;
  /** Wall tile key that hides this item when cut. */
  wallKey?: string;
  voxel?: { mesh: THREE.InstancedMesh; cells: VoxelCell[]; mask: string };
  card?: Card;
  /** dirCard: world facing + sprite per viewed orientation. */
  dir?: {
    facing: Direction;
    views: Partial<Record<string, { sprite: SpriteData; mirrored: boolean }>>;
  };
  /** Desk block height (tiles), re-registered in the height map while the block is unchanged. */
  deskHeight?: number;
  /** Instance placement the object was built for; any change rebuilds it. */
  x: number;
  y: number;
  mirrored: boolean;
  /** Materials, textures, geometries and instanced meshes (their GL buffers) this item owns. */
  owned: Array<{ dispose(): void }>;
}

type BuiltCore = Omit<Built, 'x' | 'y' | 'mirrored'>;

function cropTexture(
  sprite: SpriteData,
  x: number,
  y: number,
  w: number,
  h: number,
): THREE.CanvasTexture {
  const src = getCachedSprite(sprite, 1);
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  c.getContext('2d')!.drawImage(src, x, y, w, h, 0, 0, w, h);
  return configurePixelTexture(new THREE.CanvasTexture(c));
}

function setCardSprite(card: Card, sprite: SpriteData, mirrored: boolean) {
  const tex = spriteTexture(sprite);
  if (card.material.map !== tex) {
    card.material.map = tex;
    card.material.emissiveMap = tex;
    (card.customDepthMaterial as THREE.MeshDepthMaterial).map = tex;
    card.material.needsUpdate = true;
  }
  card.scale.set((mirrored ? -1 : 1) * sprite[0].length * S, sprite.length * S, 1);
}

function voxelMesh(cells: VoxelCell[]): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(UNIT_BOX, new THREE.MeshLambertMaterial(), cells.length);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const color = new THREE.Color();
  cells.forEach((c, i) => {
    mesh.setMatrixAt(i, m4.compose(p.set(c.x, c.y, c.z), q, s.set(c.sx, c.sy, c.sz)));
    mesh.setColorAt(i, color.set(c.color));
  });
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function recolor(v: NonNullable<Built['voxel']>, sprite: SpriteData) {
  const color = new THREE.Color();
  v.cells.forEach((c, i) => v.mesh.setColorAt(i, color.set(sprite[c.py][c.px].slice(0, 7))));
  v.mesh.instanceColor!.needsUpdate = true;
}

/** Sprite shown for each orientation of a rotatable chair, colorized like the placed one. */
function chairViews(inst: FurnitureInstance): NonNullable<Built['dir']> {
  const type = inst.type!;
  const views: NonNullable<Built['dir']>['views'] = {};
  let t: string | null = type;
  for (let i = 0; i < 4 && t; i++) {
    const orient = getOrientationInGroup(t);
    const entry = getCatalogEntry(t);
    const sprite = furnitureSprite(t, inst.color);
    if (orient && entry && sprite && !views[orient]) {
      views[orient] = { sprite, mirrored: Boolean(entry.mirrorSide && orient === 'left') };
    }
    t = getRotatedType(t, 'cw');
    if (t === type) break;
  }
  return { facing: orientationToDirection(getOrientationInGroup(type)), views };
}

function orbitKindOf(inst: FurnitureInstance): OrbitKind | null {
  const entry = getCatalogEntry(inst.type!);
  if (!entry) return null;
  return orbitKind({
    type: inst.type!,
    category: entry.category,
    footprintW: entry.footprintW,
    footprintH: entry.footprintH,
    backgroundTiles: entry.backgroundTiles,
    canPlaceOnWalls: entry.canPlaceOnWalls,
    rotatable: isRotatable(inst.type!),
  });
}

function markDesk(
  inst: FurnitureInstance,
  footprintW: number,
  footprintH: number,
  height: number,
  deskTop: Map<string, number>,
) {
  for (let dr = 0; dr < footprintH; dr++)
    for (let dc = 0; dc < footprintW; dc++)
      deskTop.set(`${inst.col! + dc},${inst.row! + dr}`, height);
}

interface Props {
  officeState: OfficeState;
  viewRef: React.MutableRefObject<OrbitViewState>;
  cutRef: React.MutableRefObject<Set<string>>;
}

export function OrbitFurniture({ officeState, viewRef, cutRef }: Props) {
  const group = useMemo(() => new THREE.Group(), []);
  const built = useMemo(() => new Map<string, Built>(), []);
  const state = useMemo(
    () => ({
      last: null as FurnitureInstance[] | null,
      tileMap: null as OfficeState['tileMap'] | null,
    }),
    [],
  );

  const dispose = (b: Built) => {
    group.remove(b.object);
    for (const o of b.owned) o.dispose();
  };
  useEffect(() => () => built.forEach(dispose), [built]); // eslint-disable-line react-hooks/exhaustive-deps

  const build = (
    inst: FurnitureInstance,
    kind: OrbitKind,
    deskTop: Map<string, number>,
  ): BuiltCore | null => {
    const entry = getCatalogEntry(inst.type!);
    if (!entry) return null;
    const sprite = inst.sprite;
    const b = opaqueBounds(sprite);
    if (b.h === 0) return null;
    const W = sprite[0].length;
    const H = sprite.length;
    const bottom = b.y + b.h;
    const ox = inst.x * S;
    const oz = inst.y * S;
    const owned: Built['owned'] = [];
    const holder = new THREE.Group();
    const inner = new THREE.Group();
    holder.add(inner);
    if (inst.mirrored && (kind === 'box' || kind === 'voxel')) {
      inner.scale.x = -1;
      inner.position.x = W * S;
    }

    if (kind === 'box') {
      const f = boxFaces(sprite)!;
      const top = cropTexture(sprite, b.x, f.topRows[0], b.w, f.topRows[1] - f.topRows[0]);
      const front = cropTexture(sprite, b.x, f.frontRows[0], b.w, f.frontRows[1] - f.frontRows[0]);
      const side = cropTexture(
        sprite,
        f.sideCol,
        f.frontRows[0],
        1,
        f.frontRows[1] - f.frontRows[0],
      );
      const mat = (map: THREE.Texture) =>
        new THREE.MeshLambertMaterial({ map, alphaTest: THREE_ALPHA_TEST, side: THREE.DoubleSide });
      const mats = [mat(side), mat(side), mat(top), mat(top), mat(front), mat(front)];
      const geo = new THREE.BoxGeometry(b.w * S, f.height, (bottom - b.y) * S);
      const mesh = new THREE.Mesh(geo, mats);
      mesh.position.set((b.x + b.w / 2) * S, f.height / 2, ((b.y + bottom) / 2) * S);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      inner.add(mesh);
      holder.position.set(ox, 0, oz);
      owned.push(top, front, side, geo, ...mats);
      const deskHeight = entry.category === 'desks' ? f.height : undefined;
      if (deskHeight !== undefined)
        markDesk(inst, entry.footprintW, entry.footprintH, deskHeight, deskTop);
      return { kind, sprite, object: holder, owned, deskHeight };
    }

    if (kind === 'voxel') {
      const electronics = entry.category === 'electronics';
      const depthPx = entry.canPlaceOnWalls
        ? ORBIT_VOXEL_DEPTH_PX.wall
        : electronics
          ? ORBIT_VOXEL_DEPTH_PX.electronics
          : ORBIT_VOXEL_DEPTH_PX.misc;
      const model = voxelize(sprite, { depthPx, splitLying: electronics });
      const mesh = voxelMesh(model.cells);
      inner.add(mesh);
      // The mesh itself: InstancedMesh.dispose() frees its instance buffers (not UNIT_BOX).
      owned.push(mesh, mesh.material as THREE.Material);
      let wallRow = -1;
      if (entry.canPlaceOnWalls) {
        // Also the row just above the footprint: an item placed on the floor tile in front of a
        // wall (a 1-row bookshelf) belongs flush on that wall, not a tile out on the floor.
        for (let r = inst.row! + entry.footprintH - 1; r >= inst.row! - 1; r--) {
          if (officeState.tileMap[r]?.[inst.col!] === TileType.WALL) {
            wallRow = r;
            break;
          }
        }
      }
      let wallKey: string | undefined;
      if (wallRow >= 0) {
        wallKey = `${inst.col},${wallRow}`;
        const y = Math.max(0, ((wallRow + 1) * TILE_SIZE - (inst.y + model.standEndPx)) * S);
        holder.position.set(ox, y, wallRow + 1 + depthPx * S);
      } else {
        let y = 0;
        if (entry.canPlaceOnSurfaces) {
          for (let dr = 0; dr < entry.footprintH; dr++)
            for (let dc = 0; dc < entry.footprintW; dc++)
              y = Math.max(y, deskTop.get(`${inst.col! + dc},${inst.row! + dr}`) ?? 0);
        }
        holder.position.set(ox, y, oz + model.standEndPx * S);
      }
      return {
        kind,
        sprite,
        object: holder,
        wallKey,
        voxel: { mesh, cells: model.cells, mask: maskKey(sprite) },
        owned,
      };
    }

    // Cards (shared card recipe; each card owns its materials, never the sprite textures).
    const card = createCard();
    owned.push(card.material, card.customDepthMaterial as THREE.Material);
    inner.add(card);
    if (kind === 'dirCard') {
      const dir = chairViews(inst);
      let x = ox + (W / 2) * S;
      let z = oz + entry.footprintH - 0.5;
      const off = ORBIT_CHAIR_BACK_OFFSET;
      if (dir.facing === Direction.DOWN) z -= off;
      else if (dir.facing === Direction.UP) z += off;
      else if (dir.facing === Direction.LEFT) x += off;
      else x -= off;
      card.position.set(x, -(H - bottom) * S, z);
      setCardSprite(card, sprite, Boolean(inst.mirrored));
      return { kind, sprite, object: holder, card, dir, owned };
    }
    card.position.set(ox + (W / 2) * S, -(H - bottom) * S, oz + bottom * S - 0.01);
    setCardSprite(card, sprite, Boolean(inst.mirrored));
    return { kind, sprite, object: holder, card, owned };
  };

  const reconcile = (list: FurnitureInstance[]) => {
    const deskTop = new Map<string, number>();
    const seen = new Set<string>();
    // Blocks first so surface items know the desk heights.
    const withKind = list
      .filter((inst) => inst.uid && inst.type)
      .map((inst) => ({ inst, kind: orbitKindOf(inst) }))
      .sort((a, b) => Number(b.kind === 'box') - Number(a.kind === 'box'));
    for (const { inst, kind } of withKind) {
      if (!kind) continue;
      const uid = inst.uid!;
      seen.add(uid);
      const prev = built.get(uid);
      const samePlace =
        prev && prev.x === inst.x && prev.y === inst.y && prev.mirrored === Boolean(inst.mirrored);
      if (samePlace && prev.kind === kind && prev.sprite === inst.sprite) {
        // Unchanged: keep the desk height map up to date.
        if (prev.deskHeight !== undefined) {
          const entry = getCatalogEntry(inst.type!)!;
          markDesk(inst, entry.footprintW, entry.footprintH, prev.deskHeight, deskTop);
        }
        continue;
      }
      if (samePlace && prev.voxel && kind === 'voxel' && prev.voxel.mask === maskKey(inst.sprite)) {
        // Same shape, new colors (PC screen frames, editor color): recolor in place.
        recolor(prev.voxel, inst.sprite);
        prev.sprite = inst.sprite;
        continue;
      }
      if (prev) dispose(prev);
      const core = build(inst, kind, deskTop);
      if (!core) {
        built.delete(uid);
        continue;
      }
      const next: Built = { ...core, x: inst.x, y: inst.y, mirrored: Boolean(inst.mirrored) };
      built.set(uid, next);
      group.add(next.object);
    }
    for (const [uid, b] of built) {
      if (!seen.has(uid)) {
        dispose(b);
        built.delete(uid);
      }
    }
  };

  useFrame(() => {
    if (officeState.tileMap !== state.tileMap) {
      // New tile map (layout load/import): wall anchoring may change, so rebuild everything.
      state.tileMap = officeState.tileMap;
      built.forEach(dispose);
      built.clear();
      state.last = null;
    }
    if (officeState.furniture !== state.last) {
      state.last = officeState.furniture;
      reconcile(officeState.furniture);
    }
    const yaw = viewRef.current.yaw;
    const cut = cutRef.current;
    for (const b of built.values()) {
      if (b.wallKey) b.object.visible = !cut.has(b.wallKey);
      if (!b.card) continue;
      b.card.rotation.set(0, yaw, 0);
      if (b.dir) {
        const view = b.dir.views[directionToOrientation(relativeDirection(b.dir.facing, yaw))];
        if (view) setCardSprite(b.card, view.sprite, view.mirrored);
      }
    }
  });

  return <primitive object={group} />;
}
