/**
 * Test fixture: builds the furniture catalog from the bundled manifests (dummy
 * 16x16 sprites; seat logic only needs footprints/categories/orientations) and
 * loads the user's real 32x24 layout (10 PC seats facing UP, sofas + lounge
 * chairs, areas Descanso / IDE / Agentes).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildDynamicCatalog } from '../../src/office/layout/furnitureCatalog.js';
import type { OfficeLayout } from '../../src/office/types.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const furnDir = path.resolve(here, '../../public/assets/furniture');

interface ManifestNode {
  type?: string;
  file?: string;
  id: string;
  groupType?: string;
  state?: string;
  orientation?: string;
  footprintW: number;
  footprintH: number;
  width?: number;
  height?: number;
  mirrorSide?: boolean;
  members?: ManifestNode[];
}

let loaded = false;

export function loadCatalog(): void {
  if (loaded) return;
  const catalog: Array<Record<string, unknown>> = [];
  const sprites: Record<string, string[][]> = {};
  for (const dir of fs.readdirSync(furnDir)) {
    const mp = path.join(furnDir, dir, 'manifest.json');
    if (!fs.existsSync(mp)) continue;
    const m = JSON.parse(fs.readFileSync(mp, 'utf-8'));
    const walk = (
      n: ManifestNode,
      ctx: { groupId?: string; state?: string; orientation?: string },
    ) => {
      const next = {
        ...ctx,
        ...(n.groupType ? { groupId: m.id } : {}),
        ...(n.state ? { state: n.state } : {}),
        ...(n.orientation ? { orientation: n.orientation } : {}),
      };
      if (n.type === 'asset' || n.file) {
        catalog.push({
          id: n.id,
          label: n.id,
          footprintW: n.footprintW,
          footprintH: n.footprintH,
          isDesk: m.category === 'desks',
          category: m.category,
          orientation: next.orientation,
          groupId: next.groupId,
          state: next.state,
          backgroundTiles: m.backgroundTiles,
          canPlaceOnWalls: m.canPlaceOnWalls,
          canPlaceOnSurfaces: m.canPlaceOnSurfaces,
          mirrorSide: n.mirrorSide,
        });
        sprites[n.id] = Array.from({ length: n.height ?? 16 }, () =>
          Array<string>(n.width ?? 16).fill(''),
        );
        return;
      }
      for (const c of n.members ?? []) walk(c, next);
    };
    walk(m, {});
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  buildDynamicCatalog({ catalog: catalog as any, sprites });
  loaded = true;
}

/** Fresh copy of the user's 32x24 layout (catalog loaded first). */
export function userLayout(): OfficeLayout {
  loadCatalog();
  return JSON.parse(
    fs.readFileSync(path.join(here, 'smiith-user-layout-32x24.json'), 'utf-8'),
  ) as OfficeLayout;
}
