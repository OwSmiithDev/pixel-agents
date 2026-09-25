/**
 * Agent routines (Stage 1): work seat / rest seat, overflow, rest routine, and
 * the "agents on top of each other" fix (sub-agents used to be seatless and
 * typed wherever they stood — see task-3 root cause).
 *
 * Runs on the user's real 32x24 layout: 10 PC seats facing UP (work-ide in
 * area IDE, work-agent-01..09 in Agentes) and 10 lounge seats in Descanso.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { describe, test } from 'vitest';

import {
  MATRIX_EFFECT_DURATION_SEC,
  REST_DELAY_SEC,
  WALK_SPEED_PX_PER_SEC,
} from '../src/constants.js';
import type { ExistingAgentsOffice } from '../src/office/engine/existingAgents.js';
import { reconcileExistingAgents } from '../src/office/engine/existingAgents.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import type { Character, OfficeLayout } from '../src/office/types.js';
import { CharacterState } from '../src/office/types.js';
import { userLayout } from './fixtures/office.js';

const DT = 1 / 30;
const AUTO_WORK = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `work-agent-0${n}`);

function step(os: OfficeState, seconds: number, each?: () => void): void {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    os.update(DT);
    each?.();
  }
}

function ch(os: OfficeState, id: number): Character {
  const c = os.characters.get(id);
  assert.ok(c, `character ${id} exists`);
  return c;
}

function seatTile(os: OfficeState, uid: string): string {
  const s = os.seats.get(uid)!;
  return `${s.seatCol},${s.seatRow}`;
}

function tileOf(c: Character): string {
  return `${c.tileCol},${c.tileRow}`;
}

/** Fill every auto-assignable work seat with agents 1..9 (no spawn effect). */
function fullOffice(): OfficeState {
  const os = new OfficeState(userLayout());
  for (let id = 1; id <= 9; id++) os.addAgent(id, 0, 0, undefined, true);
  return os;
}

/** Seated characters (TYPE/REST) must stand on their own seat, one per tile. */
function assertNoStacking(os: OfficeState, label: string): void {
  const byTile = new Map<string, number>();
  for (const c of os.characters.values()) {
    if (c.matrixEffect) continue;
    if (c.state !== CharacterState.TYPE && c.state !== CharacterState.REST) continue;
    const t = tileOf(c);
    const own = [c.seatId, c.restSeatId].filter(Boolean).map((u) => seatTile(os, u!));
    assert.ok(own.includes(t), `${label}: ${c.id} seated off its own seats at ${t}`);
    assert.equal(byTile.get(t), undefined, `${label}: ${c.id} and ${byTile.get(t)} share ${t}`);
    byTile.set(t, c.id);
  }
}

describe('seat classification', () => {
  test('work seats face a PC; lounge seats are rest seats', () => {
    const os = new OfficeState(userLayout());
    for (const uid of [...AUTO_WORK, 'work-ide']) assert.equal(os.isWorkSeat(uid), true, uid);
    for (const uid of os.seats.keys()) {
      if (uid.startsWith('rest-')) assert.equal(os.isWorkSeat(uid), false, uid);
    }
  });

  test('agents get a work seat (never a rest seat, never the IDE seat) and a rest seat', () => {
    const os = fullOffice();
    const work = new Set<string>();
    const rest = new Set<string>();
    for (let id = 1; id <= 9; id++) {
      const c = ch(os, id);
      assert.ok(AUTO_WORK.includes(c.seatId!), `${id} work seat ${c.seatId}`);
      assert.ok(c.restSeatId && !os.isWorkSeat(c.restSeatId), `${id} rest seat ${c.restSeatId}`);
      assert.equal(os.seatZone(c.restSeatId!), 'Descanso');
      work.add(c.seatId!);
      rest.add(c.restSeatId!);
    }
    assert.equal(work.size, 9, 'distinct work seats');
    assert.equal(rest.size, 9, 'distinct rest seats');
  });

  test('findFreeWorkSeat can opt into IDE seats (hook for the IDE role)', () => {
    const os = fullOffice();
    assert.equal(os.findFreeWorkSeat(), null);
    assert.equal(os.findFreeWorkSeat({ allowIde: true }), 'work-ide');
  });
});

describe('overflow', () => {
  test('no free work seat → no character, id listed in overflow (FIFO)', () => {
    const os = fullOffice();
    os.addAgent(10, 2, 45, undefined, true, 'proj');
    os.addAgent(11);
    assert.equal(os.characters.has(10), false);
    assert.equal(os.characters.has(11), false);
    assert.deepEqual(os.getOverflowAgentIds(), [10, 11]);
    for (const c of os.characters.values()) assert.ok(AUTO_WORK.includes(c.seatId!));
  });

  test('freed work seat promotes the oldest overflow agent with its data', () => {
    const os = fullOffice();
    os.addAgent(10, 2, 45, undefined, true, 'proj');
    os.addAgent(11);
    os.setAgentActive(10, false);
    const freed = ch(os, 3).seatId!;
    os.removeAgent(3);
    // The despawning sprite still sits on the chair: the seat is not reused yet.
    assert.deepEqual(os.getOverflowAgentIds(), [10, 11]);
    step(os, MATRIX_EFFECT_DURATION_SEC + 0.1);
    assert.equal(os.characters.has(3), false);
    const p = ch(os, 10);
    assert.equal(p.seatId, freed);
    assert.equal(p.palette, 2);
    assert.equal(p.hueShift, 45);
    assert.equal(p.folderName, 'proj');
    assert.equal(p.isActive, false, 'activity recorded while in overflow');
    assert.deepEqual(os.getOverflowAgentIds(), [11]);
  });

  test('removing an overflow agent just drops it', () => {
    const os = fullOffice();
    os.addAgent(10);
    os.removeAgent(10);
    assert.deepEqual(os.getOverflowAgentIds(), []);
    os.removeAgent(1);
    step(os, 1);
    assert.equal(os.characters.has(10), false);
  });

  test('re-adding an id during its despawn keeps the agent', () => {
    const os = new OfficeState(userLayout());
    os.addAgent(7, 0, 0, 'work-agent-01', true);
    os.removeAgent(7);
    os.addAgent(7);
    step(os, 2);
    assert.equal(ch(os, 7).seatId, 'work-agent-01');
  });
});

describe('sub-agents', () => {
  test('each sub-agent gets its own free work seat nearest the parent', () => {
    const os = new OfficeState(userLayout());
    os.addAgent(1, 0, 0, 'work-agent-05', true);
    const parent = os.seats.get('work-agent-05')!;
    const subs = ['t1', 't2', 't3'].map((t) => os.addSubagent(1, t));
    step(os, MATRIX_EFFECT_DURATION_SEC + 0.1);
    const seats = subs.map((id) => ch(os, id).seatId!);
    assert.equal(new Set(seats).size, 3, 'distinct seats');
    const dist = (uid: string) => {
      const s = os.seats.get(uid)!;
      return Math.abs(s.seatCol - parent.seatCol) + Math.abs(s.seatRow - parent.seatRow);
    };
    const maxTaken = Math.max(...seats.map(dist));
    for (const uid of AUTO_WORK) {
      assert.ok(os.isWorkSeat(uid));
      if (!os.seats.get(uid)!.assigned) assert.ok(dist(uid) >= maxTaken, `${uid} was closer`);
    }
    for (const id of subs) assert.equal(ch(os, id).restSeatId, null, 'sub-agents never rest-seat');
  });

  test('parent missing: sub-agent still gets a work seat (no corner spawn)', () => {
    const os = new OfficeState(userLayout());
    const id = os.addSubagent(99, 'x');
    const c = ch(os, id);
    assert.ok(AUTO_WORK.includes(c.seatId!));
    assert.equal(tileOf(c), seatTile(os, c.seatId!));
  });

  test('no free work seat → sub-agent overflows, promoted when a seat frees', () => {
    const os = fullOffice();
    const sub = os.addSubagent(1, 'bg');
    assert.equal(os.characters.has(sub), false);
    assert.deepEqual(os.getOverflowAgentIds(), [sub]);
    assert.equal(os.getSubagentId(1, 'bg'), sub);
    os.removeAgent(5);
    step(os, 1);
    const c = ch(os, sub);
    assert.equal(c.isSubagent, true);
    assert.equal(c.parentAgentId, 1);
    assert.ok(AUTO_WORK.includes(c.seatId!));
  });

  test('removing an overflow sub-agent drops it', () => {
    const os = fullOffice();
    const sub = os.addSubagent(1, 'bg');
    os.removeSubagent(1, 'bg');
    assert.deepEqual(os.getOverflowAgentIds(), []);
    os.removeAgent(4);
    step(os, 1);
    assert.equal(os.characters.has(sub), false);
  });

  test('sub-agent seat frees after its despawn and promotes overflow', () => {
    const os = fullOffice();
    os.removeAgent(9);
    step(os, 1);
    const sub = os.addSubagent(1, 'a');
    os.addAgent(20);
    assert.deepEqual(os.getOverflowAgentIds(), [20]);
    os.removeSubagent(1, 'a');
    step(os, 1);
    assert.equal(os.characters.has(sub), false);
    assert.ok(AUTO_WORK.includes(ch(os, 20).seatId!));
  });
});

describe('no stacking', () => {
  test('agents and sub-agents cycling active/idle never share a seat tile', () => {
    const os = new OfficeState(userLayout());
    for (let id = 1; id <= 4; id++) os.addAgent(id, 0, 0, undefined, true);
    const subs = ['a', 'b', 'c', 'd'].map((t) => os.addSubagent(1, t));
    const ids = [1, 2, 3, 4, ...subs];
    let t = 0;
    step(os, 600, () => {
      t++;
      if (t % 150 === 0) {
        for (const id of ids) os.setAgentActive(id, Math.random() < 0.5);
      }
      assertNoStacking(os, `frame ${t}`);
    });
    // All seated at the end of an active phase: sprites never overlap.
    for (const id of ids) os.setAgentActive(id, true);
    step(os, 60);
    const typing = ids.map((id) => ch(os, id));
    for (const c of typing) assert.equal(c.state, CharacterState.TYPE, `${c.id} typing`);
    assertNoStacking(os, 'final');
  });
});

describe('rest routine', () => {
  function oneAgent(layout: OfficeLayout = userLayout()): { os: OfficeState; c: Character } {
    const os = new OfficeState(layout);
    os.addAgent(1, 0, 0, 'work-agent-05', true);
    step(os, 1);
    return { os, c: ch(os, 1) };
  }

  test('turn end → 2 s at the PC → walk to the rest seat → seated idle, no wandering', () => {
    const { os, c } = oneAgent();
    assert.equal(c.state, CharacterState.TYPE);
    os.setAgentActive(1, false);
    step(os, REST_DELAY_SEC - 0.2);
    assert.equal(c.state, CharacterState.TYPE, 'still at the PC before the delay');
    assert.equal(tileOf(c), seatTile(os, 'work-agent-05'));
    step(os, 0.4);
    assert.equal(c.state, CharacterState.WALK, 'left for the lounge after the delay');
    step(os, 30);
    assert.equal(c.state, CharacterState.REST);
    assert.equal(tileOf(c), seatTile(os, c.restSeatId!));
    assert.equal(c.dir, os.seats.get(c.restSeatId!)!.facingDir);
    const at = { x: c.x, y: c.y };
    step(os, 300);
    assert.deepEqual({ x: c.x, y: c.y }, at, 'no wandering while resting');
    assert.equal(c.state, CharacterState.REST);
  });

  test('becoming active cancels the rest route and walks back without teleporting', () => {
    const { os, c } = oneAgent();
    os.setAgentActive(1, false);
    step(os, REST_DELAY_SEC + 1.1); // ~1 s into the walk
    assert.equal(c.state, CharacterState.WALK);
    os.setAgentActive(1, true);
    const maxStep = WALK_SPEED_PX_PER_SEC * DT + 1e-6;
    let px = c.x;
    let py = c.y;
    step(os, 30, () => {
      const d = Math.hypot(c.x - px, c.y - py);
      assert.ok(d <= maxStep, `moved ${d}px in one frame`);
      px = c.x;
      py = c.y;
    });
    assert.equal(c.state, CharacterState.TYPE);
    assert.equal(tileOf(c), seatTile(os, 'work-agent-05'));
  });

  test('active again while resting → walks to the PC and types', () => {
    const { os, c } = oneAgent();
    os.setAgentActive(1, false);
    step(os, 40);
    assert.equal(c.state, CharacterState.REST);
    os.setAgentActive(1, true);
    step(os, 40);
    assert.equal(c.state, CharacterState.TYPE);
    assert.equal(tileOf(c), seatTile(os, 'work-agent-05'));
  });

  test('no rest seat → seated idle at the PC, never wanders', () => {
    const layout = userLayout();
    layout.furniture = layout.furniture.filter((f) => !f.uid.startsWith('rest-'));
    const { os, c } = oneAgent(layout);
    assert.equal(c.restSeatId, null);
    os.setAgentActive(1, false);
    step(os, REST_DELAY_SEC + 0.2);
    assert.equal(c.state, CharacterState.REST);
    assert.equal(tileOf(c), seatTile(os, 'work-agent-05'));
    step(os, 300);
    assert.equal(tileOf(c), seatTile(os, 'work-agent-05'));
    assert.equal(c.state, CharacterState.REST);
  });

  test('repeated inactive signals do not restart the delay', () => {
    const { os, c } = oneAgent();
    os.setAgentActive(1, false);
    for (let i = 0; i < 4; i++) {
      step(os, 0.6);
      os.setAgentActive(1, false);
    }
    assert.notEqual(c.state, CharacterState.TYPE);
  });
});

describe('pathfinding', () => {
  test('only the updating character’s two seats are unblocked', () => {
    const os = new OfficeState(userLayout());
    os.addAgent(1, 0, 0, undefined, true);
    os.addAgent(2, 0, 0, undefined, true);
    const a = ch(os, 1);
    const b = ch(os, 2);
    const keys = (c: Character) => [seatTile(os, c.seatId!), seatTile(os, c.restSeatId!)];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (os as any).withOwnSeatUnblocked(a, () => {
      for (const k of keys(a)) assert.equal(os.blockedTiles.has(k), false, `own ${k} open`);
      for (const k of keys(b)) assert.equal(os.blockedTiles.has(k), true, `other ${k} blocked`);
    });
    for (const k of [...keys(a), ...keys(b)]) assert.equal(os.blockedTiles.has(k), true);
  });
});

describe('restore', () => {
  test('conflicting persisted seats never double-assign', () => {
    const os = new OfficeState(userLayout());
    os.addAgent(1, 0, 0, 'work-agent-03', true, undefined, undefined, 'rest-armchair');
    os.addAgent(2, 0, 0, 'work-agent-03', true, undefined, undefined, 'rest-armchair');
    assert.equal(ch(os, 1).seatId, 'work-agent-03');
    assert.equal(ch(os, 1).restSeatId, 'rest-armchair');
    assert.notEqual(ch(os, 2).seatId, 'work-agent-03');
    assert.notEqual(ch(os, 2).restSeatId, 'rest-armchair');
  });

  test('persisted seats are re-validated as work/rest', () => {
    const os = new OfficeState(userLayout());
    os.addAgent(1, 0, 0, 'rest-armchair', true, undefined, undefined, 'work-agent-02');
    const c = ch(os, 1);
    assert.ok(AUTO_WORK.includes(c.seatId!), `work seat ${c.seatId}`);
    assert.ok(c.restSeatId && !os.isWorkSeat(c.restSeatId), `rest seat ${c.restSeatId}`);
  });

  test('layout rebuild drops a work seat that is no longer a work seat', () => {
    const os = new OfficeState(userLayout());
    os.addAgent(1, 0, 0, 'work-agent-01', true);
    const layout = userLayout();
    // Remove every PC around work-agent-01 (17,5): the chair becomes a rest seat.
    const pcNear = (f: { col: number; row: number; type: string }) =>
      f.type.includes('PC') && Math.abs(f.col - 17) <= 1 && f.row >= 2 && f.row <= 4;
    assert.ok(layout.furniture.some(pcNear), 'fixture has a PC at work-agent-01');
    layout.furniture = layout.furniture.filter((f) => !pcNear(f));
    os.rebuildFromLayout(layout);
    assert.equal(os.isWorkSeat('work-agent-01'), false);
    assert.notEqual(ch(os, 1).seatId, 'work-agent-01');
    assert.ok(os.isWorkSeat(ch(os, 1).seatId!));
  });

  test('an editor rebuild leaves resting and walking agents where they are', () => {
    const os = new OfficeState(userLayout());
    os.addAgent(1, 0, 0, 'work-agent-05', true);
    os.addAgent(2, 0, 0, 'work-agent-01', true);
    os.setAgentActive(1, false);
    step(os, 40);
    os.setAgentActive(2, false);
    step(os, REST_DELAY_SEC + 1.5);
    const a = ch(os, 1);
    const b = ch(os, 2);
    assert.equal(a.state, CharacterState.REST);
    assert.equal(b.state, CharacterState.WALK);
    const aAt = tileOf(a);
    os.rebuildFromLayout(userLayout());
    assert.equal(tileOf(a), aAt, 'resting agent not snapped to its PC');
    assert.equal(a.state, CharacterState.REST);
    assert.equal(b.state, CharacterState.WALK, 'walker keeps walking');
    step(os, 40);
    assert.equal(tileOf(b), seatTile(os, b.restSeatId!));
  });

  test('persistable seats carry restSeatId', () => {
    const os = new OfficeState(userLayout());
    os.addAgent(1, 0, 0, 'work-agent-03', true, undefined, undefined, 'rest-armchair');
    assert.deepEqual(os.getPersistableSeats()[1], {
      palette: 0,
      hueShift: 0,
      seatId: 'work-agent-03',
      restSeatId: 'rest-armchair',
    });
  });

  test('existingAgents restore forwards restSeatId', () => {
    const calls: unknown[][] = [];
    const office: ExistingAgentsOffice = {
      characters: { has: () => false },
      addAgent: (...args) => void calls.push(args),
      setHeadless: () => {},
    };
    reconcileExistingAgents(
      office,
      [5],
      { 5: { seatId: 'work-agent-03', restSeatId: 'rest-armchair' } },
      {},
      true,
      [],
    );
    assert.equal(calls[0][3], 'work-agent-03');
    assert.equal(calls[0][7], 'rest-armchair');
  });
});

describe('reassignSeat', () => {
  test('to an occupied seat keeps the old seat', () => {
    const os = new OfficeState(userLayout());
    os.addAgent(1, 0, 0, 'work-agent-01', true);
    os.addAgent(2, 0, 0, 'work-agent-02', true);
    os.reassignSeat(2, 'work-agent-01');
    assert.equal(ch(os, 2).seatId, 'work-agent-02');
    assert.equal(os.seats.get('work-agent-02')!.assigned, true);
    os.addAgent(3, 0, 0, 'work-agent-02', true);
    assert.notEqual(ch(os, 3).seatId, 'work-agent-02');
  });

  test('to a rest seat is refused; to a free work seat moves and frees the old one', () => {
    const os = new OfficeState(userLayout());
    os.addAgent(1, 0, 0, 'work-agent-01', true);
    const free = [...os.seats.values()].find((s) => !s.assigned && !os.isWorkSeat(s.uid))!;
    os.reassignSeat(1, free.uid);
    assert.equal(ch(os, 1).seatId, 'work-agent-01');
    os.reassignSeat(1, 'work-agent-09');
    assert.equal(ch(os, 1).seatId, 'work-agent-09');
    assert.equal(os.seats.get('work-agent-01')!.assigned, false);
    step(os, 30);
    assert.equal(tileOf(ch(os, 1)), seatTile(os, 'work-agent-09'));
  });
});
