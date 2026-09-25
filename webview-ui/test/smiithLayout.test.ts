import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const assetsDir = path.resolve(rootDir, '../public/assets');
const WALL = 0;
const VOID = 255;

interface Placed {
  uid: string;
  type: string;
  col: number;
  row: number;
}
interface Layout {
  version: number;
  cols: number;
  rows: number;
  layoutRevision: number;
  tiles: number[];
  tileColors: unknown[];
  furniture: Placed[];
}
interface AssetInfo {
  w: number;
  h: number;
  bg: number;
  wall: boolean;
  surface: boolean;
}

function loadAssetInfo(): Map<string, AssetInfo> {
  const info = new Map<string, AssetInfo>();
  const furnitureDir = path.join(assetsDir, 'furniture');
  for (const dir of fs.readdirSync(furnitureDir)) {
    const manifestPath = path.join(furnitureDir, dir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>;
    const walk = (node: Record<string, unknown>): void => {
      if (node.type === 'asset' || node.file) {
        info.set(String(node.id), {
          w: Number(node.footprintW),
          h: Number(node.footprintH),
          bg: Number(manifest.backgroundTiles ?? 0),
          wall: Boolean(manifest.canPlaceOnWalls),
          surface: Boolean(manifest.canPlaceOnSurfaces),
        });
        return;
      }
      for (const m of (node.members as Record<string, unknown>[] | undefined) ?? []) walk(m);
    };
    walk(manifest);
  }
  return info;
}

const layout = JSON.parse(
  fs.readFileSync(path.join(assetsDir, 'default-layout-2.json'), 'utf-8'),
) as Layout;
const assets = loadAssetInfo();
const infoOf = (p: Placed): AssetInfo => {
  const a = assets.get(p.type.split(':')[0]);
  if (!a) throw new Error(`unknown furniture type ${p.type}`);
  return a;
};
const tileAt = (c: number, r: number): number => layout.tiles[r * layout.cols + c];
const isDesk = (p: Placed) => p.type === 'DESK_FRONT';
const isChair = (p: Placed) => p.type.startsWith('CUSHIONED_CHAIR');

describe('Smiith Tech default layout', () => {
  it('is 40x30 with revision 2 and full tile arrays', () => {
    expect(layout.cols).toBe(40);
    expect(layout.rows).toBe(30);
    expect(layout.layoutRevision).toBe(2);
    expect(layout.tiles).toHaveLength(1200);
    expect(layout.tileColors).toHaveLength(1200);
  });

  it('has exactly 18 workstations (desk with a PC and a chair right below)', () => {
    const stations = layout.furniture.filter(isDesk).filter((d) => {
      const hasPc = layout.furniture.some(
        (p) => p.type.startsWith('PC_') && p.row === d.row && p.col >= d.col && p.col < d.col + 3,
      );
      const hasChair = layout.furniture.some(
        (c) => isChair(c) && c.row === d.row + 2 && c.col >= d.col && c.col < d.col + 3,
      );
      return hasPc && hasChair;
    });
    expect(stations).toHaveLength(18);
  });

  it('gives every NOC station two monitors', () => {
    const noc = layout.furniture.filter((f) => /^noc-desk-\d+$/.test(f.uid));
    expect(noc).toHaveLength(4);
    for (const d of noc) {
      const pcs = layout.furniture.filter(
        (p) => p.type.startsWith('PC_') && p.row === d.row && p.col >= d.col && p.col < d.col + 3,
      );
      expect(pcs).toHaveLength(2);
    }
  });

  it('never overlaps two floor-standing footprints', () => {
    const taken = new Map<string, string>();
    for (const f of layout.furniture) {
      const a = infoOf(f);
      if (a.surface || a.wall) continue;
      for (let r = f.row + a.bg; r < f.row + a.h; r++) {
        for (let c = f.col; c < f.col + a.w; c++) {
          const key = `${c},${r}`;
          expect(taken.get(key), `${f.uid} overlaps ${taken.get(key)} at ${key}`).toBeUndefined();
          taken.set(key, f.uid);
        }
      }
    }
  });

  it('keeps floor-standing furniture off walls and inside the grid', () => {
    for (const f of layout.furniture) {
      const a = infoOf(f);
      if (a.wall) continue;
      for (let r = f.row + a.bg; r < f.row + a.h; r++) {
        for (let c = f.col; c < f.col + a.w; c++) {
          expect(c >= 0 && c < layout.cols && r >= 0 && r < layout.rows, f.uid).toBe(true);
          expect(tileAt(c, r), `${f.uid} on wall at ${c},${r}`).not.toBe(WALL);
        }
      }
    }
  });

  it('connects every free floor tile to the corridor', () => {
    const blocked = new Set<string>();
    for (const f of layout.furniture) {
      const a = infoOf(f);
      if (a.surface || a.wall) continue;
      for (let r = f.row + a.bg; r < f.row + a.h; r++)
        for (let c = f.col; c < f.col + a.w; c++) blocked.add(`${c},${r}`);
    }
    const walkable = (c: number, r: number) =>
      c >= 0 &&
      r >= 0 &&
      c < layout.cols &&
      r < layout.rows &&
      tileAt(c, r) !== WALL &&
      tileAt(c, r) !== VOID &&
      !blocked.has(`${c},${r}`);
    const start = [2, 14];
    expect(walkable(start[0], start[1])).toBe(true);
    const seen = new Set([start.join(',')]);
    const queue = [start];
    while (queue.length > 0) {
      const [c, r] = queue.shift()!;
      for (const [dc, dr] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const key = `${c + dc},${r + dr}`;
        if (!seen.has(key) && walkable(c + dc, r + dr)) {
          seen.add(key);
          queue.push([c + dc, r + dr]);
        }
      }
    }
    const unreachable: string[] = [];
    for (let r = 0; r < layout.rows; r++)
      for (let c = 0; c < layout.cols; c++)
        if (walkable(c, r) && !seen.has(`${c},${r}`)) unreachable.push(`${c},${r}`);
    expect(unreachable).toEqual([]);
  });
});
