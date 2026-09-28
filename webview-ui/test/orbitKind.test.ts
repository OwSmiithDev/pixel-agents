import { describe, expect, it } from 'vitest';

import {
  directionToOrientation,
  orbitKind,
  orientationToDirection,
} from '../src/office/three/orbit/orbitKind.js';
import { Direction } from '../src/office/types.js';

const base = { footprintW: 1, footprintH: 1, rotatable: false };

describe('orbitKind', () => {
  it('voxelizes electronics, wall items and misc', () => {
    expect(orbitKind({ ...base, type: 'PC', category: 'electronics', footprintH: 2 })).toBe(
      'voxel',
    );
    expect(orbitKind({ ...base, type: 'CLOCK', category: 'wall', canPlaceOnWalls: true })).toBe(
      'voxel',
    );
    expect(orbitKind({ ...base, type: 'BIN', category: 'misc' })).toBe('voxel');
  });
  it('turns desks into blocks', () => {
    expect(
      orbitKind({ ...base, type: 'DESK_FRONT', category: 'desks', footprintW: 3, footprintH: 2 }),
    ).toBe('box');
  });
  it('turns sofas into blocks but keeps single chairs as direction cards', () => {
    expect(
      orbitKind({
        ...base,
        type: 'SOFA_FRONT',
        category: 'chairs',
        footprintW: 2,
        rotatable: true,
      }),
    ).toBe('box');
    expect(
      orbitKind({ ...base, type: 'SOFA_SIDE', category: 'chairs', footprintH: 2, rotatable: true }),
    ).toBe('box');
    expect(
      orbitKind({
        ...base,
        type: 'WOODEN_CHAIR_BACK',
        category: 'chairs',
        footprintH: 2,
        backgroundTiles: 1,
        rotatable: true,
      }),
    ).toBe('dirCard');
    expect(orbitKind({ ...base, type: 'WOODEN_BENCH', category: 'chairs' })).toBe('yCard');
  });
  it('keeps decor and unknown categories as Y cards', () => {
    expect(orbitKind({ ...base, type: 'PLANT', category: 'decor', footprintH: 2 })).toBe('yCard');
    expect(orbitKind({ ...base, type: 'THING', category: 'mystery' })).toBe('yCard');
    expect(orbitKind({ ...base, type: 'THING' })).toBe('yCard');
  });
});

describe('orientation mapping', () => {
  it('maps catalog orientations to world facing and back', () => {
    expect(orientationToDirection('front')).toBe(Direction.DOWN);
    expect(orientationToDirection('back')).toBe(Direction.UP);
    expect(orientationToDirection('left')).toBe(Direction.LEFT);
    expect(orientationToDirection('side')).toBe(Direction.RIGHT);
    expect(orientationToDirection(undefined)).toBe(Direction.DOWN);
    expect(directionToOrientation(Direction.UP)).toBe('back');
  });
});
