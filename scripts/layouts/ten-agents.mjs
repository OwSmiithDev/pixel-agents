#!/usr/bin/env node
// Generates the importable "10-agent office" template (32×24, graphite + cyan,
// consistent with the Smiith Tech default). One IDE desk, 9 agent desks, and a
// lounge with 10+ rest seats.
//
//   node scripts/layouts/ten-agents.mjs
//   → layouts/smiith-10-agentes.json

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const COLS = 32;
const ROWS = 24;
const WALL = 0;

// Floor patterns (TileType values) reused from the stock art.
const PLAIN = 1;
const GRID = 3;
const PLANK = 6;

// Graphite + cyan palette, matching scripts/layouts/smiith-tech.mjs.
const C = {
  wall: { h: 214, s: 18, b: -52, c: -56 },
  corridor: { h: 214, s: 12, b: -52, c: -6 },
  cyan: { h: 187, s: 58, b: -42, c: -8 },
  ide: { h: 214, s: 14, b: -30, c: -4 },
  agentes: { h: 214, s: 10, b: -36, c: -6 },
  lounge: { h: 30, s: 30, b: -18, c: -12 },
};

// Furniture tints.
const T = {
  desk: { h: 215, s: 9, b: 33, c: 20, colorize: true },
  wood: { h: 30, s: 32, b: 12, c: 14, colorize: true },
  chair: { h: 187, s: 52, b: -8, c: 14, colorize: true },
  chairGold: { h: 45, s: 60, b: 10, c: 20, colorize: true },
  sofa: { h: 189, s: 45, b: -12, c: 12, colorize: true },
};

// Area overlay colors (hex, per AreaDefinition).
const AREAS = [
  { label: 'IDE', color: '#e8c04a' },
  { label: 'Agentes', color: '#3fc7e6' },
  { label: 'Descanso', color: '#b98a55' },
];

export function buildLayout() {
  const tiles = new Array(COLS * ROWS).fill(WALL);
  const tileColors = new Array(COLS * ROWS).fill(C.wall);
  const areaTiles = new Array(COLS * ROWS).fill(null);
  const furniture = [];

  const paint = (c0, r0, c1, r1, type, color) => {
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        tiles[r * COLS + c] = type;
        tileColors[r * COLS + c] = color;
      }
  };
  const paintArea = (c0, r0, c1, r1, label) => {
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) areaTiles[r * COLS + c] = label;
  };
  const put = (uid, type, col, row, color) =>
    furniture.push(color ? { uid, type, col, row, color } : { uid, type, col, row });

  // ── Shell ────────────────────────────────────────────────
  // Rows: 0 wall | 1–12 top rooms | 13 wall | 14–16 corridor | 17 wall | 18–22 lounge | 23 wall
  // Cols: 0 wall | 1–6 IDE | 7 wall | 8–30 Agentes/lounge | 31 wall
  const IDE = [1, 6];
  const AGENTES = [8, 30];
  const TOP = [1, 12];
  const LOUNGE_COLS = [1, 30];
  const LOUNGE = [18, 22];

  paint(IDE[0], TOP[0], IDE[1], TOP[1], GRID, C.ide);
  paint(AGENTES[0], TOP[0], AGENTES[1], TOP[1], GRID, C.agentes);
  paint(LOUNGE_COLS[0], LOUNGE[0], LOUNGE_COLS[1], LOUNGE[1], PLANK, C.lounge);
  paintArea(IDE[0], TOP[0], IDE[1], TOP[1], 'IDE');
  paintArea(AGENTES[0], TOP[0], AGENTES[1], TOP[1], 'Agentes');
  paintArea(LOUNGE_COLS[0], LOUNGE[0], LOUNGE_COLS[1], LOUNGE[1], 'Descanso');

  // Corridor with the cyan spine (signature) on its middle row.
  paint(1, 14, 30, 16, PLAIN, C.corridor);
  paint(1, 15, 30, 15, PLAIN, C.cyan);

  // Doors: top rooms → corridor, corridor → lounge. Two-tile, cyan threshold.
  for (const doorCol of [3, 13, 23]) {
    paint(doorCol, 13, doorCol + 1, 14, PLAIN, C.cyan); // top rooms → corridor
  }
  for (const doorCol of [8, 20]) {
    paint(doorCol, 16, doorCol + 1, 17, PLAIN, C.cyan); // corridor → lounge
  }

  // ── Workstation helper: desk + PC + chair facing the desk ──
  const station = (
    uid,
    col,
    row,
    { chair = 'CUSHIONED_CHAIR_BACK', chairColor = T.chair } = {},
  ) => {
    put(`${uid}`, 'DESK_FRONT', col, row, T.desk);
    put(`${uid}-pc`, 'PC_FRONT_OFF', col + 1, row);
    put(`${uid}-chair`, chair, col + 1, row + 2, chairColor);
  };

  // ── IDE desk (top-left, area IDE) — gold-tinted chair ──
  station('ide-desk', 2, 2, { chairColor: T.chairGold });
  put('ide-board', 'WHITEBOARD', 2, -1);
  put('ide-plant', 'PLANT', 5, 10);

  // ── 9 agent desks (top-right, area Agentes), 3×3 grid ──
  let n = 0;
  for (const row of [2, 6, 10]) {
    for (const col of [10, 15, 20]) {
      n++;
      station(`agent-desk-${n}`, col, row);
    }
  }
  put('agentes-board', 'WHITEBOARD', 15, -1);
  put('agentes-clock', 'CLOCK', 24, -1);
  put('agentes-plant', 'LARGE_PLANT', 27, 9);

  // ── Lounge (area Descanso) — two symmetric sofa clusters + coffee bar ──
  const cluster = (prefix, tableCol) => {
    put(`${prefix}-table`, 'COFFEE_TABLE', tableCol, 20, T.wood);
    put(`${prefix}-table-coffee`, 'COFFEE', tableCol, 21);
    put(`${prefix}-sofa-n`, 'SOFA_FRONT', tableCol - 1, 19, T.sofa);
    put(`${prefix}-sofa-s`, 'SOFA_BACK', tableCol - 1, 22, T.sofa);
    put(`${prefix}-chair-w`, 'CUSHIONED_CHAIR_SIDE', tableCol - 2, 20, T.chair);
    put(`${prefix}-chair-e`, 'CUSHIONED_CHAIR_SIDE:left', tableCol + 3, 20, T.chair);
  };
  cluster('lounge-a', 5);
  cluster('lounge-b', 25);

  put('lounge-bar', 'DESK_FRONT', 14, 18, T.wood);
  put('lounge-bar-coffee-1', 'COFFEE', 14, 19);
  put('lounge-bar-coffee-2', 'COFFEE', 15, 19);
  put('lounge-bar-coffee-3', 'COFFEE', 16, 19);
  put('lounge-plant-w', 'LARGE_PLANT', 11, 18);
  put('lounge-plant-e', 'LARGE_PLANT', 18, 18);

  return {
    version: 1,
    cols: COLS,
    rows: ROWS,
    layoutRevision: 1,
    tiles,
    tileColors,
    furniture,
    areas: AREAS,
    areaTiles,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../layouts/smiith-10-agentes.json',
  );
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(buildLayout(), null, 2) + '\n');
  console.log(`wrote ${path.relative(process.cwd(), out)}`);
}
