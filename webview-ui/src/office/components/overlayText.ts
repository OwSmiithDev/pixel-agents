/** Pure text builders for the agent overlay (ToolOverlay, OverflowBadge). */

import { TASK_TITLE_MAX_CHARS } from '../../constants.js';

const NO_TASK_TEXT = 'Sem tarefa informada';

/** Untrusted task title → trimmed single line, capped, or null when empty. */
export function cleanTaskTitle(title: string | null | undefined): string | null {
  const t = (title ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  return t.length > TASK_TITLE_MAX_CHARS ? `${t.slice(0, TASK_TITLE_MAX_CHARS - 1)}…` : t;
}

/** Expanded overlay line 2. */
export function taskTitleText(title: string | null | undefined): string {
  return cleanTaskTitle(title) ?? NO_TASK_TEXT;
}

/**
 * Compact overlay line: `<label> · <short>`, short = task title, else activity.
 * Returned in full — the overlay ellipsizes it with CSS and puts it in `title`,
 * so the DOM text stays searchable.
 */
export function compactOverlayText(
  label: string | undefined,
  title: string | null | undefined,
  activity: string | undefined,
): string {
  const short = cleanTaskTitle(title) ?? activity?.trim() ?? '';
  const parts = [label, short].filter((p): p is string => !!p);
  if (parts.length === 2 && parts[0] === parts[1]) return parts[0];
  return parts.join(' · ');
}
