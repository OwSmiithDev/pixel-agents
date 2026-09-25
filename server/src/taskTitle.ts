/**
 * Short per-agent task title shown over the character (`agentTask` message).
 *
 * Priority: tag line in the latest prompt > in-progress todo > first words of
 * the latest prompt. A new prompt resets the todo-derived title.
 *
 * Privacy: prompt text is untrusted and private. `deriveTitleFromPrompt` runs
 * at hook normalization and only its <= TASK_TITLE_MAX_LENGTH-char result is
 * kept; nothing here ever holds the prompt itself.
 */

import type { TodoSignal } from '../../core/src/provider.js';
import { TASK_TITLE_MAX_LENGTH, TASK_TITLE_MAX_WORDS } from './constants.js';

export type TaskTitleSource = 'tag' | 'todo' | 'prompt';

/** Payload of the `agentTask` message (minus type/id). */
export interface TaskTitle {
  title: string | null;
  source: TaskTitleSource;
}

export interface DerivedPromptTitle {
  title: string;
  source: 'tag' | 'prompt';
}

const TAG_LINE = /^[ \t]*(TASK|TAREFA|TÍTULO|TITULO|TITLE|OBJECTIVE)[ \t]*:[ \t]*(.+)$/imu;
/** Closed fences, plus an unterminated one running to the end. */
const CODE_FENCE = /```[\s\S]*?(?:```|$)/g;
/** C0/C1 controls, zero-width and bidi-override characters. */
const CONTROL_CHARS = /[\p{Cc}​-‏‪-‮⁦-⁩]/gu;

/** Untrusted text -> single-line, whitespace-collapsed, length-capped title, or
 *  null when nothing is left. Plain text only: no HTML is interpreted or escaped
 *  here (the webview renders it as text). */
export function sanitizeTitle(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  const clean = text.normalize('NFC').replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  const chars = [...clean]; // code points: never split a surrogate pair
  return chars.length > TASK_TITLE_MAX_LENGTH
    ? chars
        .slice(0, TASK_TITLE_MAX_LENGTH - 1)
        .join('')
        .trimEnd() + '…'
    : clean;
}

/** Title from a prompt: first tag line (outside code fences), else its first
 *  words. Null when the prompt holds nothing usable. */
export function deriveTitleFromPrompt(prompt: unknown): DerivedPromptTitle | null {
  if (typeof prompt !== 'string') return null;
  const text = prompt.normalize('NFC').replace(CODE_FENCE, ' ');
  const tag = sanitizeTitle(TAG_LINE.exec(text)?.[2]);
  if (tag) return { title: tag, source: 'tag' };
  const head = sanitizeTitle(
    text.replace(CONTROL_CHARS, ' ').trim().split(/\s+/).slice(0, TASK_TITLE_MAX_WORDS).join(' '),
  );
  return head ? { title: head, source: 'prompt' } : null;
}

/** Per-agent derivation state (AgentState.taskTitle). Transient, never persisted. */
export interface TaskTitleState {
  /** Tag or first-words title of the latest prompt. */
  fromPrompt: DerivedPromptTitle | null;
  /** Title of the in-progress todo, if any. */
  todo: string | null;
  /** TaskCreate subjects by task id. ponytail: ids are assumed sequential from
   *  "1" per session (the hook's PreToolUse never sees the created id); read the
   *  PostToolUse tool_response if that ever proves wrong. */
  taskSubjects: Map<string, string>;
  createdTasks: number;
  inProgressTaskId: string | null;
  /** Last value sent to clients (replayed to new clients). */
  sent: TaskTitle | null;
}

export function createTaskTitleState(): TaskTitleState {
  return {
    fromPrompt: null,
    todo: null,
    taskSubjects: new Map(),
    createdTasks: 0,
    inProgressTaskId: null,
    sent: null,
  };
}

/** A new prompt: replaces the prompt title and resets the todo title. */
export function applyPromptTitle(state: TaskTitleState, derived: DerivedPromptTitle | null): void {
  state.fromPrompt = derived;
  state.todo = null;
  state.inProgressTaskId = null;
}

export function applyTodoSignal(state: TaskTitleState, signal: TodoSignal): void {
  switch (signal.op) {
    case 'set':
      state.todo = sanitizeTitle(signal.title);
      state.inProgressTaskId = null;
      return;
    case 'create': {
      const id = String(++state.createdTasks);
      const subject = sanitizeTitle(signal.subject);
      if (subject) state.taskSubjects.set(id, subject);
      return;
    }
    case 'update': {
      const subject = sanitizeTitle(signal.subject);
      if (subject) state.taskSubjects.set(signal.taskId, subject);
      if (signal.status === 'in_progress') {
        state.todo = state.taskSubjects.get(signal.taskId) ?? state.todo;
        state.inProgressTaskId = signal.taskId;
      } else if (signal.status && signal.taskId === state.inProgressTaskId) {
        state.todo = null;
        state.inProgressTaskId = null;
      }
      return;
    }
  }
}

function resolve(state: TaskTitleState): TaskTitle | null {
  if (state.fromPrompt?.source === 'tag') return state.fromPrompt;
  if (state.todo) return { title: state.todo, source: 'todo' };
  return state.fromPrompt;
}

/** The title to send if it changed since the last send (and records it), else
 *  undefined. A cleared title is sent as null with the source it had. */
export function takeTaskTitleChange(state: TaskTitleState): TaskTitle | undefined {
  const current = resolve(state);
  const prev = state.sent;
  if (!current) {
    state.sent = null;
    return prev ? { title: null, source: prev.source } : undefined;
  }
  if (prev?.title === current.title && prev.source === current.source) return undefined;
  state.sent = { title: current.title, source: current.source };
  return state.sent;
}
