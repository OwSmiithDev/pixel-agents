import { Direction, TILE_SIZE } from '../../types.js';

/** World facing angle (atan2(x, z)): DOWN = +z = 0, RIGHT = +x = π/2, UP = π, LEFT = -π/2. */
const FACING_ANGLE: Record<Direction, number> = {
  [Direction.DOWN]: 0,
  [Direction.RIGHT]: Math.PI / 2,
  [Direction.UP]: Math.PI,
  [Direction.LEFT]: -Math.PI / 2,
};
/** Quarter turns of (facing − yaw) → sprite direction as seen by the camera. */
const BY_QUARTER = [Direction.DOWN, Direction.RIGHT, Direction.UP, Direction.LEFT] as const;

/** Which of the 4 sprite directions shows a world-facing `worldDir` to a camera at `yaw`. */
export function relativeDirection(worldDir: Direction, yaw: number): Direction {
  const quarter = Math.round((FACING_ANGLE[worldDir] - yaw) / (Math.PI / 2));
  return BY_QUARTER[((quarter % 4) + 4) % 4];
}

export function snapYaw(yaw: number, steps = 4): number {
  const step = (Math.PI * 2) / steps;
  return Math.round(yaw / step) * step;
}

/**
 * A wall is cut when it lies on the camera's side of the target, inside a cone of
 * `halfAngleDeg` around the camera direction, and within `radius` tiles.
 */
export function shouldCutWall(
  wall: { x: number; z: number },
  target: { x: number; z: number },
  yaw: number,
  radius: number,
  halfAngleDeg: number,
): boolean {
  const dx = wall.x - target.x;
  const dz = wall.z - target.z;
  const dist = Math.hypot(dx, dz);
  if (dist === 0 || dist > radius) return false;
  const cos = (dx * Math.sin(yaw) + dz * Math.cos(yaw)) / dist;
  return cos > Math.cos((halfAngleDeg * Math.PI) / 180);
}

/** Perspective camera distance that shows the target plane at the same scale as the ortho view. */
export function perspDistance(
  viewHeightCssPx: number,
  zoom: number,
  dpr: number,
  fovDeg: number,
): number {
  const visibleUnits = viewHeightCssPx / ((zoom * TILE_SIZE) / dpr);
  return visibleUnits / (2 * Math.tan((fovDeg * Math.PI) / 360));
}
