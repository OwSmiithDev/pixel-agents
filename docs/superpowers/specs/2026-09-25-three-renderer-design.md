# Three.js renderer + Smiith Tech layout — design

Date: 2026-09-25
Status: approved in chat (camera: fixed isometric; 2D kept behind a toggle)

## Goal

Add a second, optional renderer to the webview that draws the existing office
in a lit 3D scene (Three.js via react-three-fiber), reusing the current pixel-art
sprites as textured planes. Ship a new bundled default layout, "Smiith Tech"
(40×30, graphite + cyan), improved from the user's draft.

Out of scope: 3D layout editor, GLTF models, orbit camera. The layout editor
keeps working in 2D; entering edit mode forces the 2D renderer.

## Constraints from the repo

- Game state lives in the imperative `OfficeState`; it is renderer-agnostic.
- Everything drawable already reduces to `FurnitureInstance { sprite, x, y, zY, mirrored? }`
  (walls via `getWallInstances`, furniture via `officeState.furniture`) plus
  characters (`getCharacterSprites` + `getCharacterSprite`) and pets.
- `getCachedSprite(sprite, zoom)` returns an `HTMLCanvasElement` → usable as a
  `THREE.CanvasTexture` with `NearestFilter`.
- ESLint `no-inline-colors`: every color literal lives in `webview-ui/src/constants.ts`.
- Webview CSP: no CDN. All deps are bundled by Vite.

## Architecture

New folder `webview-ui/src/office/three/`:

| Unit              | Responsibility                                                                                                                                 |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `coords.ts`       | Pure mapping: sprite pixels → world units (16 px = 1 unit). Unit-tested.                                                                       |
| `textureCache.ts` | `SpriteData` → `CanvasTexture` (WeakMap keyed by cached canvas).                                                                               |
| `Office3D.tsx`    | `<Canvas>`, camera, lights, post-processing, drives `officeState.update(dt)` in `useFrame`.                                                    |
| `FloorLayer.tsx`  | Re-uses `renderTileGrid` + `renderCarpetLayer` at zoom 1 on an offscreen canvas → one ground plane. Rebuilt only on layout change.             |
| `WallLayer.tsx`   | Wall tiles as instanced boxes (height 1.5 units) with wall color; wall-mounted items render as sprites on the wall face.                       |
| `SpriteLayer.tsx` | Furniture, characters, pets as upright camera-facing planes anchored at their bottom edge (`zY`). Depth from real positions; no manual z-sort. |
| `Effects.tsx`     | Bloom (emissive cyan strips + "on" monitors), vignette, soft shadows. Honors `prefers-reduced-motion` (no pulsing).                            |

`OfficeCanvas` stays untouched except that it skips its own game loop while the
3D view is mounted (single owner of `officeState.update`). `App.tsx` gets a
`2D | 3D` toggle persisted in `localStorage` (try/catch).

Camera: `OrthographicCamera`, pitch ~50°, yaw from a constant
`THREE_CAMERA_YAW_DEG`. 3/4-view sprites are drawn facing the viewer; large
yaw (45°) visually detaches multi-tile furniture from its floor footprint, so
the default yaw is small (validated by screenshot) and the constant documents
the trade-off. Zoom via wheel, pan via middle-drag, follow the selected agent.

Interaction: r3f pointer events on character planes → select / hover, reusing
the existing `officeState.selectedAgentId` / `hoveredAgentId` fields.
Overlays (`ToolOverlay`, bubbles) project world → screen with `vector.project(camera)`
and animate with `motion` (`AnimatePresence`, reduced-motion aware).

## Visual direction

```
COR     graphite-950 #0B0F14  canvas / fog
        graphite-800 #1A2129  walls
        graphite-600 #2B3440  floors (dev/corridor)
        slate-400    #8A96A6  secondary text
        cyan-400     #2EC4D6  accent: light strips, active monitors, selection
        amber-300    #F2B35B  warm point light in lounge/coffee (single warm note)
SIGNATURE  cyan floor light-strips that connect every doorway to the corridor
           spine and bloom in 3D; everything else stays matte graphite.
```

## Layout: Smiith Tech 40×30 (default-layout-2.json)

Diagnosis of the draft: cyan corridor reads as a road and competes with rooms;
dev and support rooms are identical grids with a coffee on every desk; NOC is
not a focal point; lounge bookshelves hang on the outer wall; doors are off-axis.

Changes (same zoning, 18 stations: dev 6, support 6, NOC 4 dual-monitor, demos 2):

- Corridor graphite; cyan becomes a 1-tile spine plus 1-tile thresholds at each door.
- Doors aligned on the corridor axis; one door per room.
- Dev: light graphite; PCs vary; coffee on a third of desks.
- Support: cool slate floor, distinct from dev.
- NOC: darkest floor, dual monitors on, wall boards; the brightest room in 3D.
- Meeting: one long table, 6 chairs, whiteboard + large painting.
- Lounge: warm wood, coffee bar along the wall, sofa set around coffee table,
  hanging plants, bookshelves inside the room.
- Atendimento/demos: 2 desks + small meeting corner.
- Nothing mounted on the outer bottom wall.

Generated by `scripts/layouts/smiith-tech.mjs` (rooms as rectangles) so the
layout stays editable as code; output committed as
`webview-ui/public/assets/default-layout-2.json` (`layoutRevision: 2`).

## Implementation notes (deviations from the design above)

- **Walls stay sprites**, not instanced boxes: wall-mounted items (whiteboards,
  clocks, paintings) are camera-facing planes and would clip into boxes. Depth
  comes from real shadows instead.
- **No `AgentLabels.tsx`**: the existing `ToolOverlay` (activity, team role,
  context gauge, close button) got an optional `anchorToScreen` projector; the
  3D view feeds it a camera projection. Its panel now enters with a `motion`
  spring (skipped under reduced motion).
- **Click logic shared**: `office/engine/officeClick.ts` (`applyOfficeClick`) is
  used by both `OfficeCanvas` and `Office3D`, so seat reassignment and pet
  hearts behave identically.
- **Floor drawn first without depth writes**: sprites whose z-sort key sits
  behind their bottom edge (side chairs, sofas) dip below y=0 when slid along
  the view ray; this keeps them visible.
- **Key light comes from behind-left** so shadows fall toward the viewer; a
  front light hides every shadow behind its own sprite.
- **Monitor light pools**: `MonitorLights.tsx` adds capped accent point lights
  under monitors placed "on" (the NOC), making it the focal room.
- **3D is lazy-loaded** (`React.lazy`): ~270 kB gzip, downloaded only when 3D
  is first opened. 3D is disabled while the layout editor or the intro tour is
  open (both rely on the 2D projection).
- Wall color math: Colorize maps `L' = 0.5 + (L−0.5)(100+c)/100 + b/200`; the
  graphite wall uses `c −56, b −52` to pull the very light wall-top pixels down.

Screenshots: `img/office-2d.png`, `img/office-3d.png`, `img/office-3d-select.png`.

## Testing

- Vitest: `coords.ts` mapping (pixel → world, anchor, sitting offset).
- Vitest: generated layout invariants (40×30, 18 desks w/ chair, no furniture
  overlap, no furniture on wall tiles except wall-mountables, every room reachable).
- `npm run build` (types + lint + bundle) must pass.
- Visual: Playwright screenshot of standalone (`node dist/cli.js`) in 2D and 3D.
