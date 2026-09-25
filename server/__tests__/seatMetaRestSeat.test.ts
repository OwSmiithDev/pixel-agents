import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tmpBase: string;

// os.homedir() ignores HOME on Windows, so redirect it at the module seam.
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => tmpBase };
});

const { AgentStateStore } = await import('../src/agentStateStore.js');
const { handleClientMessage } = await import('../src/clientMessageHandler.js');
const { FileStateAdapter } = await import('../src/fileStateAdapter.js');

type Store = InstanceType<typeof AgentStateStore>;

function addAgent(store: Store, id: number): void {
  store.set(id, {
    id,
    sessionId: `s-${id}`,
    isExternal: true,
    projectDir: '/test',
    jsonlFile: `/test/${id}.jsonl`,
    fileOffset: 0,
    lineBuffer: '',
    activeToolIds: new Set(),
    activeToolStatuses: new Map(),
    activeToolNames: new Map(),
    activeSubagentToolIds: new Map(),
    activeSubagentToolNames: new Map(),
    backgroundAgentToolIds: new Set(),
    isWaiting: false,
    permissionSent: false,
    hadToolsInTurn: false,
    lastDataAt: 0,
    linesProcessed: 0,
    seenUnknownRecordTypes: new Set(),
    hookDelivered: false,
    contextTokens: 0,
    maxContextTokens: 0,
  } as never);
}

describe('seat meta: restSeatId next to seatId', () => {
  let store: Store;

  beforeEach(() => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-restseat-'));
    store = new AgentStateStore();
    store.setAdapter(new FileStateAdapter({ namespace: 'standalone' }));
  });
  afterEach(() => {
    store.dispose();
    fs.rmSync(tmpBase, { recursive: true, force: true });
  });

  it('persists restSeatId and forwards it in existingAgents (null when absent)', () => {
    addAgent(store, 1);
    addAgent(store, 2);
    handleClientMessage(
      {
        type: 'saveAgentSeats',
        seats: {
          '1': { palette: 1, hueShift: 0, seatId: 'desk-1', restSeatId: 'sofa-1' },
          // An older webview (or old state file) sends no restSeatId.
          '2': { palette: 2, hueShift: 0, seatId: 'desk-2' },
        },
      },
      () => {},
      { store, cache: null },
    );

    // Round-trips through the state file.
    const reloaded = new FileStateAdapter({ namespace: 'standalone' }).loadSeats();
    expect(reloaded['1']).toEqual({
      palette: 1,
      hueShift: 0,
      seatId: 'desk-1',
      restSeatId: 'sofa-1',
    });

    const sent: Array<Record<string, unknown>> = [];
    handleClientMessage({ type: 'webviewReady' }, (m) => sent.push(m), { store, cache: null });
    const existing = sent.find((m) => m.type === 'existingAgents') as {
      agentMeta: Record<number, { seatId?: string; restSeatId?: string | null }>;
    };
    expect(existing.agentMeta[1]).toMatchObject({ seatId: 'desk-1', restSeatId: 'sofa-1' });
    expect(existing.agentMeta[2]).toMatchObject({ seatId: 'desk-2', restSeatId: null });
  });
});
