import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resendAgentActivity } from '../src/agentActivityResend.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { HookEventHandler } from '../src/hookEventHandler.js';
import { claudeProvider, todoSignalFromTool } from '../src/providers/hook/claude/claude.js';
import {
  CLAUDE_HOOK_EVENTS,
  CLAUDE_PROMPT_HOOK_EVENT,
} from '../src/providers/hook/claude/constants.js';
import { SessionRouter } from '../src/sessionRouter.js';
import { deriveTitleFromPrompt, sanitizeTitle } from '../src/taskTitle.js';
import type { AgentState } from '../src/types.js';

// ── Pure derivation ───────────────────────────────────────────

describe('deriveTitleFromPrompt', () => {
  it('a tag line wins over the first words', () => {
    expect(deriveTitleFromPrompt('Please look at this\nTASK: Refactor login flow\nthanks')).toEqual(
      { title: 'Refactor login flow', source: 'tag' },
    );
  });

  it('takes the FIRST tag line, case-insensitive', () => {
    expect(deriveTitleFromPrompt('objective: first one\nTITLE: second')).toEqual({
      title: 'first one',
      source: 'tag',
    });
  });

  it.each([
    ['TAREFA: Corrigir o bug', 'Corrigir o bug'],
    ['Tarefa: corrigir', 'corrigir'],
    ['TÍTULO: Revisar PR', 'Revisar PR'],
    ['título: revisar', 'revisar'],
    ['TITULO: sem acento', 'sem acento'],
    // Decomposed accent (I + combining acute) still matches after NFC.
    ['TÍTULO: decomposto', 'decomposto'],
    ['  Title :  spaced  ', 'spaced'],
  ])('recognizes tag %j', (prompt, title) => {
    expect(deriveTitleFromPrompt(prompt)).toEqual({ title, source: 'tag' });
  });

  it('falls back to the first 8 words', () => {
    expect(deriveTitleFromPrompt('one two three four five six seven eight nine ten')).toEqual({
      title: 'one two three four five six seven eight',
      source: 'prompt',
    });
  });

  it('caps the title at 60 chars', () => {
    const long = 'Supercalifragilistic '.repeat(8);
    const result = deriveTitleFromPrompt(long);
    expect(result?.source).toBe('prompt');
    expect([...result!.title].length).toBeLessThanOrEqual(60);
    expect(result!.title.endsWith('…')).toBe(true);
  });

  it('caps a tag title at 60 chars too', () => {
    const result = deriveTitleFromPrompt(`TASK: ${'x'.repeat(200)}`);
    expect([...result!.title].length).toBe(60);
  });

  it('strips code fences (closed and unterminated)', () => {
    expect(deriveTitleFromPrompt('```js\nconst x = 1;\n```\nFix the parser')).toEqual({
      title: 'Fix the parser',
      source: 'prompt',
    });
    expect(deriveTitleFromPrompt('Fix this\n```\nsecret stack trace')).toEqual({
      title: 'Fix this',
      source: 'prompt',
    });
  });

  it('ignores a tag that only appears inside a code fence', () => {
    expect(deriveTitleFromPrompt('```\nTASK: nope\n```\nreal words')).toEqual({
      title: 'real words',
      source: 'prompt',
    });
  });

  it.each([[''], ['   \n\t  '], ['```\ncode only\n```'], [undefined], [42], [null]])(
    'returns null for %j',
    (prompt) => {
      expect(deriveTitleFromPrompt(prompt)).toBeNull();
    },
  );

  it('removes control chars and collapses whitespace', () => {
    expect(deriveTitleFromPrompt('Fix\u0007 the\u0000bug\u202E\n\n\t now')).toEqual({
      title: 'Fix the bug now',
      source: 'prompt',
    });
  });

  it('removes every format char: BOM, word joiner, soft hyphen, Arabic/Mongolian marks, tags, bidi isolates', () => {
    expect(
      sanitizeTitle('a\uFEFFb\u2060c\u2064d\u00ADe\u061Cf\u180Eg\u{E0041}h\u2066i\u2069j\u200Bk'),
    ).toBe('a b c d e f g h i j k');
  });

  it('does not interpret HTML (text passes through as text)', () => {
    expect(sanitizeTitle('<b>bold</b>')).toBe('<b>bold</b>');
  });
});

// ── Todo extraction (provider) ────────────────────────────────

describe('todoSignalFromTool', () => {
  it('TodoWrite: in_progress item activeForm, falling back to content', () => {
    expect(
      todoSignalFromTool('TodoWrite', {
        todos: [
          { content: 'Done thing', status: 'completed', activeForm: 'Doing done thing' },
          { content: 'Write tests', status: 'in_progress', activeForm: 'Writing tests' },
        ],
      }),
    ).toEqual({ op: 'set', title: 'Writing tests' });
    expect(
      todoSignalFromTool('TodoWrite', {
        todos: [{ content: 'Write docs', status: 'in_progress' }],
      }),
    ).toEqual({ op: 'set', title: 'Write docs' });
  });

  it('TodoWrite with nothing in progress clears the todo title', () => {
    expect(
      todoSignalFromTool('TodoWrite', { todos: [{ content: 'a', status: 'completed' }] }),
    ).toEqual({ op: 'set', title: null });
  });

  it('TaskCreate / TaskUpdate signals', () => {
    expect(todoSignalFromTool('TaskCreate', { subject: 'Build it', description: 'd' })).toEqual({
      op: 'create',
      subject: 'Build it',
    });
    expect(todoSignalFromTool('TaskUpdate', { taskId: '2', status: 'in_progress' })).toEqual({
      op: 'update',
      taskId: '2',
      status: 'in_progress',
      subject: undefined,
    });
    // A numeric id (as the tool may send it) is kept, as its string form.
    expect(todoSignalFromTool('TaskUpdate', { taskId: 2, status: 'completed' })).toEqual({
      op: 'update',
      taskId: '2',
      status: 'completed',
      subject: undefined,
    });
  });

  it('other tools produce no signal', () => {
    expect(todoSignalFromTool('Read', { file_path: '/x' })).toBeUndefined();
  });
});

describe('CLAUDE_HOOK_EVENTS', () => {
  it('UserPromptSubmit is optional (consent + setting gated), TaskCreated never installed', () => {
    expect(CLAUDE_HOOK_EVENTS).not.toContain('UserPromptSubmit');
    expect(CLAUDE_PROMPT_HOOK_EVENT).toBe('UserPromptSubmit');
    expect(CLAUDE_HOOK_EVENTS).not.toContain('TaskCreated');
  });
});

// ── Runtime behavior (HookEventHandler) ───────────────────────

function createTestAgent(overrides: Partial<AgentState> = {}): AgentState {
  return {
    id: 1,
    sessionId: '',
    terminalRef: undefined,
    isExternal: true,
    projectDir: '/test',
    jsonlFile: '/test/session.jsonl',
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
    ...overrides,
  } as AgentState;
}

/** True if `needle` occurs in any string reachable from `root` (objects, arrays, Maps, Sets). */
function deepContains(root: unknown, needle: string, seen = new Set<unknown>()): boolean {
  if (typeof root === 'string') return root.includes(needle);
  if (root === null || typeof root !== 'object' || seen.has(root)) return false;
  seen.add(root);
  if (root instanceof Map) {
    for (const [k, v] of root)
      if (deepContains(k, needle, seen) || deepContains(v, needle, seen)) return true;
    return false;
  }
  if (root instanceof Set) {
    for (const v of root) if (deepContains(v, needle, seen)) return true;
    return false;
  }
  for (const v of Object.values(root)) if (deepContains(v, needle, seen)) return true;
  return false;
}

describe('agentTask via HookEventHandler', () => {
  let agents: AgentStateStore;
  let router: SessionRouter;
  let messages: Array<Record<string, unknown>>;
  let fromPrompt: { current: boolean };
  let handler: HookEventHandler;

  const prompt = (text: string) =>
    handler.handleEvent('claude', {
      hook_event_name: 'UserPromptSubmit',
      session_id: 'sess-1',
      prompt: text,
    });
  const tool = (tool_name: string, tool_input: Record<string, unknown>) =>
    handler.handleEvent('claude', {
      hook_event_name: 'PreToolUse',
      session_id: 'sess-1',
      tool_name,
      tool_input,
    });
  const tasks = () => messages.filter((m) => m.type === 'agentTask');

  beforeEach(() => {
    agents = new AgentStateStore();
    router = new SessionRouter();
    messages = [];
    fromPrompt = { current: true };
    agents.on('broadcast', (msg) => messages.push(msg));
    handler = new HookEventHandler(
      agents,
      new Map(),
      new Map(),
      claudeProvider,
      router,
      undefined,
      fromPrompt,
    );
    agents.set(1, createTestAgent({ id: 1, sessionId: 'sess-1' }));
    handler.registerAgent('sess-1', 1);
  });

  it('prompt -> todo -> new prompt resets todo', () => {
    prompt('Fix the flaky login test');
    tool('TodoWrite', { todos: [{ content: 'Write tests', status: 'in_progress' }] });
    prompt('Now update the docs');
    expect(tasks()).toEqual([
      { type: 'agentTask', id: 1, title: 'Fix the flaky login test', source: 'prompt' },
      { type: 'agentTask', id: 1, title: 'Write tests', source: 'todo' },
      { type: 'agentTask', id: 1, title: 'Now update the docs', source: 'prompt' },
    ]);
  });

  it('a tag outranks an in-progress todo', () => {
    prompt('TAREFA: Migrar banco');
    tool('TodoWrite', { todos: [{ content: 'Step 1', status: 'in_progress' }] });
    expect(tasks()).toEqual([{ type: 'agentTask', id: 1, title: 'Migrar banco', source: 'tag' }]);
  });

  it('TaskUpdate in_progress uses the subject of the earlier TaskCreate; completion clears', () => {
    tool('TaskCreate', { subject: 'First task', description: 'x' });
    tool('TaskCreate', { subject: 'Second task', description: 'y' });
    tool('TaskUpdate', { taskId: '2', status: 'in_progress' });
    tool('TaskUpdate', { taskId: '2', status: 'completed' });
    expect(tasks()).toEqual([
      { type: 'agentTask', id: 1, title: 'Second task', source: 'todo' },
      { type: 'agentTask', id: 1, title: null, source: 'todo' },
    ]);
  });

  it('/clear drops the old title and restarts task-id tracking for the new session', () => {
    tool('TaskCreate', { subject: 'Old first', description: 'x' });
    tool('TaskUpdate', { taskId: '1', status: 'in_progress' });
    handler.handleEvent('claude', {
      hook_event_name: 'SessionEnd',
      session_id: 'sess-1',
      reason: 'clear',
    });
    handler.handleEvent('claude', {
      hook_event_name: 'SessionStart',
      session_id: 'sess-2',
      source: 'clear',
      transcript_path: '/test/sess-2.jsonl',
    });
    expect(tasks().at(-1)).toEqual({ type: 'agentTask', id: 1, title: null, source: 'todo' });

    handler.handleEvent('claude', {
      hook_event_name: 'PreToolUse',
      session_id: 'sess-2',
      tool_name: 'TaskCreate',
      tool_input: { subject: 'New first', description: 'y' },
    });
    handler.handleEvent('claude', {
      hook_event_name: 'PreToolUse',
      session_id: 'sess-2',
      tool_name: 'TaskUpdate',
      tool_input: { taskId: '1', status: 'in_progress' },
    });
    expect(tasks().at(-1)).toEqual({
      type: 'agentTask',
      id: 1,
      title: 'New first',
      source: 'todo',
    });
  });

  it('a lead with inline teammates still gets todo titles (tool display stays suppressed)', () => {
    agents.set(2, createTestAgent({ id: 2, sessionId: 'sess-1', leadAgentId: 1 }));
    tool('TodoWrite', { todos: [{ content: 'Coordinate team', status: 'in_progress' }] });
    expect(tasks()).toEqual([
      { type: 'agentTask', id: 1, title: 'Coordinate team', source: 'todo' },
    ]);
    expect(messages.some((m) => m.type === 'agentToolStart' && m.id === 1)).toBe(false);
  });

  it('sends only on change', () => {
    prompt('same words here');
    prompt('same words here');
    tool('Read', { file_path: '/x' });
    expect(tasks()).toHaveLength(1);
  });

  it('taskTitleFromPrompt=false disables tag and prompt sources, todo still works', () => {
    fromPrompt.current = false;
    prompt('TASK: hidden');
    prompt('also hidden');
    expect(tasks()).toHaveLength(0);
    tool('TodoWrite', { todos: [{ content: 'Visible todo', status: 'in_progress' }] });
    expect(tasks()).toEqual([{ type: 'agentTask', id: 1, title: 'Visible todo', source: 'todo' }]);
  });

  it('clearPromptTitles drops prompt/tag titles (todo stays) and nothing cleared is replayed', () => {
    agents.set(2, createTestAgent({ id: 2, sessionId: 'sess-2' }));
    handler.registerAgent('sess-2', 2);
    prompt('TASK: Secretive tag');
    handler.handleEvent('claude', {
      hook_event_name: 'UserPromptSubmit',
      session_id: 'sess-2',
      prompt: 'plain words here',
    });
    handler.handleEvent('claude', {
      hook_event_name: 'PreToolUse',
      session_id: 'sess-2',
      tool_name: 'TodoWrite',
      tool_input: { todos: [{ content: 'Todo stays', status: 'in_progress' }] },
    });
    messages.length = 0;

    handler.clearPromptTitles();
    expect(tasks()).toEqual([{ type: 'agentTask', id: 1, title: null, source: 'tag' }]);

    const sent: Array<Record<string, unknown>> = [];
    resendAgentActivity((m) => sent.push(m), agents);
    expect(sent.filter((m) => m.type === 'agentTask')).toEqual([
      { type: 'agentTask', id: 2, title: 'Todo stays', source: 'todo' },
    ]);

    // A prompt-only title is cleared too.
    messages.length = 0;
    tool('TodoWrite', { todos: [] });
    fromPrompt.current = true;
    prompt('only a prompt');
    handler.clearPromptTitles();
    expect(tasks().at(-1)).toEqual({ type: 'agentTask', id: 1, title: null, source: 'prompt' });
  });

  it('a newly connected client gets the current title replayed', () => {
    prompt('TASK: Replay me');
    const sent: Array<Record<string, unknown>> = [];
    resendAgentActivity((m) => sent.push(m), agents);
    expect(sent).toContainEqual({ type: 'agentTask', id: 1, title: 'Replay me', source: 'tag' });
  });

  it('never retains the raw prompt: state, messages, logs, raw event, buffered events', () => {
    const SECRET = 'SUPERSECRET-api-key-123';
    const text = `Fix the login bug in auth module please now ${SECRET}\nmore ${SECRET}`;
    const logSpy = vi.spyOn(console, 'log');
    const warnSpy = vi.spyOn(console, 'warn');

    // Registered agent.
    const raw: Record<string, unknown> = {
      hook_event_name: 'UserPromptSubmit',
      session_id: 'sess-1',
      prompt: text,
    };
    handler.handleEvent('claude', raw as never);

    // Unknown session while an agent is still unregistered: the router buffers
    // the raw event until registerAgent flushes it.
    agents.set(2, createTestAgent({ id: 2, sessionId: 'sess-not-yet' }));
    handler.handleEvent('claude', {
      hook_event_name: 'UserPromptSubmit',
      session_id: 'sess-2',
      prompt: text,
    });
    expect(deepContains(router, SECRET)).toBe(false);
    handler.registerAgent('sess-2', 2);

    expect(tasks()).toEqual([
      {
        type: 'agentTask',
        id: 1,
        title: 'Fix the login bug in auth module please',
        source: 'prompt',
      },
      {
        type: 'agentTask',
        id: 2,
        title: 'Fix the login bug in auth module please',
        source: 'prompt',
      },
    ]);
    expect(deepContains(raw, SECRET)).toBe(false);
    expect(deepContains([...agents.values()], SECRET)).toBe(false);
    expect(deepContains(messages, SECRET)).toBe(false);
    expect(deepContains(router, SECRET)).toBe(false);
    expect(deepContains([...logSpy.mock.calls, ...warnSpy.mock.calls], SECRET)).toBe(false);
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
