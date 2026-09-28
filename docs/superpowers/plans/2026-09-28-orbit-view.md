# Órbita 3D (diorama + voxel) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third view mode, **Órbita**: a free orbit camera (Miniatura = orthographic, Jogo = perspective) around the office, where walls and furniture become 3D geometry (blocks and voxels) chosen by furniture category.

**Architecture:** A new lazy-loaded `OrbitScene` renders beside the existing `Office3D`. It only reads `officeState` (like `Office3D`). Pure helpers (`orbitMath`, `orbitKind`, `voxelize`, `boxFaces`) hold all rules and are unit-tested. React/three layers (`OrbitRig`, `OrbitWalls`, `OrbitFurniture`, `OrbitActors`) turn them into meshes. The 2D renderer and the current 3D do not change.

**Tech Stack:** React 19, three 0.186, @react-three/fiber 9, @react-three/drei 10 (`CameraControls`, `CameraControlsImpl`), Vitest (node env, `webview-ui/test/*.test.ts`), Playwright (visual check script).

**Spec:** `docs/superpowers/specs/2026-09-28-orbit-view-design.md`

## Global Constraints

- No new dependencies. `CameraControls` and `CameraControlsImpl` come from `@react-three/drei`.
- 2D and 3D (isometric) behave exactly as today. The Órbita is locked while the layout editor or the intro tour is open (same `view3dLockedReason`).
- No change to `officeState` logic, to the server, or to the layout JSON format.
- World units: 1 unit = 1 tile = 16 sprite px (`PX_PER_UNIT` in `three/coords.ts`). World x = sprite x, world z = sprite y, y = up.
- Yaw convention = three `Spherical.theta` = `CameraControls.azimuthAngle`: yaw 0 puts the camera on the +z side (same side as today's isometric view).
- Every `localStorage` access in try/catch (pattern of `webview-ui/src/viewMode.ts`).
- `prefers-reduced-motion`: no camera transitions, no inertia.
- Commit messages: Conventional Commits, no AI attribution or trailers. Never skip hooks.
- Run webview tests with `cd webview-ui && npx vitest run <file>`. Full check: `npm run build` from the repo root.

## File Map

| File                                                                                                                                             | Status        | Responsibility                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- | -------------------------------------------------------------------------------------------------------------------- |
| `webview-ui/src/viewMode.ts`                                                                                                                     | modify        | `ViewMode` gains `'orbit'`; new `OrbitProjection` + read/store; orbit camera read/store.                             |
| `webview-ui/src/constants.ts`                                                                                                                    | modify        | `ORBIT_*` constants.                                                                                                 |
| `webview-ui/src/office/three/orbit/orbitMath.ts`                                                                                                 | create        | `relativeDirection`, `snapYaw`, `shouldCutWall`, `perspDistance`.                                                    |
| `webview-ui/src/office/three/orbit/orbitKind.ts`                                                                                                 | create        | `orbitKind(input)` → `'voxel' \| 'box' \| 'dirCard' \| 'yCard'`; `orientationToDirection`, `directionToOrientation`. |
| `webview-ui/src/office/three/orbit/voxelize.ts`                                                                                                  | create        | `opaqueBounds`, `maskKey`, `voxelize`.                                                                               |
| `webview-ui/src/office/three/orbit/boxFaces.ts`                                                                                                  | create        | `boxFaces(sprite)`.                                                                                                  |
| `webview-ui/src/office/types.ts`                                                                                                                 | modify        | `FurnitureInstance` gains optional `uid`, `type`, `col`, `row`, `color`.                                             |
| `webview-ui/src/office/layout/layoutSerializer.ts`                                                                                               | modify        | `furnitureSprite(type, color)` helper; fill the new instance fields.                                                 |
| `webview-ui/src/office/three/KeyLight.tsx`                                                                                                       | create        | `KeyLight` moved out of `Office3D.tsx` (shared).                                                                     |
| `webview-ui/src/office/three/Office3D.tsx`                                                                                                       | modify        | import `KeyLight` from the new file.                                                                                 |
| `webview-ui/src/office/three/orbit/OrbitRig.tsx`                                                                                                 | create        | camera controls, limits, keys, follow, persistence, projector, `orbitView` ref, click/hover picking.                 |
| `webview-ui/src/office/three/orbit/OrbitActors.tsx`                                                                                              | create        | characters, pets, bubbles as Y-axis cards with camera-relative direction.                                            |
| `webview-ui/src/office/three/orbit/OrbitWalls.tsx`                                                                                               | create        | instanced wall blocks + cutaway.                                                                                     |
| `webview-ui/src/office/three/orbit/OrbitFurniture.tsx`                                                                                           | create        | blocks, voxels, cards reconciled from `officeState.furniture`.                                                       |
| `webview-ui/src/office/three/orbit/OrbitScene.tsx`                                                                                               | create        | canvas, lights, layers.                                                                                              |
| `webview-ui/src/components/ViewToggle.tsx`                                                                                                       | modify        | `2D \| 3D \| Órbita` + `Miniatura \| Jogo` switch.                                                                   |
| `webview-ui/src/App.tsx`                                                                                                                         | modify        | lazy `OrbitScene`, projection state, toggle wiring.                                                                  |
| `webview-ui/test/orbitMath.test.ts`, `orbitKind.test.ts`, `voxelize.test.ts`, `boxFaces.test.ts`, `viewMode.test.ts`, `layoutSerializer.test.ts` | create/modify | unit tests.                                                                                                          |
| `README.md`                                                                                                                                      | modify        | document Órbita.                                                                                                     |

---

### Task 1: View mode, projection and orbit camera persistence + constants

**Files:**

- Modify: `webview-ui/src/viewMode.ts`
- Modify: `webview-ui/src/constants.ts` (append after `VIEW_MODE_STORAGE_KEY`, line ~367)
- Test: `webview-ui/test/viewMode.test.ts` (create)

**Interfaces:**

- Produces:
  - `type ViewMode = '2d' | '3d' | 'orbit'`
  - `type OrbitProjection = 'ortho' | 'persp'`
  - `readStoredViewMode(): ViewMode`, `storeViewMode(mode: ViewMode): void`
  - `readStoredOrbitProjection(): OrbitProjection`, `storeOrbitProjection(p: OrbitProjection): void`
  - `interface OrbitCamera { yaw: number; polar: number }` (radians)
  - `defaultOrbitCamera(): OrbitCamera`, `readStoredOrbitCamera(): OrbitCamera`, `storeOrbitCamera(c: OrbitCamera): void`
  - Constants: `ORBIT_PROJECTION_STORAGE_KEY`, `ORBIT_CAMERA_STORAGE_KEY`, `ORBIT_DEFAULT_YAW_DEG = 35`, `ORBIT_DEFAULT_PITCH_DEG = 52`, `ORBIT_PITCH_MIN_DEG = 20`, `ORBIT_PITCH_MAX_DEG = 78`, `ORBIT_PERSP_FOV_DEG = 38`, `ORBIT_WALL_HEIGHT = 1.5`, `ORBIT_WALL_CUT_HEIGHT = 0.15`, `ORBIT_WALL_CUT_RADIUS = 14`, `ORBIT_WALL_CUT_HALF_ANGLE_DEG = 70`, `ORBIT_WALL_DEFAULT_COLOR = '#3A4452'`, `ORBIT_CLICK_SLOP_PX = 4`, `ORBIT_VOXEL_DEPTH_PX = { electronics: 3, wall: 2, misc: 6 } as const`, `ORBIT_CHAIR_BACK_OFFSET = 0.15`

- [ ] **Step 1: Write the failing test**

```ts
// webview-ui/test/viewMode.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  defaultOrbitCamera,
  readStoredOrbitCamera,
  readStoredOrbitProjection,
  readStoredViewMode,
  storeOrbitCamera,
  storeOrbitProjection,
  storeViewMode,
} from '../src/viewMode.js';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  } as Storage;
});
afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

describe('view mode storage', () => {
  it('round-trips orbit', () => {
    storeViewMode('orbit');
    expect(readStoredViewMode()).toBe('orbit');
  });
  it('falls back to 2d for unknown values', () => {
    store.set('pixel-agents.viewMode', 'vr');
    expect(readStoredViewMode()).toBe('2d');
  });
  it('defaults the projection to ortho and round-trips persp', () => {
    expect(readStoredOrbitProjection()).toBe('ortho');
    storeOrbitProjection('persp');
    expect(readStoredOrbitProjection()).toBe('persp');
  });
  it('returns the default camera when nothing or garbage is stored', () => {
    const def = readStoredOrbitCamera();
    expect(def.yaw).toBeCloseTo((35 * Math.PI) / 180);
    expect(def.polar).toBeCloseTo(((90 - 52) * Math.PI) / 180);
    store.set('pixel-agents.orbitCamera', '{bad json');
    expect(readStoredOrbitCamera()).toEqual(def);
    expect(defaultOrbitCamera()).toEqual(def);
  });
  it('round-trips the camera angles', () => {
    storeOrbitCamera({ yaw: 1.25, polar: 0.8 });
    expect(readStoredOrbitCamera()).toEqual({ yaw: 1.25, polar: 0.8 });
  });
  it('survives a throwing storage', () => {
    (globalThis as { localStorage?: Storage }).localStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    } as unknown as Storage;
    expect(readStoredViewMode()).toBe('2d');
    expect(() => storeOrbitCamera({ yaw: 0, polar: 1 })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd webview-ui && npx vitest run test/viewMode.test.ts`
Expected: FAIL — `readStoredOrbitCamera` is not exported.

- [ ] **Step 3: Implement**

Append to `webview-ui/src/constants.ts` (below `VIEW_MODE_STORAGE_KEY`):

```ts
// ── Órbita (free orbit camera over 3D blocks + voxels) ─────────────────
export const ORBIT_PROJECTION_STORAGE_KEY = 'pixel-agents.orbitProjection';
export const ORBIT_CAMERA_STORAGE_KEY = 'pixel-agents.orbitCamera';
export const ORBIT_DEFAULT_YAW_DEG = 35;
/** Elevation above the floor, like THREE_CAMERA_PITCH_DEG. */
export const ORBIT_DEFAULT_PITCH_DEG = 52;
export const ORBIT_PITCH_MIN_DEG = 20;
export const ORBIT_PITCH_MAX_DEG = 78;
export const ORBIT_PERSP_FOV_DEG = 38;
/** Wall block height in tiles. */
export const ORBIT_WALL_HEIGHT = 1.5;
export const ORBIT_WALL_CUT_HEIGHT = 0.15;
/** Walls farther than this (tiles) from the camera target are never cut. */
export const ORBIT_WALL_CUT_RADIUS = 14;
export const ORBIT_WALL_CUT_HALF_ANGLE_DEG = 70;
export const ORBIT_WALL_DEFAULT_COLOR = '#3A4452';
/** Pointer travel (CSS px) above which a press is a drag, not a click. */
export const ORBIT_CLICK_SLOP_PX = 4;
/** Voxel extrusion depth in sprite px, by role. */
export const ORBIT_VOXEL_DEPTH_PX = { electronics: 3, wall: 2, misc: 6 } as const;
/** How far (tiles) a chair card sits behind its seated character. */
export const ORBIT_CHAIR_BACK_OFFSET = 0.15;
```

Replace `webview-ui/src/viewMode.ts` with:

```ts
import {
  ORBIT_CAMERA_STORAGE_KEY,
  ORBIT_DEFAULT_PITCH_DEG,
  ORBIT_DEFAULT_YAW_DEG,
  ORBIT_PROJECTION_STORAGE_KEY,
  VIEW_MODE_STORAGE_KEY,
} from './constants.js';

export type ViewMode = '2d' | '3d' | 'orbit';
export type OrbitProjection = 'ortho' | 'persp';
/** Radians: yaw = azimuth (0 = camera on +z), polar = angle from straight up. */
export interface OrbitCamera {
  yaw: number;
  polar: number;
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage blocked (private window, webview policy) — the choice just won't persist.
  }
}

export function readStoredViewMode(): ViewMode {
  const v = read(VIEW_MODE_STORAGE_KEY);
  return v === '3d' || v === 'orbit' ? v : '2d';
}

export function storeViewMode(mode: ViewMode): void {
  write(VIEW_MODE_STORAGE_KEY, mode);
}

export function readStoredOrbitProjection(): OrbitProjection {
  return read(ORBIT_PROJECTION_STORAGE_KEY) === 'persp' ? 'persp' : 'ortho';
}

export function storeOrbitProjection(p: OrbitProjection): void {
  write(ORBIT_PROJECTION_STORAGE_KEY, p);
}

export function defaultOrbitCamera(): OrbitCamera {
  return {
    yaw: (ORBIT_DEFAULT_YAW_DEG * Math.PI) / 180,
    polar: ((90 - ORBIT_DEFAULT_PITCH_DEG) * Math.PI) / 180,
  };
}

export function readStoredOrbitCamera(): OrbitCamera {
  const raw = read(ORBIT_CAMERA_STORAGE_KEY);
  if (!raw) return defaultOrbitCamera();
  try {
    const v = JSON.parse(raw) as Partial<OrbitCamera>;
    if (Number.isFinite(v.yaw) && Number.isFinite(v.polar)) {
      return { yaw: v.yaw as number, polar: v.polar as number };
    }
  } catch {
    // fall through to the default
  }
  return defaultOrbitCamera();
}

export function storeOrbitCamera(c: OrbitCamera): void {
  write(ORBIT_CAMERA_STORAGE_KEY, JSON.stringify({ yaw: c.yaw, polar: c.polar }));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd webview-ui && npx vitest run test/viewMode.test.ts`
Expected: PASS (6 tests, one with the extra `defaultOrbitCamera` assertion). Then `npx tsc --noEmit -p .` from `webview-ui` — `App.tsx` still compiles because `'orbit'` is only a new union member (the `mode={show3d ? '3d' : '2d'}` expression stays valid).

- [ ] **Step 5: Commit**

```bash
git add webview-ui/src/viewMode.ts webview-ui/src/constants.ts webview-ui/test/viewMode.test.ts
git commit -m "feat(webview): orbit view mode, projection and camera persistence"
```

---

### Task 2: Orbit math (pure)

**Files:**

- Create: `webview-ui/src/office/three/orbit/orbitMath.ts`
- Test: `webview-ui/test/orbitMath.test.ts`

**Interfaces:**

- Consumes: `Direction` from `webview-ui/src/office/types.ts` (`DOWN 0, LEFT 1, RIGHT 2, UP 3`).
- Produces:
  - `relativeDirection(worldDir: Direction, yaw: number): Direction`
  - `snapYaw(yaw: number, steps?: number): number` (default 4)
  - `shouldCutWall(wall: {x:number; z:number}, target: {x:number; z:number}, yaw: number, radius: number, halfAngleDeg: number): boolean`
  - `perspDistance(viewHeightCssPx: number, zoom: number, dpr: number, fovDeg: number): number`

- [ ] **Step 1: Write the failing test**

```ts
// webview-ui/test/orbitMath.test.ts
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
    expect(snapYaw(-0.7)).toBeCloseTo(-Q);
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd webview-ui && npx vitest run test/orbitMath.test.ts`
Expected: FAIL — cannot resolve `orbitMath.js`.

- [ ] **Step 3: Implement**

```ts
// webview-ui/src/office/three/orbit/orbitMath.ts
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd webview-ui && npx vitest run test/orbitMath.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add webview-ui/src/office/three/orbit/orbitMath.ts webview-ui/test/orbitMath.test.ts
git commit -m "feat(three): pure orbit camera math"
```

---

### Task 3: Furniture kind rules + richer furniture instances

**Files:**

- Create: `webview-ui/src/office/three/orbit/orbitKind.ts`
- Modify: `webview-ui/src/office/types.ts:63-73` (`FurnitureInstance`)
- Modify: `webview-ui/src/office/layout/layoutSerializer.ts:27-100`
- Test: `webview-ui/test/orbitKind.test.ts` (create), `webview-ui/test/layoutSerializer.test.ts` (add a case)

**Interfaces:**

- Produces:
  - `type OrbitKind = 'voxel' | 'box' | 'dirCard' | 'yCard'`
  - `interface OrbitKindInput { type: string; category?: string; footprintW: number; footprintH: number; backgroundTiles?: number; canPlaceOnWalls?: boolean; rotatable: boolean }`
  - `orbitKind(input: OrbitKindInput): OrbitKind`
  - `ORBIT_KIND_OVERRIDES: Record<string, OrbitKind>` (empty)
  - `orientationToDirection(orient: string | undefined): Direction` (`front`→DOWN, `back`→UP, `left`→LEFT, anything else incl. `right`/`side`→RIGHT; `undefined`→DOWN)
  - `directionToOrientation(d: Direction): 'front' | 'back' | 'left' | 'right'`
  - `FurnitureInstance` gains `uid?: string; type?: string; col?: number; row?: number; color?: ColorValue`
  - `furnitureSprite(type: string, color?: ColorValue): SpriteData | null` exported from `layoutSerializer.ts` (catalog sprite, colorized when `color` is set — same cache key as today)

- [ ] **Step 1: Write the failing tests**

```ts
// webview-ui/test/orbitKind.test.ts
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
```

Add to `webview-ui/test/layoutSerializer.test.ts`, reusing that file's existing catalog setup (read the file first; it already builds a catalog for `layoutToFurnitureInstances`). Add inside its `describe`:

```ts
it('tags each instance with uid, type, tile and color for the orbit view', () => {
  const color = { h: 200, s: 40, b: 0, c: 0 };
  const [inst] = layoutToFurnitureInstances([
    { uid: 'u1', type: EXISTING_TYPE, col: 2, row: 3, color },
  ]);
  expect(inst).toMatchObject({ uid: 'u1', type: EXISTING_TYPE, col: 2, row: 3, color });
});
```

where `EXISTING_TYPE` is a furniture type the file's fixture catalog already registers (use the same constant or literal the other tests in that file use).

- [ ] **Step 2: Run to verify they fail**

Run: `cd webview-ui && npx vitest run test/orbitKind.test.ts test/layoutSerializer.test.ts`
Expected: FAIL — `orbitKind.js` missing; instance lacks `uid`.

- [ ] **Step 3: Implement**

```ts
// webview-ui/src/office/three/orbit/orbitKind.ts
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
```

In `webview-ui/src/office/types.ts`, extend `FurnitureInstance`:

```ts
export interface FurnitureInstance {
  sprite: SpriteData;
  /** Pixel x (top-left) */
  x: number;
  /** Pixel y (top-left) */
  y: number;
  /** Y value used for depth sorting (typically bottom edge) */
  zY: number;
  /** Render-time horizontal flip flag (for mirrored side variants) */
  mirrored?: boolean;
  /** Layout identity + catalog type (after auto-state), for renderers that rebuild per item (orbit view). */
  uid?: string;
  type?: string;
  col?: number;
  row?: number;
  color?: ColorValue;
}
```

In `layoutSerializer.ts`, extract the colorize block into an exported helper and use it:

```ts
/** Catalog sprite for a furniture type, colorized like the 2D renderer when `color` is set. */
export function furnitureSprite(type: string, color?: ColorValue): SpriteData | null {
  const entry = getCatalogEntry(type);
  if (!entry) return null;
  if (!color) return entry.sprite;
  const { h, s, b: bv, c: cv } = color;
  return getColorizedSprite(
    `furn-${type}-${h}-${s}-${bv}-${cv}-${color.colorize ? 1 : 0}`,
    entry.sprite,
    color,
  );
}
```

Inside `layoutToFurnitureInstances`, replace the `// Colorize sprite ...` block with `const sprite = furnitureSprite(item.type, item.color) ?? entry.sprite;` and change the push to:

```ts
instances.push({
  sprite,
  x,
  y,
  zY,
  ...(mirrored ? { mirrored: true } : {}),
  uid: item.uid,
  type: item.type,
  col: item.col,
  row: item.row,
  ...(item.color ? { color: item.color } : {}),
});
```

Add the needed imports (`ColorValue`, `SpriteData` types) at the top of `layoutSerializer.ts`.

- [ ] **Step 4: Run to verify they pass**

Run: `cd webview-ui && npx vitest run test/orbitKind.test.ts test/layoutSerializer.test.ts test/smiithLayout.test.ts test/tenAgentsLayout.test.ts`
Expected: PASS (existing layout tests unchanged).

- [ ] **Step 5: Commit**

```bash
git add webview-ui/src/office/three/orbit/orbitKind.ts webview-ui/src/office/types.ts webview-ui/src/office/layout/layoutSerializer.ts webview-ui/test/orbitKind.test.ts webview-ui/test/layoutSerializer.test.ts
git commit -m "feat(three): orbit furniture kind rules and tagged furniture instances"
```

---

### Task 4: Voxelizer and block faces (pure, tested with real sprites)

**Files:**

- Create: `webview-ui/src/office/three/orbit/voxelize.ts`
- Create: `webview-ui/src/office/three/orbit/boxFaces.ts`
- Test: `webview-ui/test/voxelize.test.ts`, `webview-ui/test/boxFaces.test.ts`

**Interfaces:**

- Consumes: `SpriteData = string[][]` (`''` = transparent, `'#RRGGBB'` or `'#RRGGBBAA'`).
- Produces:
  - `interface Bounds { x: number; y: number; w: number; h: number }` (px; `h = 0` when empty)
  - `opaqueBounds(sprite: SpriteData): Bounds`
  - `maskKey(sprite: SpriteData): string`
  - `interface VoxelCell { px: number; py: number; x: number; y: number; z: number; sx: number; sy: number; sz: number; color: string }` — local frame in tiles: x from sprite left edge, y up from the base, z = 0 at the standing front face (standing cells extend to −z, lying cells to +z); `color` = `'#RRGGBB'`; `px/py` = source pixel (for recoloring).
  - `interface VoxelModel { cells: VoxelCell[]; standTopPx: number; standEndPx: number; lyingRows: number }`
  - `voxelize(sprite: SpriteData, opts: { depthPx: number; splitLying: boolean }): VoxelModel`
  - `interface BoxFaces { bounds: Bounds; topRows: [number, number]; frontRows: [number, number]; height: number; sideCol: number }` (`height` in tiles)
  - `boxFaces(sprite: SpriteData): BoxFaces | null`

- [ ] **Step 1: Write the failing tests**

```ts
// webview-ui/test/voxelize.test.ts
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
    const m = voxelize([['#11223380']], { depthPx: 1, splitLying: false });
    expect(m.cells[0].color).toBe('#112233');
  });
});

describe('maskKey', () => {
  it('ignores colors but not shape', () => {
    expect(maskKey([['#000', '']])).toBe(maskKey([['#FFF', '']]));
    expect(maskKey([['#000', '']])).not.toBe(maskKey([['', '#000']]));
  });
});
```

```ts
// webview-ui/test/boxFaces.test.ts
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd webview-ui && npx vitest run test/voxelize.test.ts test/boxFaces.test.ts`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement**

```ts
// webview-ui/src/office/three/orbit/voxelize.ts
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
```

Note on `lyingRows` for the PC: `bottom = 23`, `standEnd = 17`, `lyingStart = 18` → `lyingRows = 5`. Without `splitLying`, `standEnd = bottom = 23` and `lyingRows = 0`.

```ts
// webview-ui/src/office/three/orbit/boxFaces.ts
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
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd webview-ui && npx vitest run test/voxelize.test.ts test/boxFaces.test.ts`
Expected: PASS. If an asset-derived expectation (bounds, rows) is off, print the sprite's alpha map and fix the **expectation only when the code rule is right**; the rules are fixed by the spec.

- [ ] **Step 5: Commit**

```bash
git add webview-ui/src/office/three/orbit/voxelize.ts webview-ui/src/office/three/orbit/boxFaces.ts webview-ui/test/voxelize.test.ts webview-ui/test/boxFaces.test.ts
git commit -m "feat(three): voxelizer and block faces for the orbit view"
```

---

### Task 5: Orbit scene, camera rig and the `2D | 3D | Órbita` switch

This task ships a working Órbita that shows the floor, lights and orbiting camera (actors, walls and furniture arrive in Tasks 6–8).

**Files:**

- Create: `webview-ui/src/office/three/KeyLight.tsx` (move `KeyLight` out of `Office3D.tsx` verbatim, add `export`)
- Modify: `webview-ui/src/office/three/Office3D.tsx` (delete local `KeyLight`, `import { KeyLight } from './KeyLight.js';`)
- Create: `webview-ui/src/office/three/orbit/OrbitRig.tsx`
- Create: `webview-ui/src/office/three/orbit/OrbitScene.tsx`
- Modify: `webview-ui/src/components/ViewToggle.tsx`
- Modify: `webview-ui/src/App.tsx` (lazy import near line 48; state near line 73; render near lines 356–405)

**Interfaces:**

- Consumes: Task 1 storage + constants; Task 2 `snapYaw`, `perspDistance`; `ScreenProjector` type from `Office3D.tsx`; `applyOfficeClick` from `../../engine/officeClick.js`.
- Produces:
  - `interface OrbitViewState { yaw: number; target: THREE.Vector3 }` exported from `OrbitRig.tsx` — written by the rig every frame, read by walls/furniture/actors.
  - `type OrbitPick = { kind: 'agent'; id: number } | { kind: 'pet'; id: string }` exported from `OrbitRig.tsx` (stored on `mesh.userData.pick`).
  - `OrbitRig` props: `{ officeState: OfficeState; zoom: number; projection: OrbitProjection; projectorRef: React.MutableRefObject<ScreenProjector | null>; viewRef: React.MutableRefObject<OrbitViewState>; pickablesRef: React.MutableRefObject<THREE.Object3D[]>; onAgentClick: (id: number) => void; reducedMotion: boolean }`
  - `OrbitScene` props: `{ officeState; zoom: number; projection: OrbitProjection; onAgentClick: (id: number) => void; projectorRef }`
  - `ViewToggle` props gain `projection: OrbitProjection; onProjectionChange: (p: OrbitProjection) => void`.

- [ ] **Step 1: Move `KeyLight`**

Cut `function KeyLight(...)` (Office3D.tsx lines ~115–150) into `webview-ui/src/office/three/KeyLight.tsx` with its imports (`useEffect`, `useRef`, `THREE`, `THREE_KEY_LIGHT_*`, `THREE_SHADOW_MAP_SIZE`, `OfficeState` type) and prefix it with `export`. Import it back in `Office3D.tsx`. Run `cd webview-ui && npx tsc --noEmit -p .` — Expected: no errors.

- [ ] **Step 2: Write `OrbitRig.tsx`**

```tsx
// webview-ui/src/office/three/orbit/OrbitRig.tsx
import { CameraControls, CameraControlsImpl } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

import {
  CAMERA_FOLLOW_LERP,
  MAX_DELTA_TIME_SEC,
  ORBIT_CLICK_SLOP_PX,
  ORBIT_PERSP_FOV_DEG,
  ORBIT_PITCH_MAX_DEG,
  ORBIT_PITCH_MIN_DEG,
  ZOOM_MAX,
  ZOOM_MIN,
} from '../../../constants.js';
import { unlockAudio } from '../../../notificationSound.js';
import {
  defaultOrbitCamera,
  type OrbitProjection,
  readStoredOrbitCamera,
  storeOrbitCamera,
} from '../../../viewMode.js';
import { applyOfficeClick } from '../../engine/officeClick.js';
import type { OfficeState } from '../../engine/officeState.js';
import { TILE_SIZE } from '../../types.js';
import type { ScreenProjector } from '../Office3D.js';
import { perspDistance, snapYaw } from './orbitMath.js';

export interface OrbitViewState {
  yaw: number;
  target: THREE.Vector3;
}
export type OrbitPick = { kind: 'agent'; id: number } | { kind: 'pet'; id: string };

const { ACTION } = CameraControlsImpl;
const DEG = Math.PI / 180;

interface OrbitRigProps {
  officeState: OfficeState;
  zoom: number;
  projection: OrbitProjection;
  projectorRef: React.MutableRefObject<ScreenProjector | null>;
  viewRef: React.MutableRefObject<OrbitViewState>;
  pickablesRef: React.MutableRefObject<THREE.Object3D[]>;
  onAgentClick: (agentId: number) => void;
  reducedMotion: boolean;
}

export function OrbitRig({
  officeState,
  zoom,
  projection,
  projectorRef,
  viewRef,
  pickablesRef,
  onAgentClick,
  reducedMotion,
}: OrbitRigProps) {
  const controls = useRef<CameraControlsImpl>(null);
  const { camera, gl, size, raycaster, pointer } = useThree();
  const dpr = useThree((s) => s.viewport.dpr);
  const ortho = projection === 'ortho';
  const ground = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);

  // Initial framing: layout center, stored angles, bounded target.
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const layout = officeState.getLayout();
    c.setBoundary(
      new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(layout.cols, 0, layout.rows)),
    );
    c.setTarget(layout.cols / 2, 0, layout.rows / 2, false);
    const saved = readStoredOrbitCamera();
    c.rotateTo(saved.yaw, saved.polar, false);
    c.mouseButtons.left = ACTION.ROTATE;
    c.mouseButtons.right = ACTION.TRUCK;
    c.mouseButtons.middle = ACTION.TRUCK;
    c.mouseButtons.wheel = ortho ? ACTION.ZOOM : ACTION.DOLLY;
    c.touches.one = ACTION.TOUCH_ROTATE;
    c.touches.two = ortho ? ACTION.TOUCH_ZOOM_TRUCK : ACTION.TOUCH_DOLLY_TRUCK;
    c.smoothTime = reducedMotion ? 0 : 0.2;
    c.draggingSmoothTime = reducedMotion ? 0 : 0.1;
    // Persist the angle whenever the camera comes to rest.
    const onRest = () => storeOrbitCamera({ yaw: c.azimuthAngle, polar: c.polarAngle });
    const onStart = () => {
      officeState.cameraFollowId = null;
      officeState.cancelGreeterCamera();
    };
    c.addEventListener('rest', onRest);
    c.addEventListener('controlstart', onStart);
    return () => {
      c.removeEventListener('rest', onRest);
      c.removeEventListener('controlstart', onStart);
    };
  }, [officeState, ortho, reducedMotion]);

  // App zoom (ZoomControls +/−) drives the camera scale; limits follow ZOOM_MIN/MAX.
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    if (ortho) {
      c.minZoom = (ZOOM_MIN * TILE_SIZE) / dpr;
      c.maxZoom = (ZOOM_MAX * TILE_SIZE) / dpr;
      void c.zoomTo((zoom * TILE_SIZE) / dpr, !reducedMotion);
    } else {
      c.minDistance = perspDistance(size.height, ZOOM_MAX, dpr, ORBIT_PERSP_FOV_DEG);
      c.maxDistance = perspDistance(size.height, ZOOM_MIN, dpr, ORBIT_PERSP_FOV_DEG);
      void c.dollyTo(perspDistance(size.height, zoom, dpr, ORBIT_PERSP_FOV_DEG), !reducedMotion);
    }
  }, [zoom, ortho, dpr, size.height, reducedMotion]);

  // Screen projector for ToolOverlay / agent panel (lift = sprite px, negative = up).
  useEffect(() => {
    const v = new THREE.Vector3();
    projectorRef.current = (worldX, groundY, liftPx) => {
      v.set(worldX / TILE_SIZE, -liftPx / TILE_SIZE, groundY / TILE_SIZE).project(camera);
      if (v.z < -1 || v.z > 1) return null;
      return { x: ((v.x + 1) / 2) * size.width, y: ((1 - v.y) / 2) * size.height };
    };
    return () => {
      projectorRef.current = null;
    };
  }, [camera, size, projectorRef]);

  // Q / E rotate a quarter turn, R resets.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const c = controls.current;
      if (!c) return;
      const k = e.key.toLowerCase();
      if (k === 'q' || k === 'e') {
        const step = k === 'q' ? -Math.PI / 2 : Math.PI / 2;
        void c.rotateTo(snapYaw(c.azimuthAngle) + step, c.polarAngle, !reducedMotion);
      } else if (k === 'r') {
        const layout = officeState.getLayout();
        const def = defaultOrbitCamera();
        void c.setTarget(layout.cols / 2, 0, layout.rows / 2, !reducedMotion);
        void c.rotateTo(def.yaw, def.polar, !reducedMotion);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [officeState, reducedMotion]);

  // Click (not drag) → same office click as 2D/3D; hover → cursor + hoveredAgentId.
  useEffect(() => {
    const el = gl.domElement;
    const down = { x: 0, y: 0 };
    const setPointer = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      pointer.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
    };
    const pick = (): OrbitPick | null => {
      const hits = raycaster.intersectObjects(pickablesRef.current, false);
      return hits.length > 0 ? (hits[0].object.userData.pick as OrbitPick) : null;
    };
    const onDown = (e: PointerEvent) => {
      unlockAudio();
      down.x = e.clientX;
      down.y = e.clientY;
    };
    const onMove = (e: PointerEvent) => {
      if (e.buttons !== 0) return;
      setPointer(e);
      const hit = pick();
      officeState.hoveredAgentId = hit?.kind === 'agent' ? hit.id : null;
      el.style.cursor = hit ? 'pointer' : 'grab';
    };
    const onClick = (e: MouseEvent) => {
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > ORBIT_CLICK_SLOP_PX) return;
      setPointer(e);
      const hit = pick();
      applyOfficeClick(
        officeState,
        {
          agentId: hit?.kind === 'agent' ? hit.id : null,
          petId: hit?.kind === 'pet' ? hit.id : null,
          getTile: () => {
            const p = raycaster.ray.intersectPlane(ground, new THREE.Vector3());
            return p ? { col: Math.floor(p.x), row: Math.floor(p.z) } : null;
          },
        },
        onAgentClick,
      );
    };
    const onLeave = () => {
      officeState.hoveredAgentId = null;
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('click', onClick);
    el.addEventListener('pointerleave', onLeave);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('click', onClick);
      el.removeEventListener('pointerleave', onLeave);
    };
  }, [gl, camera, raycaster, pointer, officeState, onAgentClick, pickablesRef, ground]);

  // Simulation tick, follow target, shared view state. Runs before the layers (mounted first).
  const tmp = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, delta) => {
    officeState.update(Math.min(delta, MAX_DELTA_TIME_SEC));
    const c = controls.current;
    if (!c) return;
    const followCh =
      officeState.cameraFollowId !== null
        ? officeState.characters.get(officeState.cameraFollowId)
        : undefined;
    const focus = followCh ?? officeState.greeterCameraTarget;
    c.getTarget(tmp);
    if (focus) {
      const tx = tmp.x + (focus.x / TILE_SIZE - tmp.x) * CAMERA_FOLLOW_LERP;
      const tz = tmp.z + (focus.y / TILE_SIZE - tmp.z) * CAMERA_FOLLOW_LERP;
      void c.moveTo(tx, 0, tz, false);
      tmp.set(tx, 0, tz);
    }
    viewRef.current.yaw = c.azimuthAngle;
    viewRef.current.target.copy(tmp);
  });

  return (
    <CameraControls
      ref={controls}
      makeDefault
      minPolarAngle={(90 - ORBIT_PITCH_MAX_DEG) * DEG}
      maxPolarAngle={(90 - ORBIT_PITCH_MIN_DEG) * DEG}
    />
  );
}
```

If `CameraControlsImpl.ACTION` member names differ in the installed `camera-controls` (check `node_modules/camera-controls/dist/types.d.ts`), use the installed names; the behavior table above is the requirement.

- [ ] **Step 3: Write `OrbitScene.tsx`**

```tsx
// webview-ui/src/office/three/orbit/OrbitScene.tsx
import { Canvas } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

import {
  ORBIT_PERSP_FOV_DEG,
  THREE_AMBIENT_COLOR,
  THREE_AMBIENT_INTENSITY,
  THREE_BG_COLOR,
} from '../../../constants.js';
import type { OrbitProjection } from '../../../viewMode.js';
import type { OfficeState } from '../../engine/officeState.js';
import { Effects } from '../Effects.js';
import { FloorLayer } from '../FloorLayer.js';
import { KeyLight } from '../KeyLight.js';
import { MonitorLights } from '../MonitorLights.js';
import type { ScreenProjector } from '../Office3D.js';
import { OrbitRig, type OrbitViewState } from './OrbitRig.js';

interface OrbitSceneProps {
  officeState: OfficeState;
  zoom: number;
  projection: OrbitProjection;
  onAgentClick: (agentId: number) => void;
  projectorRef: React.MutableRefObject<ScreenProjector | null>;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  );
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return;
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

export function OrbitScene({
  officeState,
  zoom,
  projection,
  onAgentClick,
  projectorRef,
}: OrbitSceneProps) {
  const reducedMotion = usePrefersReducedMotion();
  const viewRef = useRef<OrbitViewState>({ yaw: 0, target: new THREE.Vector3() });
  const pickablesRef = useRef<THREE.Object3D[]>([]);
  const ortho = projection === 'ortho';
  return (
    <div
      className="w-full h-full bg-bg"
      data-testid="orbit-view"
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* key: switching projection remounts the canvas with the other camera type. */}
      <Canvas
        key={projection}
        orthographic={ortho}
        flat
        shadows="soft"
        dpr={[1, 2]}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        camera={
          ortho
            ? { near: 0.1, far: 400, zoom: 32, position: [0, 60, 60] }
            : { fov: ORBIT_PERSP_FOV_DEG, near: 0.1, far: 400, position: [0, 30, 30] }
        }
      >
        <color attach="background" args={[THREE_BG_COLOR]} />
        <OrbitRig
          officeState={officeState}
          zoom={zoom}
          projection={projection}
          projectorRef={projectorRef}
          viewRef={viewRef}
          pickablesRef={pickablesRef}
          onAgentClick={onAgentClick}
          reducedMotion={reducedMotion}
        />
        <ambientLight color={THREE_AMBIENT_COLOR} intensity={THREE_AMBIENT_INTENSITY * Math.PI} />
        <KeyLight officeState={officeState} />
        <MonitorLights officeState={officeState} />
        <FloorLayer officeState={officeState} reducedMotion={reducedMotion} />
        <Effects />
      </Canvas>
    </div>
  );
}
```

`usePrefersReducedMotion` duplicates the one in `Office3D.tsx`: move it to `webview-ui/src/office/three/usePrefersReducedMotion.ts` (export) and import it in both files instead of copying.

- [ ] **Step 4: `ViewToggle` — three modes + projection switch**

Replace the body of `ViewToggle.tsx`:

```tsx
import type { OrbitProjection, ViewMode } from '../viewMode.js';
import { Button } from './ui/Button.js';

interface ViewToggleProps {
  mode: ViewMode;
  onChange: (mode: ViewMode) => void;
  projection: OrbitProjection;
  onProjectionChange: (projection: OrbitProjection) => void;
  /** Why 3D/orbit is currently unavailable (editor / intro); disables both. */
  lockedReason: string | null;
}

const MODES: Array<{ value: ViewMode; label: string; title: string }> = [
  { value: '2d', label: '2D', title: '2D view' },
  { value: '3d', label: '3D', title: '3D view' },
  { value: 'orbit', label: 'Órbita', title: 'Orbit view: drag to rotate, Q/E turn, R reset' },
];
const PROJECTIONS: Array<{ value: OrbitProjection; label: string; title: string }> = [
  { value: 'ortho', label: 'Miniatura', title: 'Miniature camera (orthographic)' },
  { value: 'persp', label: 'Jogo', title: 'Game camera (perspective)' },
];

export function ViewToggle({
  mode,
  onChange,
  projection,
  onProjectionChange,
  lockedReason,
}: ViewToggleProps) {
  const btn = (active: boolean) =>
    `border-border! shadow-pixel disabled:cursor-default disabled:opacity-(--btn-disabled-opacity) px-8! w-auto! ${
      active ? 'bg-accent-bright! border-accent! text-white' : ''
    }`;
  return (
    <div className="absolute top-8 right-8 z-10 flex flex-col items-end gap-4">
      <div role="group" aria-label="Office view" className="flex gap-4" data-testid="view-toggle">
        {MODES.map((o) => {
          const disabled = o.value !== '2d' && lockedReason !== null;
          return (
            <Button
              key={o.value}
              size="icon_lg"
              aria-pressed={mode === o.value}
              disabled={disabled}
              title={disabled ? lockedReason! : o.title}
              onClick={() => onChange(o.value)}
              className={btn(mode === o.value)}
            >
              {o.label}
            </Button>
          );
        })}
      </div>
      {mode === 'orbit' && (
        <div
          role="group"
          aria-label="Orbit camera"
          className="flex gap-4"
          data-testid="orbit-projection"
        >
          {PROJECTIONS.map((p) => (
            <Button
              key={p.value}
              size="sm"
              aria-pressed={projection === p.value}
              title={p.title}
              onClick={() => onProjectionChange(p.value)}
              className={btn(projection === p.value)}
            >
              {p.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
```

Check `components/ui/Button.tsx` for the real size names (`icon_lg`, `sm`); if `sm` does not exist use the smallest text size it offers. Keep `data-testid="view-toggle"` on the mode group (e2e and the visual script click `[data-testid="view-toggle"] button:has-text("3D")`).

- [ ] **Step 5: Wire `App.tsx`**

Add next to the `Office3D` lazy import (line ~48):

```tsx
const OrbitScene = lazy(() =>
  import('./office/three/orbit/OrbitScene.js').then((m) => ({ default: m.OrbitScene })),
);
```

Add state next to `viewMode` (line ~73):

```tsx
const [orbitProjection, setOrbitProjection] = useState<OrbitProjection>(readStoredOrbitProjection);
const handleProjectionChange = useCallback((p: OrbitProjection) => {
  setOrbitProjection(p);
  storeOrbitProjection(p);
}, []);
```

(import `OrbitProjection`, `readStoredOrbitProjection`, `storeOrbitProjection` from `./viewMode.js`.)

Replace `const show3d = viewMode === '3d' && view3dLockedReason === null;` with:

```tsx
const effectiveView: ViewMode = view3dLockedReason === null ? viewMode : '2d';
const show3d = effectiveView === '3d';
const showOrbit = effectiveView === 'orbit';
```

Render: turn the `show3d ? <Suspense><Office3D/></Suspense> : <OfficeCanvas/>` into a three-way choice; the orbit branch is

```tsx
<Suspense
  fallback={<div className="w-full h-full flex items-center justify-center">Loading 3D…</div>}
>
  <OrbitScene
    officeState={officeState}
    zoom={editor.zoom}
    projection={orbitProjection}
    onAgentClick={handleClick}
    projectorRef={projector3dRef}
  />
</Suspense>
```

Update the `ViewToggle` usage to `mode={effectiveView}`, `projection={orbitProjection}`, `onProjectionChange={handleProjectionChange}`. Search `App.tsx` for every other `show3d` use (e.g. line ~491 passes `projector3dRef` to the overlay only when 3D): make those conditions `show3d || showOrbit`, because both scenes fill `projector3dRef`. Rename the lock strings to keep them accurate: `'3D and Orbit are unavailable while editing the layout'`, `'3D and Orbit are available after the intro'`.

- [ ] **Step 6: Verify**

Run: `cd webview-ui && npx tsc --noEmit -p . && npx vitest run` then from the root `npm run build`.
Expected: no type errors, all tests pass, build ok. Then `cd webview-ui && npm run dev`, open the printed URL with `?` defaults, click **Órbita**: the floor shows, drag rotates, right-drag pans, wheel zooms, Q/E rotate 90°, **Miniatura/Jogo** switch keeps the angle, reload keeps mode + projection + angle.

- [ ] **Step 7: Commit**

```bash
git add webview-ui/src/office/three/KeyLight.tsx webview-ui/src/office/three/usePrefersReducedMotion.ts webview-ui/src/office/three/Office3D.tsx webview-ui/src/office/three/orbit/OrbitRig.tsx webview-ui/src/office/three/orbit/OrbitScene.tsx webview-ui/src/components/ViewToggle.tsx webview-ui/src/App.tsx
git commit -m "feat(webview): orbit view mode with miniature and game cameras"
```

---

### Task 6: Actors — characters, pets and bubbles as Y cards facing the right way

**Files:**

- Create: `webview-ui/src/office/three/orbit/OrbitActors.tsx`
- Modify: `webview-ui/src/office/three/orbit/OrbitScene.tsx` (mount `<OrbitActors officeState={officeState} viewRef={viewRef} pickablesRef={pickablesRef} />` after `FloorLayer`)

**Interfaces:**

- Consumes: `relativeDirection` (Task 2), `OrbitViewState`, `OrbitPick` (Task 5), `spriteTexture` (`../textureCache.js`), `getCharacterSprite` (`../../engine/characters.js`), `getCharacterSprites`, `BUBBLE_PERMISSION_SPRITE`, `BUBBLE_WAITING_SPRITE` (`../../sprites/spriteData.js`), `getPetSpriteData` (`../../engine/petEntity.js`), `getPetSprites` (`../../sprites/petSpriteData.js`), `isGhostHeadlessAgentsEnabled` (`../../engine/renderer.js`).
- Produces: `OrbitActors({ officeState, viewRef, pickablesRef })`.

- [ ] **Step 1: Implement**

```tsx
// webview-ui/src/office/three/orbit/OrbitActors.tsx
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';

import {
  BUBBLE_FADE_DURATION_SEC,
  BUBBLE_VERTICAL_OFFSET_PX,
  CHARACTER_SITTING_OFFSET_PX,
  HEADLESS_CHARACTER_ALPHA,
  THREE_ALPHA_TEST,
  THREE_AMBIENT_INTENSITY,
  THREE_BUBBLE_RENDER_ORDER,
  THREE_HOVERED_EMISSIVE,
  THREE_SELECTED_EMISSIVE,
} from '../../../constants.js';
import { getCharacterSprite } from '../../engine/characters.js';
import type { OfficeState } from '../../engine/officeState.js';
import { getPetSpriteData } from '../../engine/petEntity.js';
import { isGhostHeadlessAgentsEnabled } from '../../engine/renderer.js';
import { getPetSprites } from '../../sprites/petSpriteData.js';
import {
  BUBBLE_PERMISSION_SPRITE,
  BUBBLE_WAITING_SPRITE,
  getCharacterSprites,
} from '../../sprites/spriteData.js';
import { CharacterState, type SpriteData, TILE_SIZE } from '../../types.js';
import { spriteTexture } from '../textureCache.js';
import { relativeDirection } from './orbitMath.js';
import type { OrbitPick, OrbitViewState } from './OrbitRig.js';

const QUAD = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
/** Same fill as SpriteLayer: art keeps its 2D brightness whatever the light angle. */
const FILL = Math.max(0, 1 - THREE_AMBIENT_INTENSITY);

function createCard(): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshLambertMaterial> {
  const material = new THREE.MeshLambertMaterial({
    alphaTest: THREE_ALPHA_TEST,
    side: THREE.DoubleSide,
    emissive: new THREE.Color(1, 1, 1),
    emissiveIntensity: FILL,
  });
  const mesh = new THREE.Mesh(QUAD, material);
  mesh.customDepthMaterial = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
    alphaTest: THREE_ALPHA_TEST,
  });
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}

interface Props {
  officeState: OfficeState;
  viewRef: React.MutableRefObject<OrbitViewState>;
  pickablesRef: React.MutableRefObject<THREE.Object3D[]>;
}

export function OrbitActors({ officeState, viewRef, pickablesRef }: Props) {
  const group = useMemo(() => new THREE.Group(), []);
  const pool = useMemo<Array<ReturnType<typeof createCard>>>(() => [], []);

  useEffect(
    () => () => {
      for (const m of pool) {
        m.material.dispose();
        (m.customDepthMaterial as THREE.Material).dispose();
      }
    },
    [pool],
  );

  useFrame(() => {
    const yaw = viewRef.current.yaw;
    const picks: THREE.Object3D[] = [];
    let used = 0;
    const place = (
      sprite: SpriteData,
      x: number,
      z: number,
      y: number,
      o: { alpha?: number; emissive?: number; bubble?: boolean; pick?: OrbitPick } = {},
    ) => {
      let mesh = pool[used];
      if (!mesh) {
        mesh = createCard();
        pool.push(mesh);
        group.add(mesh);
      }
      used++;
      const tex = spriteTexture(sprite);
      const mat = mesh.material;
      if (mat.map !== tex) {
        mat.map = tex;
        mat.emissiveMap = tex;
        (mesh.customDepthMaterial as THREE.MeshDepthMaterial).map = tex;
        mat.needsUpdate = true;
      }
      const alpha = o.alpha ?? 1;
      mat.transparent = alpha < 1;
      mat.opacity = alpha;
      mat.emissiveIntensity = FILL + (o.emissive ?? 0);
      mat.depthTest = !o.bubble;
      mesh.renderOrder = o.bubble ? THREE_BUBBLE_RENDER_ORDER : 0;
      mesh.castShadow = !o.bubble;
      mesh.scale.set(sprite[0].length / TILE_SIZE, sprite.length / TILE_SIZE, 1);
      mesh.position.set(x, y, z);
      mesh.rotation.set(0, yaw, 0);
      mesh.visible = true;
      mesh.userData.pick = o.pick;
      if (o.pick) picks.push(mesh);
    };

    const ghosts = isGhostHeadlessAgentsEnabled();
    for (const ch of officeState.getCharacters()) {
      const dir = relativeDirection(ch.dir, yaw);
      const sprite = getCharacterSprite(
        { ...ch, dir },
        getCharacterSprites(ch.palette, ch.hueShift),
      );
      const sitting = ch.state === CharacterState.TYPE || ch.state === CharacterState.REST;
      const lift = sitting ? -CHARACTER_SITTING_OFFSET_PX / TILE_SIZE : 0;
      const emissive =
        ch.id === officeState.selectedAgentId
          ? THREE_SELECTED_EMISSIVE
          : ch.id === officeState.hoveredAgentId
            ? THREE_HOVERED_EMISSIVE
            : 0;
      const x = ch.x / TILE_SIZE;
      const z = ch.y / TILE_SIZE;
      place(sprite, x, z, lift, {
        alpha: ch.isHeadless && ghosts ? HEADLESS_CHARACTER_ALPHA : 1,
        emissive,
        pick: { kind: 'agent', id: ch.id },
      });
      if (!ch.bubbleType || (ch.bubbleType === 'waiting' && ch.waitingAwaitingInput)) continue;
      const bubble =
        ch.bubbleType === 'permission' ? BUBBLE_PERMISSION_SPRITE : BUBBLE_WAITING_SPRITE;
      const bubbleAlpha =
        ch.bubbleType === 'waiting' && ch.bubbleTimer < BUBBLE_FADE_DURATION_SEC
          ? ch.bubbleTimer / BUBBLE_FADE_DURATION_SEC
          : 1;
      place(
        bubble,
        x,
        z,
        lift + BUBBLE_VERTICAL_OFFSET_PX / TILE_SIZE + sprite.length / TILE_SIZE / 2,
        {
          alpha: bubbleAlpha,
          bubble: true,
        },
      );
    }

    for (const pet of officeState.pets) {
      const sprite = getPetSpriteData(pet, getPetSprites(pet.petType));
      if (!sprite) continue;
      place(sprite, pet.x / TILE_SIZE, pet.y / TILE_SIZE, 0, { pick: { kind: 'pet', id: pet.id } });
    }

    for (let i = used; i < pool.length; i++) pool[i].visible = false;
    pickablesRef.current = picks;
  });

  return <primitive object={group} />;
}
```

Check the bubble height against the isometric 3D: in `SpriteLayer` the bubble top sits `BUBBLE_VERTICAL_OFFSET_PX` above the character's anchor (`ch.y`), i.e. above the feet line on screen. In the orbit view "above" is world y, so adjust the lift so the bubble floats just over the head (character sprite height is 32 px = 2 tiles). Tune visually in Step 2 and keep the formula in one place.

- [ ] **Step 2: Verify visually**

Run: `cd webview-ui && npm run dev`, open the browser mock, create agents with the scratch visual script pattern (`window.dispatchEvent(new MessageEvent('message', { data: { type: 'agentCreated', id, folderName } }))`, then `agentToolStart`, `agentToolPermission`), switch to **Órbita**. Expected: agents walk and sit; at yaw 180° (press Q twice) a typing agent shows its face; permission bubble floats over the head; clicking an agent selects it (painel abre); hover highlights.

- [ ] **Step 3: Commit**

```bash
git add webview-ui/src/office/three/orbit/OrbitActors.tsx webview-ui/src/office/three/orbit/OrbitScene.tsx
git commit -m "feat(three): orbit actors with camera-relative sprite direction"
```

---

### Task 7: Walls as blocks with cutaway

**Files:**

- Create: `webview-ui/src/office/three/orbit/OrbitWalls.tsx`
- Modify: `webview-ui/src/office/three/orbit/OrbitScene.tsx` (create `const cutRef = useRef(new Set<string>())`; mount `<OrbitWalls officeState={officeState} viewRef={viewRef} cutRef={cutRef} reducedMotion={reducedMotion} />`)

**Interfaces:**

- Consumes: `shouldCutWall` (Task 2); `ORBIT_WALL_*` constants (Task 1); `wallColorToHex` (`../../wallTiles.js`); `TileType` (`../../types.js`); `officeState.tileMap: TileTypeVal[][]`, `officeState.getLayout().tileColors`, `.cols`.
- Produces: `OrbitWalls({ officeState, viewRef, cutRef, reducedMotion })`; `cutRef.current: Set<string>` holds `"col,row"` of every wall tile currently cut (read by Task 8).

- [ ] **Step 1: Implement**

```tsx
// webview-ui/src/office/three/orbit/OrbitWalls.tsx
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';

import {
  ORBIT_WALL_CUT_HALF_ANGLE_DEG,
  ORBIT_WALL_CUT_HEIGHT,
  ORBIT_WALL_CUT_RADIUS,
  ORBIT_WALL_DEFAULT_COLOR,
  ORBIT_WALL_HEIGHT,
} from '../../../constants.js';
import type { OfficeState } from '../../engine/officeState.js';
import { TileType } from '../../types.js';
import { wallColorToHex } from '../../wallTiles.js';
import { shouldCutWall } from './orbitMath.js';
import type { OrbitViewState } from './OrbitRig.js';

const BOX = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);

interface Props {
  officeState: OfficeState;
  viewRef: React.MutableRefObject<OrbitViewState>;
  cutRef: React.MutableRefObject<Set<string>>;
  reducedMotion: boolean;
}

export function OrbitWalls({ officeState, viewRef, cutRef, reducedMotion }: Props) {
  const [layout, setLayout] = useState(() => officeState.getLayout());
  const walls = useMemo(() => {
    const out: Array<{ col: number; row: number; color: string }> = [];
    officeState.tileMap.forEach((rowTiles, row) =>
      rowTiles.forEach((t, col) => {
        if (t !== TileType.WALL) return;
        const c = layout.tileColors?.[row * layout.cols + col];
        out.push({ col, row, color: c ? wallColorToHex(c) : ORBIT_WALL_DEFAULT_COLOR });
      }),
    );
    return out;
  }, [layout, officeState]);

  const mesh = useMemo(() => {
    const m = new THREE.InstancedMesh(
      BOX,
      new THREE.MeshLambertMaterial(),
      Math.max(1, walls.length),
    );
    m.count = walls.length;
    const color = new THREE.Color();
    walls.forEach((w, i) => m.setColorAt(i, color.set(w.color)));
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }, [walls]);
  const heights = useMemo(() => new Float32Array(walls.length).fill(ORBIT_WALL_HEIGHT), [walls]);

  useEffect(() => () => mesh.material.dispose(), [mesh]);

  const m4 = useMemo(() => new THREE.Matrix4(), []);
  const pos = useMemo(() => new THREE.Vector3(), []);
  const scale = useMemo(() => new THREE.Vector3(), []);
  const quat = useMemo(() => new THREE.Quaternion(), []);
  useFrame((_, delta) => {
    const current = officeState.getLayout();
    if (current !== layout) setLayout(current);
    const { yaw, target } = viewRef.current;
    const cut = cutRef.current;
    cut.clear();
    const k = reducedMotion ? 1 : Math.min(1, delta * 10);
    walls.forEach((w, i) => {
      const isCut = shouldCutWall(
        { x: w.col + 0.5, z: w.row + 0.5 },
        target,
        yaw,
        ORBIT_WALL_CUT_RADIUS,
        ORBIT_WALL_CUT_HALF_ANGLE_DEG,
      );
      if (isCut) cut.add(`${w.col},${w.row}`);
      const goal = isCut ? ORBIT_WALL_CUT_HEIGHT : ORBIT_WALL_HEIGHT;
      heights[i] += (goal - heights[i]) * k;
      mesh.setMatrixAt(
        i,
        m4.compose(pos.set(w.col + 0.5, 0, w.row + 0.5), quat, scale.set(1, heights[i], 1)),
      );
    });
    mesh.instanceMatrix.needsUpdate = true;
  });

  return <primitive object={mesh} />;
}
```

- [ ] **Step 2: Verify visually**

Run the dev server, Órbita on the Smiith Tech layout. Expected: walls are solid blocks in their layout colors, cast shadows; rotating makes the walls on the camera side drop to a low curb and rise again when they are behind; interior partitions near the target on the camera side drop too; walls far away stay up.

- [ ] **Step 3: Commit**

```bash
git add webview-ui/src/office/three/orbit/OrbitWalls.tsx webview-ui/src/office/three/orbit/OrbitScene.tsx
git commit -m "feat(three): orbit wall blocks with camera cutaway"
```

---

### Task 8: Furniture — blocks, voxels and cards

**Files:**

- Create: `webview-ui/src/office/three/orbit/OrbitFurniture.tsx`
- Modify: `webview-ui/src/office/three/orbit/OrbitScene.tsx` (mount `<OrbitFurniture officeState={officeState} viewRef={viewRef} cutRef={cutRef} />` after `OrbitWalls`)

**Interfaces:**

- Consumes: `orbitKind`, `orientationToDirection`, `directionToOrientation` (Task 3); `furnitureSprite` (Task 3); `voxelize`, `maskKey`, `opaqueBounds` (Task 4); `boxFaces` (Task 4); `relativeDirection` (Task 2); `ORBIT_VOXEL_DEPTH_PX`, `ORBIT_CHAIR_BACK_OFFSET` (Task 1); `getCatalogEntry`, `isRotatable`, `getRotatedType`, `getOrientationInGroup` (`../../layout/furnitureCatalog.js`); `spriteTexture`, `configurePixelTexture` (`../textureCache.js`); `getCachedSprite` (`../../sprites/spriteCache.js`); `officeState.furniture: FurnitureInstance[]` with `uid/type/col/row/color` (Task 3); `officeState.tileMap`.
- Produces: `OrbitFurniture({ officeState, viewRef, cutRef })`.

Placement rules (tiles; `S = 1/16`; `b = opaqueBounds(sprite)`; `bottom = b.y + b.h`; instance origin `ox = inst.x / 16`, `oz = inst.y / 16`):

| Kind                                       | Position                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| box                                        | Block size `b.w·S × faces.height × (bottom − b.y)·S`, centered at `x = ox + (b.x + b.w/2)·S`, `z = oz + (b.y + bottom)/2·S`, base `y = 0`. Faces: top = rows `topRows` cropped to `[b.x, b.x+b.w)`; front/back = rows `frontRows` same columns; sides = column `sideCol` over `frontRows`. Registers `deskTop[tile] = faces.height` for every footprint tile when `category === 'desks'`.                                                                                                    |
| voxel, wall item                           | Find the wall row: from `inst.row + footprintH − 1` up to `inst.row`, the lowest row whose tile in column `inst.col` is `TileType.WALL`; call it `w`. Group at `x = ox`, `z = w + 1 + depthPx·S` (back face flush with the wall face), `y = max(0, ((w + 1)·16 − (inst.y + model.standEndPx))·S)`. Hidden while `cutRef` contains `"${inst.col},${w}"`. No wall found → treat as floor voxel.                                                                                                |
| voxel, surface item (`canPlaceOnSurfaces`) | Group at `x = ox`, `z = oz + model.standEndPx·S`, `y = max(deskTop over footprint tiles, 0)`.                                                                                                                                                                                                                                                                                                                                                                                                |
| voxel, floor                               | Group at `x = ox`, `z = oz + model.standEndPx·S`, `y = 0`.                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| yCard                                      | Card (same material recipe as `OrbitActors.createCard`) scaled to sprite size, at `x = ox + W/2·S`, `z = oz + bottom·S − 0.01`, `y = −(H − bottom)·S` (transparent rows below the art sink under the floor). Rotated `y = yaw` every frame.                                                                                                                                                                                                                                                  |
| dirCard                                    | Same card, at the seat: `x = ox + W/2·S`, `z = oz + (footprintH − 0.5)`, then moved `ORBIT_CHAIR_BACK_OFFSET` against the chair's world facing (`facing = orientationToDirection(getOrientationInGroup(type))`: DOWN → −z, UP → +z, LEFT → +x, RIGHT → −x). Every frame: `view = relativeDirection(facing, yaw)`; show the sibling sprite for `directionToOrientation(view)` (fallback: own sprite); mirror (`scale.x < 0`) when that sibling is a `mirrorSide` entry in `left` orientation. |

`mirrored` instances (voxel/box): wrap in a group with `scale.x = −1` and `position.x += W·S`.

Voxel depth: `canPlaceOnWalls` → `ORBIT_VOXEL_DEPTH_PX.wall`; `electronics` → `.electronics` with `splitLying: true`; otherwise `.misc`.

- [ ] **Step 1: Implement**

```tsx
// webview-ui/src/office/three/orbit/OrbitFurniture.tsx
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';

import {
  ORBIT_CHAIR_BACK_OFFSET,
  ORBIT_VOXEL_DEPTH_PX,
  THREE_ALPHA_TEST,
  THREE_AMBIENT_INTENSITY,
} from '../../../constants.js';
import type { OfficeState } from '../../engine/officeState.js';
import {
  getCatalogEntry,
  getOrientationInGroup,
  getRotatedType,
  isRotatable,
} from '../../layout/furnitureCatalog.js';
import { furnitureSprite } from '../../layout/layoutSerializer.js';
import { getCachedSprite } from '../../sprites/spriteCache.js';
import {
  Direction,
  type FurnitureInstance,
  type SpriteData,
  TILE_SIZE,
  TileType,
} from '../../types.js';
import { configurePixelTexture, spriteTexture } from '../textureCache.js';
import { boxFaces } from './boxFaces.js';
import {
  orbitKind,
  type OrbitKind,
  directionToOrientation,
  orientationToDirection,
} from './orbitKind.js';
import { relativeDirection } from './orbitMath.js';
import type { OrbitViewState } from './OrbitRig.js';
import { maskKey, opaqueBounds, voxelize, type VoxelCell } from './voxelize.js';

const S = 1 / TILE_SIZE;
const FILL = Math.max(0, 1 - THREE_AMBIENT_INTENSITY);
const QUAD = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);

interface Built {
  kind: OrbitKind;
  sprite: SpriteData;
  object: THREE.Object3D;
  /** Wall tile key that hides this item when cut. */
  wallKey?: string;
  voxel?: { mesh: THREE.InstancedMesh; cells: VoxelCell[]; mask: string };
  card?: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshLambertMaterial>;
  /** dirCard: world facing + sprite per viewed orientation. */
  dir?: {
    facing: Direction;
    views: Partial<Record<string, { sprite: SpriteData; mirrored: boolean }>>;
  };
  owned: Array<THREE.Material | THREE.Texture | THREE.BufferGeometry>;
}

function cropTexture(
  sprite: SpriteData,
  x: number,
  y: number,
  w: number,
  h: number,
): THREE.CanvasTexture {
  const src = getCachedSprite(sprite, 1);
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  c.getContext('2d')!.drawImage(src, x, y, w, h, 0, 0, w, h);
  return configurePixelTexture(new THREE.CanvasTexture(c));
}

function cardMesh(): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshLambertMaterial> {
  const material = new THREE.MeshLambertMaterial({
    alphaTest: THREE_ALPHA_TEST,
    side: THREE.DoubleSide,
    emissive: new THREE.Color(1, 1, 1),
    emissiveIntensity: FILL,
  });
  const mesh = new THREE.Mesh(QUAD, material);
  mesh.customDepthMaterial = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
    alphaTest: THREE_ALPHA_TEST,
  });
  mesh.castShadow = true;
  return mesh;
}

function setCardSprite(
  card: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshLambertMaterial>,
  sprite: SpriteData,
  mirrored: boolean,
) {
  const tex = spriteTexture(sprite);
  if (card.material.map !== tex) {
    card.material.map = tex;
    card.material.emissiveMap = tex;
    (card.customDepthMaterial as THREE.MeshDepthMaterial).map = tex;
    card.material.needsUpdate = true;
  }
  card.scale.set((mirrored ? -1 : 1) * sprite[0].length * S, sprite.length * S, 1);
}

function voxelMesh(cells: VoxelCell[]): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(UNIT_BOX, new THREE.MeshLambertMaterial(), cells.length);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const color = new THREE.Color();
  cells.forEach((c, i) => {
    mesh.setMatrixAt(i, m4.compose(p.set(c.x, c.y, c.z), q, s.set(c.sx, c.sy, c.sz)));
    mesh.setColorAt(i, color.set(c.color));
  });
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function recolor(v: NonNullable<Built['voxel']>, sprite: SpriteData) {
  const color = new THREE.Color();
  v.cells.forEach((c, i) => v.mesh.setColorAt(i, color.set(sprite[c.py][c.px].slice(0, 7))));
  v.mesh.instanceColor!.needsUpdate = true;
}

/** Sprite shown for each orientation of a rotatable chair, colorized like the placed one. */
function chairViews(inst: FurnitureInstance): Built['dir'] {
  const type = inst.type!;
  const views: NonNullable<Built['dir']>['views'] = {};
  let t: string | null = type;
  for (let i = 0; i < 4 && t; i++) {
    const orient = getOrientationInGroup(t);
    const entry = getCatalogEntry(t);
    const sprite = furnitureSprite(t, inst.color);
    if (orient && entry && sprite && !views[orient]) {
      views[orient] = { sprite, mirrored: Boolean(entry.mirrorSide && orient === 'left') };
    }
    t = getRotatedType(t, 'cw');
    if (t === type) break;
  }
  return { facing: orientationToDirection(getOrientationInGroup(type)), views };
}

interface Props {
  officeState: OfficeState;
  viewRef: React.MutableRefObject<OrbitViewState>;
  cutRef: React.MutableRefObject<Set<string>>;
}

export function OrbitFurniture({ officeState, viewRef, cutRef }: Props) {
  const group = useMemo(() => new THREE.Group(), []);
  const built = useMemo(() => new Map<string, Built>(), []);
  const state = useMemo(() => ({ last: null as FurnitureInstance[] | null }), []);

  const dispose = (b: Built) => {
    group.remove(b.object);
    for (const o of b.owned) o.dispose();
  };
  useEffect(() => () => built.forEach(dispose), [built]); // eslint-disable-line react-hooks/exhaustive-deps

  const build = (
    inst: FurnitureInstance,
    kind: OrbitKind,
    deskTop: Map<string, number>,
  ): Built | null => {
    const entry = getCatalogEntry(inst.type!);
    if (!entry) return null;
    const sprite = inst.sprite;
    const b = opaqueBounds(sprite);
    if (b.h === 0) return null;
    const W = sprite[0].length;
    const H = sprite.length;
    const bottom = b.y + b.h;
    const ox = inst.x * S;
    const oz = inst.y * S;
    const owned: Built['owned'] = [];
    const holder = new THREE.Group();
    const inner = new THREE.Group();
    holder.add(inner);
    if (inst.mirrored && (kind === 'box' || kind === 'voxel')) {
      inner.scale.x = -1;
      inner.position.x = W * S;
    }

    if (kind === 'box') {
      const f = boxFaces(sprite)!;
      const cols: [number, number] = [b.x, b.w];
      const top = cropTexture(sprite, cols[0], f.topRows[0], cols[1], f.topRows[1] - f.topRows[0]);
      const front = cropTexture(
        sprite,
        cols[0],
        f.frontRows[0],
        cols[1],
        f.frontRows[1] - f.frontRows[0],
      );
      const side = cropTexture(
        sprite,
        f.sideCol,
        f.frontRows[0],
        1,
        f.frontRows[1] - f.frontRows[0],
      );
      const mat = (map: THREE.Texture) =>
        new THREE.MeshLambertMaterial({ map, alphaTest: THREE_ALPHA_TEST, side: THREE.DoubleSide });
      const mats = [mat(side), mat(side), mat(top), mat(top), mat(front), mat(front)];
      const depth = (bottom - b.y) * S;
      const geo = new THREE.BoxGeometry(b.w * S, f.height, depth);
      const mesh = new THREE.Mesh(geo, mats);
      mesh.position.set((b.x + b.w / 2) * S, f.height / 2, ((b.y + bottom) / 2) * S);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      inner.add(mesh);
      holder.position.set(ox, 0, oz);
      owned.push(top, front, side, geo, ...mats);
      if (entry.category === 'desks') {
        for (let dr = 0; dr < entry.footprintH; dr++)
          for (let dc = 0; dc < entry.footprintW; dc++)
            deskTop.set(`${inst.col! + dc},${inst.row! + dr}`, f.height);
      }
      return { kind, sprite, object: holder, owned };
    }

    if (kind === 'voxel') {
      const electronics = entry.category === 'electronics';
      const depthPx = entry.canPlaceOnWalls
        ? ORBIT_VOXEL_DEPTH_PX.wall
        : electronics
          ? ORBIT_VOXEL_DEPTH_PX.electronics
          : ORBIT_VOXEL_DEPTH_PX.misc;
      const model = voxelize(sprite, { depthPx, splitLying: electronics });
      const mesh = voxelMesh(model.cells);
      inner.add(mesh);
      owned.push(mesh.material as THREE.Material);
      let wallKey: string | undefined;
      let wallRow = -1;
      if (entry.canPlaceOnWalls) {
        for (let r = inst.row! + entry.footprintH - 1; r >= inst.row!; r--) {
          if (officeState.tileMap[r]?.[inst.col!] === TileType.WALL) {
            wallRow = r;
            break;
          }
        }
      }
      if (wallRow >= 0) {
        wallKey = `${inst.col},${wallRow}`;
        const y = Math.max(0, ((wallRow + 1) * TILE_SIZE - (inst.y + model.standEndPx)) * S);
        holder.position.set(ox, y, wallRow + 1 + depthPx * S);
      } else {
        let y = 0;
        if (entry.canPlaceOnSurfaces) {
          for (let dr = 0; dr < entry.footprintH; dr++)
            for (let dc = 0; dc < entry.footprintW; dc++)
              y = Math.max(y, deskTop.get(`${inst.col! + dc},${inst.row! + dr}`) ?? 0);
        }
        holder.position.set(ox, y, oz + model.standEndPx * S);
      }
      return {
        kind,
        sprite,
        object: holder,
        wallKey,
        voxel: { mesh, cells: model.cells, mask: maskKey(sprite) },
        owned,
      };
    }

    // Cards
    const card = cardMesh();
    owned.push(card.material, card.customDepthMaterial as THREE.Material);
    inner.add(card);
    if (kind === 'dirCard') {
      const dir = chairViews(inst);
      let x = ox + (W / 2) * S;
      let z = oz + entry.footprintH - 0.5;
      const off = ORBIT_CHAIR_BACK_OFFSET;
      if (dir!.facing === Direction.DOWN) z -= off;
      else if (dir!.facing === Direction.UP) z += off;
      else if (dir!.facing === Direction.LEFT) x += off;
      else x -= off;
      card.position.set(x, -(H - bottom) * S, z);
      setCardSprite(card, sprite, Boolean(inst.mirrored));
      return { kind, sprite, object: holder, card, dir, owned };
    }
    card.position.set(ox + (W / 2) * S, -(H - bottom) * S, oz + bottom * S - 0.01);
    setCardSprite(card, sprite, Boolean(inst.mirrored));
    return { kind, sprite, object: holder, card, owned };
  };

  const reconcile = (list: FurnitureInstance[]) => {
    const deskTop = new Map<string, number>();
    const seen = new Set<string>();
    // Blocks first so surface items know the desk heights.
    const ordered = [...list].sort((a, b) => {
      const ka = a.type ? orbitKindOf(a) === 'box' : false;
      const kb = b.type ? orbitKindOf(b) === 'box' : false;
      return Number(kb) - Number(ka);
    });
    for (const inst of ordered) {
      if (!inst.uid || !inst.type) continue;
      const kind = orbitKindOf(inst);
      if (!kind) continue;
      seen.add(inst.uid);
      const prev = built.get(inst.uid);
      if (prev && prev.kind === kind && prev.sprite === inst.sprite && kind !== 'box') continue;
      if (
        prev &&
        prev.kind === 'voxel' &&
        kind === 'voxel' &&
        prev.voxel!.mask === maskKey(inst.sprite)
      ) {
        recolor(prev.voxel!, inst.sprite);
        prev.sprite = inst.sprite;
        continue;
      }
      if (prev && prev.kind === 'box' && prev.sprite === inst.sprite) {
        // Rebuild boxes only when the sprite changes, but keep deskTop up to date.
        const entry = getCatalogEntry(inst.type)!;
        const f = boxFaces(inst.sprite);
        if (entry.category === 'desks' && f) {
          for (let dr = 0; dr < entry.footprintH; dr++)
            for (let dc = 0; dc < entry.footprintW; dc++)
              deskTop.set(`${inst.col! + dc},${inst.row! + dr}`, f.height);
        }
        continue;
      }
      if (prev) dispose(prev);
      const next = build(inst, kind, deskTop);
      if (!next) {
        built.delete(inst.uid);
        continue;
      }
      built.set(inst.uid, next);
      group.add(next.object);
    }
    for (const [uid, b] of built) {
      if (!seen.has(uid)) {
        dispose(b);
        built.delete(uid);
      }
    }
  };

  useFrame(() => {
    if (officeState.furniture !== state.last) {
      state.last = officeState.furniture;
      reconcile(officeState.furniture);
    }
    const yaw = viewRef.current.yaw;
    const cut = cutRef.current;
    for (const b of built.values()) {
      if (b.wallKey) b.object.visible = !cut.has(b.wallKey);
      if (!b.card) continue;
      b.card.rotation.set(0, yaw, 0);
      if (b.dir) {
        const view = b.dir.views[directionToOrientation(relativeDirection(b.dir.facing, yaw))];
        if (view) setCardSprite(b.card, view.sprite, view.mirrored);
      }
    }
  });

  return <primitive object={group} />;
}

function orbitKindOf(inst: FurnitureInstance): OrbitKind | null {
  const entry = getCatalogEntry(inst.type!);
  if (!entry) return null;
  return orbitKind({
    type: inst.type!,
    category: entry.category,
    footprintW: entry.footprintW,
    footprintH: entry.footprintH,
    backgroundTiles: entry.backgroundTiles,
    canPlaceOnWalls: entry.canPlaceOnWalls,
    rotatable: isRotatable(inst.type!),
  });
}
```

Known simplification to keep: box desks rebuild only when their sprite changes; surface items placed before a desk exists in the same frame read the height map built in that same reconcile because blocks are sorted first.

- [ ] **Step 2: Verify visually**

Dev server, Órbita, Smiith Tech layout (`webview-ui/public/assets/default-layout-2.json`) and `layouts/smiith-10-agentes.json` (Settings → Import Layout). Expected at 4 yaws and in both cameras:

- desks and tables are blocks with the art on top and front, legs cut out;
- PCs are voxels standing on the desk with the keyboard lying in front; screens blink when an agent works (colors change, no flicker of geometry);
- bookshelves/boards/clock are voxels flush on the walls and disappear when their wall is cut;
- chairs switch front/back/side as you rotate; sofas are blocks;
- plants stand upright and turn to the camera;
- colors set in the editor show in the orbit view.

- [ ] **Step 3: Commit**

```bash
git add webview-ui/src/office/three/orbit/OrbitFurniture.tsx webview-ui/src/office/three/orbit/OrbitScene.tsx
git commit -m "feat(three): orbit furniture as blocks, voxels and direction cards"
```

---

### Task 9: Full verification, visual check, README

**Files:**

- Modify: `README.md` (section "O que este fork adiciona" + new "Órbita" section + file table rows)
- Create (scratch, not committed): Playwright visual script in the session scratchpad

- [ ] **Step 1: Automated checks**

Run from the repo root: `npm run build` and `cd webview-ui && npx vitest run`.
Expected: build ok, all webview tests pass (count = previous count + new files).

- [ ] **Step 2: Visual check script**

Write a scratch Playwright script (pattern of the earlier `visual.mjs`: `chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })`, `localStorage.setItem('pixel-agents.viewMode', 'orbit')`, dispatch `agentCreated` ×12, `agentToolStart` for 6, `agentToolPermission` for 1). Screenshot `orbit-ortho-{0,90,180,270}.png` (press `e` between shots) and the same with `pixel-agents.orbitProjection = 'persp'`. Log page errors. Expected: no page errors; every screenshot shows walls cut on the camera side, voxels, blocks, agents with bubbles and labels.

- [ ] **Step 3: Performance spot check**

In the same script, measure frames over 3 s with `requestAnimationFrame` counting in the page (`page.evaluate`) on the Smiith Tech layout with 20 agents. Report the number; SwiftShader is software-rendered, so the target (60 fps) is checked on the user's real GPU, not here — only flag if the count is below 10 fps in SwiftShader.

- [ ] **Step 4: README**

Add to the "O que este fork adiciona" table:

```markdown
| **Órbita** | Terceiro modo do seletor (`2D \| 3D \| Órbita`). Câmera livre em volta do escritório, como num jogo: arraste para girar, botão direito para mover, roda para zoom, Q/E giram 90°, R volta. Paredes viram blocos que abaixam quando ficam na frente; mesas e sofás viram blocos; PCs, estantes, quadros, lixeira e café viram voxel (um cubo por pixel da arte). Chave **Miniatura** (ortográfica) / **Jogo** (perspectiva). Funciona com qualquer layout, sem conversão. |
```

and to "Onde está cada coisa":

```markdown
| `webview-ui/src/office/three/orbit/` | Modo Órbita: câmera, paredes, móveis (bloco/voxel/recorte), personagens |
| `webview-ui/src/office/three/orbit/orbitKind.ts` | Regra de qual móvel vira bloco, voxel ou recorte (por categoria) |
```

Run `npx prettier --write README.md`.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: document the orbit view"
```
