/**
 * Pure 2D-sprite → 3D-world mapping for the Three.js renderer.
 *
 * World axes: x = sprite x, z = sprite y (toward the viewer), y = up.
 * Sprites become camera-facing planes. Each plane is slid along the view
 * direction until its depth matches its 2D z-sort key (`zY`), so occlusion is
 * identical to the Canvas renderer while the screen position stays put.
 */

export const PX_PER_UNIT = 16;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface CameraBasis {
  /** Unit view direction (camera → scene). */
  forward: Vec3;
  /** Unit screen-up direction in world space. */
  up: Vec3;
}

export function cameraBasis(pitchDeg: number, yawDeg: number): CameraBasis {
  const p = (pitchDeg * Math.PI) / 180;
  const y = (yawDeg * Math.PI) / 180;
  return {
    forward: { x: -Math.sin(y) * Math.cos(p), y: -Math.sin(p), z: -Math.cos(y) * Math.cos(p) },
    up: { x: -Math.sin(y) * Math.sin(p), y: Math.cos(p), z: -Math.cos(y) * Math.sin(p) },
  };
}

export interface SpriteRect {
  leftPx: number;
  topPx: number;
  widthPx: number;
  heightPx: number;
  /** 2D z-sort key in sprite pixels (usually the bottom edge). */
  zY: number;
}

export interface SpritePlacement {
  /** Bottom-center of the plane. */
  position: Vec3;
  width: number;
  height: number;
}

export function placeSprite(rect: SpriteRect, basis: CameraBasis): SpritePlacement {
  const bottomPx = rect.topPx + rect.heightPx;
  const bx = (rect.leftPx + rect.widthPx / 2) / PX_PER_UNIT;
  const bz = bottomPx / PX_PER_UNIT;
  const shift = ((rect.zY - bottomPx) / PX_PER_UNIT) * basis.forward.z;
  return {
    position: {
      x: bx + basis.forward.x * shift,
      y: basis.forward.y * shift,
      z: bz + basis.forward.z * shift,
    },
    width: rect.widthPx / PX_PER_UNIT,
    height: rect.heightPx / PX_PER_UNIT,
  };
}
