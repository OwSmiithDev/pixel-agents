import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { AUTO_ON_FACING_DEPTH } from '../src/constants.js';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const assetsDir = path.resolve(rootDir, '../public/assets');
const layoutPath = path.resolve(rootDir, '../../layouts/smiith-10-agentes.json');
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
  areas?: Array<{ label: string; color: string }>;
  areaTiles?: Array<string | null>;
}
interface AssetInfo {
  w: number;
  h: number;
  bg: number;
  wall: boolean;
  surface: boolean;
  category: string;
  orientation?: string;
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
          category: String(manifest.category ?? ''),
          orientation: node.orientation ? String(node.orientation) : undefined,
        });
        return;
      }
      for (const m of (node.members as Record<string, unknown>[] | undefined) ?? []) walk(m);
    };
    walk(manifest);
  }
  return info;
}

const layout = JSON.parse(fs.readFileSync(layoutPath, 'utf-8')) as Layout;
const assets = loadAssetInfo();
const infoOf = (p: Placed): AssetInfo => {
  const base = p.type.split(':')[0];
  const a = assets.get(base);
  if (!a) throw new Error(`unknown furniture type ${p.type}`);
  return a;
};
const tileAt = (c: number, r: number): number => layout.tiles[r * layout.cols + c];

// Facing rule per plan: BACK→UP, FRONT→DOWN, SIDE→RIGHT, SIDE:left→LEFT.
type Dir = 'up' | 'down' | 'left' | 'right';
function facingOf(p: Placed): Dir {
  const isLeft = p.type.endsWith(':left');
  const orientation = infoOf(p).orientation;
  if (orientation === 'back') return 'up';
  if (orientation === 'front') return 'down';
  if (orientation === 'side') return isLeft ? 'left' : 'right';
  return 'down';
}
const OFFSET: Record<Dir, [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

interface SeatTile {
  uid: string;
  col: number;
  row: number;
  facing: Dir;
}

/** Every footprint tile of a `chairs`-category item (excluding background rows) is a seat. */
function collectSeats(): SeatTile[] {
  const seats: SeatTile[] = [];
  for (const f of layout.furniture) {
    const a = infoOf(f);
    if (a.category !== 'chairs') continue;
    const facing = facingOf(f);
    let n = 0;
    for (let dr = a.bg; dr < a.h; dr++) {
      for (let dc = 0; dc < a.w; dc++) {
        seats.push({
          uid: n === 0 ? f.uid : `${f.uid}:${n}`,
          col: f.col + dc,
          row: f.row + dr,
          facing,
        });
        n++;
      }
    }
  }
  return seats;
}

/** PC tiles: every footprint cell of an `electronics` item. */
function collectPcTiles(): Set<string> {
  const tiles = new Set<string>();
  for (const f of layout.furniture) {
    const a = infoOf(f);
    if (a.category !== 'electronics') continue;
    for (let dr = 0; dr < a.h; dr++)
      for (let dc = 0; dc < a.w; dc++) tiles.add(`${f.col + dc},${f.row + dr}`);
  }
  return tiles;
}

// Mirrors officeState.ts `isSeatFacingElectronics` exactly: scans depth 1..AUTO_ON_FACING_DEPTH
// along the facing direction, plus the perpendicular ±1 tiles at each depth.
function facesElectronics(seat: SeatTile, pcTiles: Set<string>): boolean {
  const [dc, dr] = OFFSET[seat.facing];
  for (let d = 1; d <= AUTO_ON_FACING_DEPTH; d++) {
    const tileCol = seat.col + dc * d;
    const tileRow = seat.row + dr * d;
    if (pcTiles.has(`${tileCol},${tileRow}`)) return true;
    if (dc !== 0) {
      if (pcTiles.has(`${tileCol},${tileRow - 1}`) || pcTiles.has(`${tileCol},${tileRow + 1}`)) {
        return true;
      }
    } else if (
      pcTiles.has(`${tileCol - 1},${tileRow}`) ||
      pcTiles.has(`${tileCol + 1},${tileRow}`)
    ) {
      return true;
    }
  }
  return false;
}

function areaOf(col: number, row: number): string | null {
  if (!layout.areaTiles) return null;
  return layout.areaTiles[row * layout.cols + col] ?? null;
}

describe('Smiith 10-agent template layout', () => {
  it('is 32x24 with full tile/color/area arrays', () => {
    expect(layout.cols).toBe(32);
    expect(layout.rows).toBe(24);
    expect(layout.tiles).toHaveLength(768);
    expect(layout.tileColors).toHaveLength(768);
    expect(layout.areaTiles).toHaveLength(768);
  });

  it('has exactly 10 seats facing a PC (1 IDE + 9 agents)', () => {
    const pcTiles = collectPcTiles();
    const seats = collectSeats();
    const working = seats.filter((s) => facesElectronics(s, pcTiles));
    expect(working).toHaveLength(10);
  });

  it('has at least 10 rest seats inside Descanso that never face a PC', () => {
    const pcTiles = collectPcTiles();
    const seats = collectSeats();
    const resting = seats.filter(
      (s) => !facesElectronics(s, pcTiles) && areaOf(s.col, s.row) === 'Descanso',
    );
    expect(resting.length).toBeGreaterThanOrEqual(10);
  });

  it('declares the IDE, Agentes and Descanso areas', () => {
    const labels = (layout.areas ?? []).map((a) => a.label);
    expect(labels).toEqual(expect.arrayContaining(['IDE', 'Agentes', 'Descanso']));
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

  it('never stacks a chair seat tile onto another chair background row', () => {
    const chairs = layout.furniture.filter((f) => infoOf(f).category === 'chairs');
    const seatTiles = new Map<string, string>();
    const bgTiles = new Map<string, string>();
    for (const f of chairs) {
      const a = infoOf(f);
      for (let dr = 0; dr < a.h; dr++) {
        for (let dc = 0; dc < a.w; dc++) {
          const key = `${f.col + dc},${f.row + dr}`;
          (dr < a.bg ? bgTiles : seatTiles).set(key, f.uid);
        }
      }
    }
    for (const [key, uid] of seatTiles) {
      expect(
        bgTiles.get(key),
        `${uid} seat at ${key} sits on another chair's background`,
      ).toBeUndefined();
    }
  });

  it('uses :left side-chair variants on the east side of their paired table', () => {
    const chairs = layout.furniture.filter(
      (f) => infoOf(f).category === 'chairs' && infoOf(f).orientation === 'side',
    );
    const tables = layout.furniture.filter((f) => infoOf(f).category === 'desks');
    for (const chair of chairs) {
      // Pair each side chair with the nearest table on its own row.
      const sameRow = tables.filter((t) => chair.row >= t.row && chair.row < t.row + infoOf(t).h);
      if (sameRow.length === 0) continue;
      const nearest = sameRow.reduce((best, t) =>
        Math.abs(t.col - chair.col) < Math.abs(best.col - chair.col) ? t : best,
      );
      const isEastOfTable = chair.col > nearest.col + infoOf(nearest).w - 1;
      expect(chair.type.endsWith(':left'), `${chair.uid} should be a :left variant`).toBe(
        isEastOfTable,
      );
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

  it('connects every free floor tile to every other (BFS reachability)', () => {
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

    // Seed from a corridor tile (must be walkable by construction).
    const start: [number, number] = [2, 15];
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

    // Every seat (occupied by its own chair, so not itself "walkable") must have
    // at least one open, reachable neighbor a character can approach it from.
    const seats = collectSeats();
    for (const s of seats) {
      const reachableNeighbor = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ].some(([dc, dr]) => seen.has(`${s.col + dc},${s.row + dr}`));
      expect(reachableNeighbor, `seat ${s.uid} at ${s.col},${s.row} unreachable`).toBe(true);
    }
  });
});
