import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { pngToSpriteData } from '../../core/src/assets/pngDecoder.ts';
import { maskKey, opaqueBounds, voxelize } from '../src/office/three/orbit/voxelize.js';

const FURN = path.join(__dirname, '../public/assets/furniture');
const load = (rel: string, w: number, h: number) =>
  pngToSpriteData(fs.readFileSync(path.join(FURN, rel)), w, h);

describe('opaqueBounds', () => {
  it('finds the opaque rectangle of the real PC sprite', () => {
    expect(opaqueBounds(load('PC/PC_FRONT_ON_1.png', 16, 32))).toEqual({
      x: 0,
      y: 0,
      w: 16,
      h: 23,
    });
  });
  it('returns an empty rectangle for a blank sprite', () => {
    expect(
      opaqueBounds([
        ['', ''],
        ['', ''],
      ]).h,
    ).toBe(0);
  });
});

describe('voxelize', () => {
  const pc = load('PC/PC_FRONT_ON_1.png', 16, 32);
  const model = voxelize(pc, { depthPx: 3, splitLying: true });

  it('splits the monitor (standing) from the keyboard (lying) at the empty row', () => {
    expect(model.standTopPx).toBe(0);
    expect(model.standEndPx).toBe(17);
    expect(model.lyingRows).toBe(5);
    const lying = model.cells.filter((c) => c.sz > 0 && c.z > 0);
    expect(lying.every((c) => c.py >= 18 && c.py <= 22)).toBe(true);
  });
  it('makes one cell per opaque pixel', () => {
    const opaque = pc.flat().filter((c) => c !== '').length;
    expect(model.cells).toHaveLength(opaque);
  });
  it('recesses bright pixels by one pixel and keeps the back face shared', () => {
    const standing = model.cells.filter((c) => c.z <= 0);
    const full = standing.filter((c) => Math.abs(c.sz - 3 / 16) < 1e-9);
    const recessed = standing.filter((c) => Math.abs(c.sz - 2 / 16) < 1e-9);
    expect(full.length).toBeGreaterThan(0);
    expect(recessed.length).toBeGreaterThan(0);
    for (const c of standing) expect(c.z - c.sz / 2).toBeCloseTo(-3 / 16);
  });
  it('puts the lowest standing row on the base', () => {
    const bottom = model.cells.filter((c) => c.py === 16);
    for (const c of bottom) expect(c.y).toBeCloseTo(0.5 / 16);
  });
  it('keeps everything standing without splitLying', () => {
    const m = voxelize(pc, { depthPx: 3, splitLying: false });
    expect(m.lyingRows).toBe(0);
    expect(m.standEndPx).toBe(23);
  });
  it('strips alpha from colors', () => {
    // Hex placeholders are test fixtures, not UI tokens — disable the
    // centralized-color rule just for this pixel-color literal.
    /* eslint-disable pixel-agents/no-inline-colors */
    const m = voxelize([['#11223380']], { depthPx: 1, splitLying: false });
    expect(m.cells[0].color).toBe('#112233');
    /* eslint-enable pixel-agents/no-inline-colors */
  });
});

describe('maskKey', () => {
  it('ignores colors but not shape', () => {
    // Hex placeholders are test fixtures, not UI tokens — disable the
    // centralized-color rule just for these mask literals.
    /* eslint-disable pixel-agents/no-inline-colors */
    expect(maskKey([['#000', '']])).toBe(maskKey([['#FFF', '']]));
    expect(maskKey([['#000', '']])).not.toBe(maskKey([['', '#000']]));
    /* eslint-enable pixel-agents/no-inline-colors */
  });
});
