# Three.js Renderer + Smiith Tech Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Optional lit 3D view of the office (sprites on planes) behind a 2D/3D toggle, plus a new bundled 40×30 "Smiith Tech" default layout.

**Architecture:** `OfficeState` stays the single source of truth. A new `office/three/` module reads it every frame inside a react-three-fiber `<Canvas>`; floor = baked canvas texture, walls = instanced boxes, furniture/characters/pets = upright sprite planes. `App.tsx` mounts `Office3D` instead of `OfficeCanvas` when 3D is on and the editor is closed, so only one renderer drives `officeState.update`.

**Tech Stack:** React 19, three, @react-three/fiber 9, @react-three/drei 10, @react-three/postprocessing 3, motion 12, Vitest 4 (node env).

**Spec:** `docs/superpowers/specs/2026-09-25-three-renderer-design.md`

## Global Constraints

- Color literals only in `webview-ui/src/constants.ts` (ESLint `no-inline-colors`).
- Webview tests live in `webview-ui/test/*.test.ts`, node environment.
- No CDN assets; everything bundled by Vite.
- Honor `prefers-reduced-motion` (no pulsing lights, no animated overlay entrances).
- 16 sprite px = 1 world unit (`TILE_SIZE` = 16).
- Layout JSON schema: `{ version: 1, cols, rows, layoutRevision, tiles, tileColors, furniture[] }`; tile 0 = WALL, 1–9 = floor pattern, 255 = VOID.
- 18 stations: dev 6, support 6, NOC 4 (dual monitor), demos 2.
- No commits until the user has a fork; work stays local.

---

### Task 1: Smiith Tech layout generator

**Files:**

- Create: `scripts/layouts/smiith-tech.mjs` (pure `buildLayout()` + CLI writer)
- Create: `webview-ui/public/assets/default-layout-2.json` (generated)
- Test: `webview-ui/test/smiithLayout.test.ts`

**Interfaces:**

- Produces: `buildLayout(): Layout` (ESM export) and `default-layout-2.json` with `layoutRevision: 2`.

- [ ] Write test asserting: 40×30; tiles/tileColors length 1200; 18 `DESK_FRONT`s each with a `CUSHIONED_CHAIR_*` within 2 rows below; no two footprints overlap (footprints from manifests); non-wall-mountable furniture never on WALL tiles; BFS from corridor reaches every floor tile.
- [ ] Run `npx vitest run test/smiithLayout.test.ts` → FAIL (module missing).
- [ ] Implement generator: rooms as rectangles, doors as 2-tile gaps on the corridor axis, cyan spine row + door thresholds, furniture per room.
- [ ] Run test → PASS. Run `node scripts/layouts/smiith-tech.mjs` → writes JSON.

### Task 2: Dependencies + world coordinates

**Files:**

- Modify: `webview-ui/package.json` (deps)
- Create: `webview-ui/src/office/three/coords.ts`
- Test: `webview-ui/test/threeCoords.test.ts`

**Interfaces:**

- Produces:
  - `PX_PER_UNIT = 16`
  - `pxToWorld(x: number, y: number): { x: number; z: number }`
  - `spritePlane(widthPx: number, heightPx: number, anchorXPx: number, bottomYPx: number): { x: number; z: number; w: number; h: number }` — center x, ground z, plane size.
  - `characterAnchor(ch: { x: number; y: number }, sitting: boolean): { x: number; z: number }`

- [ ] Test: `pxToWorld(32, 48)` → `{x: 2, z: 3}`; `spritePlane(48, 32, 16, 64)` → `{x: 2.5, z: 4, w: 3, h: 2}`; sitting adds `CHARACTER_SITTING_OFFSET_PX / 16` to z.
- [ ] FAIL → implement → PASS.
- [ ] `npm install three @react-three/fiber @react-three/drei @react-three/postprocessing motion` + `@types/three` (dev) in `webview-ui`.

### Task 3: 3D scene

**Files:**

- Create: `webview-ui/src/office/three/textureCache.ts` — `spriteTexture(sprite: SpriteData): THREE.CanvasTexture` (NearestFilter, SRGB, WeakMap on sprite).
- Create: `webview-ui/src/office/three/FloorLayer.tsx` — bakes `renderTileGrid` + `renderCarpetLayer` at zoom 1 onto an offscreen canvas; one plane receiving shadows; emissive map from cyan tiles.
- Create: `webview-ui/src/office/three/WallLayer.tsx` — `InstancedMesh` of boxes for WALL tiles, color from `tileColors`.
- Create: `webview-ui/src/office/three/SpriteLayer.tsx` — per frame, sync a pool of planes with furniture + characters + pets; tilt planes to camera pitch; cast shadows (alphaTest 0.5).
- Create: `webview-ui/src/office/three/Office3D.tsx` — Canvas, ortho camera (`THREE_CAMERA_PITCH_DEG`, `THREE_CAMERA_YAW_DEG`), lights, `useFrame(dt → officeState.update(dt))`, wheel zoom, middle-drag pan, follow `cameraFollowId`, click/hover picking → `onClick(agentId)`.
- Create: `webview-ui/src/office/three/Effects.tsx` — Bloom + Vignette via @react-three/postprocessing.
- Create: `webview-ui/src/office/three/AgentLabels.tsx` — drei `<Html>` label per agent with `motion` fade/slide; reduced-motion aware.
- Modify: `webview-ui/src/constants.ts` — `THREE_*` colors and camera constants.

- [ ] Implement; `npx tsc -b` clean.

### Task 4: Toggle in App

**Files:**

- Modify: `webview-ui/src/App.tsx` (render `Office3D` when `view3d && !editor.isEditMode`; hide 2D-only `ToolOverlay` in 3D)
- Create: `webview-ui/src/components/ViewToggle.tsx` (2D | 3D pixel button, `localStorage` in try/catch)

- [ ] Implement; editor open forces 2D.

### Task 5: Verify

- [ ] `npm run build` at repo root (types + lint + bundle) → exit 0.
- [ ] `cd webview-ui && npx vitest run test/smiithLayout.test.ts test/threeCoords.test.ts` → PASS.
- [ ] Playwright screenshots of `vite` dev (browser mock) in 2D and 3D; inspect; tune yaw/pitch/lights.
- [ ] `python <ui-skill>/scripts/audit_ui.py webview-ui/src/office/three webview-ui/src/components/ViewToggle.tsx`.
