import { Direction } from '../../types.js';

export type OrbitKind = 'voxel' | 'box' | 'dirCard' | 'yCard';

export interface OrbitKindInput {
  type: string;
  category?: string;
  footprintW: number;
  footprintH: number;
  backgroundTiles?: number;
  canPlaceOnWalls?: boolean;
  rotatable: boolean;
}

/** Per-type exceptions when the category rule looks wrong for one asset. */
export const ORBIT_KIND_OVERRIDES: Record<string, OrbitKind> = {};

export function orbitKind(f: OrbitKindInput): OrbitKind {
  const override = ORBIT_KIND_OVERRIDES[f.type];
  if (override) return override;
  if (f.canPlaceOnWalls) return 'voxel';
  switch (f.category) {
    case 'electronics':
    case 'misc':
      return 'voxel';
    case 'desks':
      return 'box';
    case 'chairs': {
      const solidTiles = f.footprintW * (f.footprintH - (f.backgroundTiles ?? 0));
      if (solidTiles >= 2) return 'box';
      return f.rotatable ? 'dirCard' : 'yCard';
    }
    default:
      return 'yCard';
  }
}

export function orientationToDirection(orient: string | undefined): Direction {
  switch (orient) {
    case undefined:
    case 'front':
      return Direction.DOWN;
    case 'back':
      return Direction.UP;
    case 'left':
      return Direction.LEFT;
    default:
      return Direction.RIGHT;
  }
}

export function directionToOrientation(d: Direction): 'front' | 'back' | 'left' | 'right' {
  if (d === Direction.DOWN) return 'front';
  if (d === Direction.UP) return 'back';
  return d === Direction.LEFT ? 'left' : 'right';
}
