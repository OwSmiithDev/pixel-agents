/**
 * Agent routines (Stage 2): IDE role, `Agente NN` labels, overflow metadata,
 * task-title fallback text and the seat-pick cursor.
 *
 * Runs on the user's real 32x24 layout: work-ide (area IDE), work-agent-01..09
 * (Agentes) and 10 lounge seats (Descanso).
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { describe, test } from 'vitest';

import { MATRIX_EFFECT_DURATION_SEC } from '../src/constants.js';
import { computeNormalModeCursor } from '../src/office/components/officeCanvasCursor.js';
import {
  cleanTaskTitle,
  compactOverlayText,
  taskTitleText,
} from '../src/office/components/overlayText.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import { userLayout } from './fixtures/office.js';

function office(ids: number[]): OfficeState {
  const os = new OfficeState(userLayout());
  for (const id of ids) os.addAgent(id, 0, 0, undefined, true);
  return os;
}

function finishDespawns(os: OfficeState): void {
  const n = Math.ceil(MATRIX_EFFECT_DURATION_SEC / (1 / 30)) + 2;
  for (let i = 0; i < n; i++) os.update(1 / 30);
}

describe('roles and labels', () => {
  test('first agent is IDE; the rest are Agente 01, 02… in creation order', () => {
    const os = office([5, 7, 9]);
    assert.equal(os.getAgentLabel(5), 'IDE');
    assert.equal(os.isIdeAgent(5), true);
    assert.equal(os.getAgentLabel(7), 'Agente 01');
    assert.equal(os.getAgentLabel(9), 'Agente 02');
    assert.equal(os.isIdeAgent(7), false);
  });

  test('a closed agent frees its number; the lowest free number is reused', () => {
    const os = office([1, 2, 3, 4]);
    os.removeAgent(3); // Agente 02
    os.addAgent(8, 0, 0, undefined, true);
    assert.equal(os.getAgentLabel(8), 'Agente 02');
    os.addAgent(9, 0, 0, undefined, true);
    assert.equal(os.getAgentLabel(9), 'Agente 04');
    assert.equal(os.getAgentLabel(3), undefined);
  });

  test('IDE closes → lowest remaining live agent becomes IDE and keeps its seat', () => {
    const os = office([1, 4, 2]);
    const seatOf2 = os.characters.get(2)!.seatId;
    os.removeAgent(1);
    assert.equal(os.getAgentLabel(2), 'IDE');
    assert.equal(os.getAgentLabel(4), 'Agente 01');
    assert.equal(os.characters.get(2)!.seatId, seatOf2, 'no reseating');
    // Agente 02 (the new IDE's old number) is free again
    os.addAgent(6, 0, 0, undefined, true);
    assert.equal(os.getAgentLabel(6), 'Agente 02');
  });

  test('overflow agents get an Agente NN label', () => {
    const os = office([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    assert.deepEqual(os.getOverflowAgentIds(), [11]);
    assert.equal(os.getAgentLabel(11), 'Agente 10');
  });

  test('sub-agents have no role label', () => {
    const os = office([1]);
    const sub = os.addSubagent(1, 'toolu_1');
    assert.equal(os.getAgentLabel(sub), undefined);
    assert.equal(os.isIdeAgent(sub), false);
  });

  test('IDE sits in the IDE area; other agents never do', () => {
    const os = office([1, 2, 3]);
    assert.equal(os.characters.get(1)!.seatId, 'work-ide');
    for (const id of [2, 3]) assert.notEqual(os.characters.get(id)!.seatId, 'work-ide');
  });

  test('a non-IDE agent does not claim a persisted IDE seat reserved for a waiting IDE', () => {
    // IDE 20 is waiting in overflow (no seat) → the IDE seat stays reserved for it
    const os = new OfficeState(userLayout());
    os.addAgent(20, 0, 0, 'work-agent-01', true); // IDE, seated outside the IDE area
    os.removeAgent(20);
    os.addAgent(2, 0, 0, undefined, true); // IDE by hand-off, no seat yet → placed in IDE area
    assert.equal(os.characters.get(2)!.seatId, 'work-ide');
    os.addAgent(3, 0, 0, 'work-ide', true); // stale persisted IDE seat, already taken
    assert.notEqual(os.characters.get(3)!.seatId, 'work-ide');
  });

  test('IDE hand-off frees the IDE seat for everyone: a waiting agent is promoted', () => {
    const os = office([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    assert.equal(os.characters.get(1)!.seatId, 'work-ide');
    assert.deepEqual(os.getOverflowAgentIds(), [11]);
    os.removeAgent(1);
    finishDespawns(os);
    // agent 2 is IDE now but keeps its seat (no reseating) → work-ide is an ordinary seat
    assert.equal(os.getAgentLabel(2), 'IDE');
    assert.notEqual(os.characters.get(2)!.seatId, 'work-ide');
    assert.deepEqual(os.getOverflowAgentIds(), []);
    assert.equal(os.characters.get(11)!.seatId, 'work-ide');
  });

  test('a waiting IDE gets the reserved IDE seat even behind an older waiting agent', () => {
    const os = office([20, 21, 22, 23, 24, 25, 26, 27, 28, 29]);
    os.addAgent(30, 0, 0, undefined, true);
    os.addAgent(3, 0, 0, undefined, true);
    assert.deepEqual(os.getOverflowAgentIds(), [30, 3]);
    os.removeAgent(20);
    assert.equal(os.getAgentLabel(3), 'IDE', 'lowest live id inherits the role');
    finishDespawns(os);
    assert.equal(os.characters.get(3)?.seatId, 'work-ide');
    assert.deepEqual(os.getOverflowAgentIds(), [30]);
  });
});

describe('overflow keeps teammate data', () => {
  test('team info set while overflowed is applied on promotion', () => {
    const os = office([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    os.addAgent(11, 0, 0, undefined, true, undefined, 2);
    os.setTeamInfo(11, 'squad', 'reviewer', false, 2);
    assert.equal(os.characters.has(11), false);
    os.removeAgent(3);
    finishDespawns(os);
    const c = os.characters.get(11);
    assert.ok(c, 'promoted');
    assert.equal(c.teamName, 'squad');
    assert.equal(c.agentName, 'reviewer');
    assert.equal(c.leadAgentId, 2);
  });

  test('a seated teammate pushed back to overflow keeps its team data', () => {
    const os = office([1, 2]);
    os.addAgent(3, 0, 0, undefined, true, undefined, 2);
    os.setTeamInfo(3, 'squad', 'tester', false, 2);
    os.setTeamInfo(2, 'squad', undefined, true);
    // Layout rebuild with no work seats → everyone overflows; restoring promotes back
    const layout = userLayout();
    os.rebuildFromLayout({ ...layout, furniture: [] });
    assert.ok(os.getOverflowAgentIds().includes(3));
    os.rebuildFromLayout(userLayout());
    assert.equal(os.characters.get(3)?.agentName, 'tester');
    assert.equal(os.characters.get(3)?.leadAgentId, 2);
    assert.equal(os.characters.get(2)?.isTeamLead, true);
  });
});

describe('task title text', () => {
  test('falls back to "Sem tarefa informada"', () => {
    assert.equal(taskTitleText(undefined), 'Sem tarefa informada');
    assert.equal(taskTitleText(null), 'Sem tarefa informada');
    assert.equal(taskTitleText('   '), 'Sem tarefa informada');
    assert.equal(taskTitleText('Corrigir login'), 'Corrigir login');
  });
});

describe('compact overlay text', () => {
  test('label · task title wins over activity', () => {
    assert.equal(compactOverlayText('IDE', 'Corrigir login', 'Idle'), 'IDE · Corrigir login');
  });

  test('falls back to activity, then to the label alone', () => {
    assert.equal(
      compactOverlayText('Agente 01', null, 'Reading App.tsx'),
      'Agente 01 · Reading App.tsx',
    );
    assert.equal(compactOverlayText('Agente 01', '  ', undefined), 'Agente 01');
    assert.equal(compactOverlayText(undefined, null, 'Idle'), 'Idle');
    assert.equal(compactOverlayText(undefined, null, undefined), '');
  });

  test('an urgent activity wins over the task title', () => {
    assert.equal(
      compactOverlayText('Agente 03', 'Corrigir login', 'Needs approval', true),
      'Agente 03 · Needs approval',
    );
    assert.equal(
      compactOverlayText('Agente 03', 'Corrigir login', 'Waiting for input', true),
      'Agente 03 · Waiting for input',
    );
    // urgent without an activity still falls back to the title
    assert.equal(
      compactOverlayText('IDE', 'Corrigir login', undefined, true),
      'IDE · Corrigir login',
    );
  });

  test('does not repeat a sub-agent label that equals its activity', () => {
    assert.equal(compactOverlayText('Subtask: x', null, 'Subtask: x'), 'Subtask: x');
  });

  test('keeps the full text (CSS ellipsizes); untrusted titles are collapsed and capped', () => {
    const long = 'Refatorar o motor de rotinas dos agentes com assentos de trabalho e descanso';
    const t = cleanTaskTitle(long)!;
    assert.equal(t.length, 60);
    assert.ok(t.endsWith('…'));
    assert.equal(compactOverlayText('IDE', long, 'Idle'), `IDE · ${t}`);
    assert.equal(cleanTaskTitle('a\n\n  b\tc'), 'a b c');
  });
});

describe('seat-pick cursor', () => {
  const base = {
    hitId: null,
    petId: null,
    selectedAgentId: 1,
    tile: { col: 1, row: 1 },
    getSeatAtTile: () => 's1',
    getCharacter: () => ({ seatId: 'other' }),
  };

  test('free work seat → pointer', () => {
    assert.equal(
      computeNormalModeCursor({ ...base, getSeat: () => ({ assigned: false, isWork: true }) }),
      'pointer',
    );
  });

  test('free rest seat → default (reassignSeat refuses it)', () => {
    assert.equal(
      computeNormalModeCursor({ ...base, getSeat: () => ({ assigned: false, isWork: false }) }),
      'default',
    );
  });

  test('real OfficeState seats carry the work flag', () => {
    const os = office([]);
    assert.equal(os.seats.get('work-ide')!.isWork, true);
    const rest = [...os.seats.values()].find((s) => s.uid.startsWith('rest-'))!;
    assert.equal(rest.isWork, false);
  });
});
