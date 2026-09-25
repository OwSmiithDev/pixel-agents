import { describe, expect, it } from 'vitest';

import { cameraBasis, placeSprite, PX_PER_UNIT } from '../src/office/three/coords.js';

const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe('three coords', () => {
  it('uses 16 sprite pixels per world unit', () => {
    expect(PX_PER_UNIT).toBe(16);
  });

  it('builds an orthonormal camera basis for pitch/yaw', () => {
    const { forward, up } = cameraBasis(50, 0);
    close(forward.x, 0);
    close(forward.y, -Math.sin((50 * Math.PI) / 180));
    close(forward.z, -Math.cos((50 * Math.PI) / 180));
    close(forward.x * up.x + forward.y * up.y + forward.z * up.z, 0);
    close(Math.hypot(up.x, up.y, up.z), 1);
  });

  it('keeps the sprite bottom on screen where the 2D art puts it', () => {
    const basis = cameraBasis(50, 0);
    // 48×32 desk drawn at (16, 32) px, sorted by its bottom edge (zY = 64)
    const p = placeSprite({ leftPx: 16, topPx: 32, widthPx: 48, heightPx: 32, zY: 64 }, basis);
    expect(p.width).toBe(3);
    expect(p.height).toBe(2);
    close(p.position.x, 2.5);
    close(p.position.y, 0);
    close(p.position.z, 4);
  });

  it('moves a sprite toward the camera by its z-sort bias without moving it on screen', () => {
    const basis = cameraBasis(50, 0);
    const base = placeSprite({ leftPx: 0, topPx: 0, widthPx: 16, heightPx: 32, zY: 32 }, basis);
    const biased = placeSprite({ leftPx: 0, topPx: 0, widthPx: 16, heightPx: 32, zY: 40 }, basis);
    const dx = biased.position.x - base.position.x;
    const dy = biased.position.y - base.position.y;
    const dz = biased.position.z - base.position.z;
    // pure displacement along the view direction → same screen point
    const along = dx * basis.forward.x + dy * basis.forward.y + dz * basis.forward.z;
    close(Math.hypot(dx, dy, dz), Math.abs(along));
    // and closer to the camera (negative along forward)
    expect(along).toBeLessThan(0);
  });
});
