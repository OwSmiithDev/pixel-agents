import type { SpriteData } from '../../types.js';

const PX = 1 / 16;
/** Pixels brighter than this are recessed one pixel (screens, book spines). */
const RECESS_LUMINANCE = 0.55;

export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function opaqueBounds(sprite: SpriteData): Bounds {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -1;
  let y1 = -1;
  sprite.forEach((row, y) =>
    row.forEach((c, x) => {
      if (!c) return;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }),
  );
  if (x1 < 0) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export function maskKey(sprite: SpriteData): string {
  return sprite.map((row) => row.map((c) => (c ? '1' : '0')).join('')).join('|');
}

function luminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (r + g + b) / 765;
}

export interface VoxelCell {
  px: number;
  py: number;
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  color: string;
}

export interface VoxelModel {
  cells: VoxelCell[];
  standTopPx: number;
  /** Exclusive end row of the standing part. */
  standEndPx: number;
  lyingRows: number;
}

/**
 * One cube per opaque pixel. Standing pixels are extruded `depthPx` toward −z (front face at
 * z = 0, bright pixels recessed by one). With `splitLying`, rows below the first fully empty row
 * inside the opaque rectangle lie flat in front of the standing part (a keyboard under a monitor).
 */
export function voxelize(
  sprite: SpriteData,
  opts: { depthPx: number; splitLying: boolean },
): VoxelModel {
  const b = opaqueBounds(sprite);
  const bottom = b.y + b.h;
  let standEnd = bottom;
  if (opts.splitLying) {
    for (let y = b.y + 1; y < bottom; y++) {
      if (sprite[y].every((c) => !c)) {
        standEnd = y;
        break;
      }
    }
  }
  let lyingStart = bottom;
  for (let y = standEnd; y < bottom; y++) {
    if (sprite[y].some((c) => c)) {
      lyingStart = y;
      break;
    }
  }
  const cells: VoxelCell[] = [];
  const D = opts.depthPx;
  for (let py = b.y; py < bottom; py++) {
    for (let px = b.x; px < b.x + b.w; px++) {
      const raw = sprite[py][px];
      if (!raw) continue;
      const color = raw.slice(0, 7).toUpperCase();
      const x = (px + 0.5) * PX;
      if (py < standEnd) {
        const recessed = D > 2 && luminance(color) > RECESS_LUMINANCE;
        const d = recessed ? D - 1 : D;
        const front = recessed ? -PX : 0;
        cells.push({
          px,
          py,
          x,
          y: (standEnd - py - 0.5) * PX,
          z: front - (d * PX) / 2,
          sx: PX,
          sy: PX,
          sz: d * PX,
          color,
        });
      } else {
        cells.push({
          px,
          py,
          x,
          y: PX / 2,
          z: (py - lyingStart + 0.5) * PX,
          sx: PX,
          sy: PX,
          sz: PX,
          color,
        });
      }
    }
  }
  return {
    cells,
    standTopPx: b.h ? b.y : 0,
    standEndPx: standEnd,
    lyingRows: lyingStart < bottom ? bottom - lyingStart : 0,
  };
}
