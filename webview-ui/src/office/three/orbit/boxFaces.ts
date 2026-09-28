import type { SpriteData } from '../../types.js';
import { type Bounds, opaqueBounds } from './voxelize.js';

export interface BoxFaces {
  bounds: Bounds;
  /** [start, end) sprite rows pasted on the top face. */
  topRows: [number, number];
  /** [start, end) sprite rows pasted on the front and back faces. */
  frontRows: [number, number];
  /** Block height in tiles. */
  height: number;
  /** Sprite column stretched over the side faces. */
  sideCol: number;
}

/** 3/4 top-down art: the lower band of the sprite is the front, the rest is the top. */
export function boxFaces(sprite: SpriteData): BoxFaces | null {
  const bounds = opaqueBounds(sprite);
  if (bounds.h === 0) return null;
  const bottom = bounds.y + bounds.h;
  const frontPx = Math.min(bounds.h, Math.max(4, Math.min(12, Math.round(sprite.length * 0.3))));
  const frontStart = bottom - frontPx;
  const lastRow = sprite[bottom - 1];
  const sideCol = Math.max(
    0,
    lastRow.findIndex((c) => c !== ''),
  );
  return {
    bounds,
    topRows: [bounds.y, frontStart],
    frontRows: [frontStart, bottom],
    height: frontPx / 16,
    sideCol,
  };
}
