import { describe, expect, it } from 'vitest';

import {
  perspDistance,
  relativeDirection,
  shouldCutWall,
  snapYaw,
} from '../src/office/three/orbit/orbitMath.js';
import { Direction } from '../src/office/types.js';

const Q = Math.PI / 2;

describe('relativeDirection', () => {
  it('is the identity at yaw 0 (same view as the isometric 3D)', () => {
    for (const d of [Direction.DOWN, Direction.LEFT, Direction.RIGHT, Direction.UP]) {
      expect(relativeDirection(d, 0)).toBe(d);
    }
  });
  it('shows the back when the camera is behind', () => {
    expect(relativeDirection(Direction.DOWN, Math.PI)).toBe(Direction.UP);
    expect(relativeDirection(Direction.LEFT, Math.PI)).toBe(Direction.RIGHT);
  });
  it('rotates a quarter turn (camera on +x)', () => {
    // Facing +x toward a camera sitting on +x = facing the viewer.
    expect(relativeDirection(Direction.RIGHT, Q)).toBe(Direction.DOWN);
    // Facing -z seen from +x = walking to screen-right.
    expect(relativeDirection(Direction.UP, Q)).toBe(Direction.RIGHT);
  });
  it('rounds to the nearest quarter and wraps negative yaw', () => {
    expect(relativeDirection(Direction.DOWN, 0.6)).toBe(Direction.DOWN);
    expect(relativeDirection(Direction.DOWN, -Q)).toBe(Direction.RIGHT);
  });
});

describe('snapYaw', () => {
  it('snaps to the nearest 90 degrees', () => {
    expect(snapYaw(0.9)).toBeCloseTo(Q);
    expect(snapYaw(-0.9)).toBeCloseTo(-Q);
    expect(snapYaw(-0.7)).toBeCloseTo(0);
    expect(snapYaw(0.1)).toBeCloseTo(0);
  });
});

describe('shouldCutWall', () => {
  const target = { x: 10, z: 10 };
  it('cuts a wall between the camera and the target', () => {
    // yaw 0: camera on +z side
    expect(shouldCutWall({ x: 10, z: 14 }, target, 0, 14, 70)).toBe(true);
  });
  it('keeps a wall behind the target', () => {
    expect(shouldCutWall({ x: 10, z: 6 }, target, 0, 14, 70)).toBe(false);
  });
  it('keeps a wall to the side', () => {
    expect(shouldCutWall({ x: 16, z: 10 }, target, 0, 14, 70)).toBe(false);
  });
  it('keeps walls beyond the radius', () => {
    expect(shouldCutWall({ x: 10, z: 30 }, target, 0, 14, 70)).toBe(false);
  });
});

describe('perspDistance', () => {
  it('matches the ortho scale at the target plane', () => {
    // 600 css px tall, zoom 2, dpr 1 → 600 / 32 = 18.75 units visible.
    const d = perspDistance(600, 2, 1, 38);
    expect(2 * d * Math.tan((19 * Math.PI) / 180)).toBeCloseTo(18.75);
  });
});
