import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { pngToSpriteData } from '../../core/src/assets/pngDecoder.ts';
import { boxFaces } from '../src/office/three/orbit/boxFaces.js';

const FURN = path.join(__dirname, '../public/assets/furniture');
const load = (rel: string, w: number, h: number) =>
  pngToSpriteData(fs.readFileSync(path.join(FURN, rel)), w, h);

describe('boxFaces', () => {
  it('splits the real desk into top and front bands', () => {
    const f = boxFaces(load('DESK/DESK_FRONT.png', 48, 32))!;
    expect(f.bounds).toEqual({ x: 2, y: 11, w: 44, h: 21 });
    expect(f.frontRows).toEqual([22, 32]);
    expect(f.topRows).toEqual([11, 22]);
    expect(f.height).toBeCloseTo(10 / 16);
    expect(f.sideCol).toBe(3); // first opaque column of the last row (a leg)
  });
  it('clamps the front band on short sprites (sofa)', () => {
    const f = boxFaces(load('SOFA/SOFA_FRONT.png', 32, 16))!;
    expect(f.frontRows).toEqual([11, 16]);
    expect(f.topRows).toEqual([0, 11]);
  });
  it('returns null for a blank sprite', () => {
    expect(boxFaces([['']])).toBeNull();
  });
});
