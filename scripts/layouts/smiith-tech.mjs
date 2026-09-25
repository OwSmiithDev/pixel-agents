#!/usr/bin/env node
// Generates the bundled "Smiith Tech" default layout (40×30, graphite + cyan).
// Rooms are plain rectangles so the office stays editable as code.
//
//   node scripts/layouts/smiith-tech.mjs
//   → webview-ui/public/assets/default-layout-2.json

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const COLS = 40;
const ROWS = 30;
const WALL = 0;

// Floor patterns (TileType values) reused from the stock art.
const PLAIN = 1;
const GRID = 3;
const PLANK = 6;
const BRICK = 7;

// HSBC colors (Photoshop-style Colorize), graphite scale + one cyan + one warm wood.
const C = {
  wall: { h: 214, s: 18, b: -52, c: -56 },
  corridor: { h: 214, s: 12, b: -52, c: -6 },
  cyan: { h: 187, s: 58, b: -42, c: -8 },
  meetingBorder: { h: 28, s: 18, b: -45, c: -8 },
  meetingRug: { h: 216, s: 18, b: -50, c: -10 },
  dev: { h: 214, s: 10, b: -36, c: -6 },
  noc: { h: 218, s: 20, b: -72, c: -4 },
  lounge: { h: 30, s: 30, b: -18, c: -12 },
  loungeRug: { h: 189, s: 30, b: -48, c: -10 },
  support: { h: 196, s: 12, b: -40, c: -6 },
  demos: { h: 222, s: 12, b: -34, c: -6 },
  demosRug: { h: 216, s: 24, b: -50, c: -12 },
};

// Furniture tints.
const T = {
  desk: { h: 215, s: 9, b: 33, c: 20, colorize: true },
  nocDesk: { h: 217, s: 18, b: -42, c: 22, colorize: true },
  wood: { h: 30, s: 32, b: 12, c: 14, colorize: true },
  chair: { h: 187, s: 52, b: -8, c: 14, colorize: true },
  guestChair: { h: 221, s: 37, b: -10, c: 10, colorize: true },
  sofa: { h: 189, s: 45, b: -12, c: 12, colorize: true },
  bin: { h: 217, s: 12, b: -24, c: 8, colorize: true },
};

export function buildLayout() {
  const tiles = new Array(COLS * ROWS).fill(WALL);
  const tileColors = new Array(COLS * ROWS).fill(C.wall);
  const furniture = [];

  const paint = (c0, r0, c1, r1, type, color) => {
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        tiles[r * COLS + c] = type;
        tileColors[r * COLS + c] = color;
      }
  };
  const put = (uid, type, col, row, color) =>
    furniture.push(color ? { uid, type, col, row, color } : { uid, type, col, row });

  // ── Shell ────────────────────────────────────────────────
  // Rows: 0 wall | 1–11 top rooms | 12 wall | 13–15 corridor | 16 wall | 17–28 bottom rooms | 29 wall
  // Cols: 0 wall | 1–10 left | 11 wall | 12–27 center | 28 wall | 29–38 right | 39 wall
  const LEFT = [1, 10];
  const CENTER = [12, 27];
  const RIGHT = [29, 38];
  const TOP = [1, 11];
  const BOTTOM = [17, 28];

  paint(LEFT[0], TOP[0], LEFT[1], TOP[1], BRICK, C.meetingBorder);
  paint(2, 3, 9, 9, PLAIN, C.meetingRug);
  paint(CENTER[0], TOP[0], CENTER[1], TOP[1], GRID, C.dev);
  paint(RIGHT[0], TOP[0], RIGHT[1], TOP[1], GRID, C.noc);
  paint(LEFT[0], BOTTOM[0], LEFT[1], BOTTOM[1], PLANK, C.lounge);
  paint(2, 21, 9, 26, PLAIN, C.loungeRug);
  paint(CENTER[0], BOTTOM[0], CENTER[1], BOTTOM[1], GRID, C.support);
  paint(RIGHT[0], BOTTOM[0], RIGHT[1], BOTTOM[1], GRID, C.demos);
  paint(31, 22, 36, 27, PLAIN, C.demosRug);

  // Corridor with the cyan spine (signature) on its middle row.
  paint(1, 13, 38, 15, PLAIN, C.corridor);
  paint(1, 14, 38, 14, PLAIN, C.cyan);

  // One 2-tile door per room, centered, with a cyan threshold running to the spine.
  for (const doorCol of [5, 19, 33]) {
    paint(doorCol, 12, doorCol + 1, 13, PLAIN, C.cyan); // top rooms
    paint(doorCol, 15, doorCol + 1, 16, PLAIN, C.cyan); // bottom rooms
  }

  // ── Workstation helper: desk + monitor(s) + chair facing the desk ──
  const station = (
    uid,
    col,
    row,
    { pcs = ['PC_FRONT_OFF'], deskColor = T.desk, coffee = false } = {},
  ) => {
    put(`${uid}`, 'DESK_FRONT', col, row, deskColor);
    pcs.forEach((pc, i) => put(`${uid}-pc${i + 1}`, pc, col + 1 + i, row));
    put(`${uid}-chair`, 'CUSHIONED_CHAIR_BACK', col + 1, row + 2, T.chair);
    if (coffee) put(`${uid}-coffee`, 'COFFEE', col, row + 1);
  };

  // ── Meeting room (top-left) ──
  put('meet-table-a', 'TABLE_FRONT', 3, 4, T.desk);
  put('meet-table-b', 'TABLE_FRONT', 6, 4, T.desk);
  put('meet-chair-n1', 'CUSHIONED_CHAIR_FRONT', 4, 3, T.guestChair);
  put('meet-chair-n2', 'CUSHIONED_CHAIR_FRONT', 7, 3, T.guestChair);
  put('meet-chair-s1', 'CUSHIONED_CHAIR_BACK', 4, 8, T.guestChair);
  put('meet-chair-s2', 'CUSHIONED_CHAIR_BACK', 7, 8, T.guestChair);
  put('meet-chair-w', 'CUSHIONED_CHAIR_SIDE', 2, 6, T.guestChair);
  put('meet-chair-e', 'CUSHIONED_CHAIR_SIDE:left', 9, 6, T.guestChair);
  put('meet-coffee-1', 'COFFEE', 4, 6);
  put('meet-coffee-2', 'COFFEE', 7, 5);
  put('meet-board', 'WHITEBOARD', 2, -1);
  put('meet-painting', 'LARGE_PAINTING', 6, -1);
  put('meet-clock', 'CLOCK', 9, -1);
  put('meet-plant-w', 'LARGE_PLANT', 1, 9);
  put('meet-plant-e', 'LARGE_PLANT', 9, 9);

  // ── Development (top-center): 6 stations ──
  station('dev-desk-1', 13, 3, { coffee: true });
  station('dev-desk-2', 18, 3);
  station('dev-desk-3', 23, 3);
  station('dev-desk-4', 13, 7);
  station('dev-desk-5', 18, 7, { coffee: true });
  station('dev-desk-6', 23, 7);
  put('dev-board', 'WHITEBOARD', 18, -1);
  put('dev-clock', 'CLOCK', 26, -1);
  put('dev-painting', 'SMALL_PAINTING', 13, -1);
  put('dev-plant-nw', 'PLANT', 12, 1);
  put('dev-plant-ne', 'PLANT', 27, 1);
  put('dev-plant-se', 'LARGE_PLANT', 26, 9);
  put('dev-bin', 'BIN', 12, 11, T.bin);

  // ── Operations / NOC (top-right): 4 dual-monitor stations, always on ──
  const dual = ['PC_FRONT_ON_1', 'PC_FRONT_ON_1'];
  station('noc-desk-1', 30, 3, { pcs: dual, deskColor: T.nocDesk, coffee: true });
  station('noc-desk-2', 35, 3, { pcs: dual, deskColor: T.nocDesk });
  station('noc-desk-3', 30, 7, { pcs: dual, deskColor: T.nocDesk });
  station('noc-desk-4', 35, 7, { pcs: dual, deskColor: T.nocDesk, coffee: true });
  put('noc-board-1', 'WHITEBOARD', 30, -1);
  put('noc-board-2', 'WHITEBOARD', 35, -1);
  put('noc-clock', 'CLOCK', 33, -1);
  put('noc-plant-w', 'PLANT', 29, 10);
  put('noc-plant-ne', 'PLANT', 38, 1);
  put('noc-bin', 'BIN', 38, 11, T.bin);

  // ── Café & lounge (bottom-left) ──
  put('lounge-bar-a', 'DESK_FRONT', 1, 18, T.wood);
  put('lounge-bar-b', 'DESK_FRONT', 7, 18, T.wood);
  put('lounge-bar-coffee-1', 'COFFEE', 1, 19);
  put('lounge-bar-coffee-2', 'COFFEE', 3, 19);
  put('lounge-bar-coffee-3', 'COFFEE', 8, 19);
  put('lounge-shelf-a', 'BOOKSHELF', 1, 17);
  put('lounge-shelf-b', 'BOOKSHELF', 8, 17);
  put('lounge-hanging-a', 'HANGING_PLANT', 4, 16);
  put('lounge-hanging-b', 'HANGING_PLANT', 7, 16);
  put('lounge-table', 'COFFEE_TABLE', 5, 23, T.wood);
  put('lounge-table-coffee', 'COFFEE', 6, 24);
  put('lounge-sofa-n', 'SOFA_FRONT', 5, 22, T.sofa);
  put('lounge-sofa-s', 'SOFA_BACK', 5, 25, T.sofa);
  put('lounge-sofa-w', 'SOFA_SIDE', 3, 23, T.sofa);
  put('lounge-sofa-e', 'SOFA_SIDE:left', 8, 23, T.sofa);
  put('lounge-plant-sw', 'LARGE_PLANT', 1, 26);
  put('lounge-plant-se', 'LARGE_PLANT', 9, 26);
  put('lounge-bin', 'BIN', 10, 21, T.bin);

  // ── Support / AI (bottom-center): 6 stations ──
  station('sup-desk-1', 13, 19);
  station('sup-desk-2', 18, 19, { coffee: true });
  station('sup-desk-3', 23, 19);
  station('sup-desk-4', 13, 24, { coffee: true });
  station('sup-desk-5', 18, 24);
  station('sup-desk-6', 23, 24);
  put('sup-board', 'WHITEBOARD', 14, 16);
  put('sup-painting', 'SMALL_PAINTING_2', 23, 16);
  put('sup-clock', 'CLOCK', 25, 16);
  put('sup-plant-nw', 'PLANT_2', 12, 17);
  put('sup-plant-ne', 'PLANT_2', 27, 17);
  put('sup-plant-sw', 'LARGE_PLANT', 12, 26);
  put('sup-plant-se', 'LARGE_PLANT', 26, 26);
  put('sup-bin', 'BIN', 27, 22, T.bin);

  // ── Atendimento & demos (bottom-right): 2 stations + client corner ──
  station('demo-desk-1', 29, 19);
  station('demo-desk-2', 35, 19, { coffee: true });
  put('demo-table', 'SMALL_TABLE_FRONT', 33, 24, T.desk);
  put('demo-table-coffee', 'COFFEE', 34, 25);
  put('demo-chair-n', 'CUSHIONED_CHAIR_FRONT', 33, 23, T.guestChair);
  put('demo-chair-s', 'CUSHIONED_CHAIR_BACK', 34, 26, T.guestChair);
  put('demo-chair-w', 'CUSHIONED_CHAIR_SIDE', 32, 25, T.guestChair);
  put('demo-chair-e', 'CUSHIONED_CHAIR_SIDE:left', 35, 25, T.guestChair);
  put('demo-board', 'WHITEBOARD', 30, 16);
  put('demo-painting', 'LARGE_PAINTING', 36, 16);
  put('demo-plant-sw', 'LARGE_PLANT', 29, 26);
  put('demo-plant-se', 'LARGE_PLANT', 37, 26);
  put('demo-bin', 'BIN', 38, 22, T.bin);

  return { version: 1, cols: COLS, rows: ROWS, layoutRevision: 2, tiles, tileColors, furniture };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../webview-ui/public/assets/default-layout-2.json',
  );
  fs.writeFileSync(out, JSON.stringify(buildLayout(), null, 2) + '\n');
  console.log(`wrote ${path.relative(process.cwd(), out)}`);
}
