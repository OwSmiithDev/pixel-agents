import { useEffect, useId, useRef, useState } from 'react';

import { OVERFLOW_POLL_MS } from '../constants.js';
import type { SubagentCharacter } from '../hooks/useExtensionMessages.js';
import { cleanTaskTitle, taskTitleText } from '../office/components/overlayText.js';
import type { OfficeState } from '../office/engine/officeState.js';

interface OverflowBadgeProps {
  officeState: OfficeState;
  agentTaskTitles: Record<number, string>;
  subagentCharacters: SubagentCharacter[];
}

/**
 * `+N fora do escritório` — agents waiting for a free work seat (no character
 * on the map). Opens a small list of who is waiting. Hidden at N = 0.
 */
export function OverflowBadge({
  officeState,
  agentTaskTitles,
  subagentCharacters,
}: OverflowBadgeProps) {
  const [ids, setIds] = useState<number[]>([]);
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  // Overflow changes inside the game loop (promotion), not via React state: poll.
  useEffect(() => {
    const read = () => {
      const next = officeState.getOverflowAgentIds();
      setIds((prev) =>
        prev.length === next.length && prev.every((v, i) => v === next[i]) ? prev : next,
      );
      if (next.length === 0) setOpen(false);
    };
    read();
    const t = setInterval(read, OVERFLOW_POLL_MS);
    return () => clearInterval(t);
  }, [officeState]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  if (ids.length === 0) return null;

  const labelOf = (id: number) =>
    officeState.getAgentLabel(id) ??
    subagentCharacters.find((s) => s.id === id)?.label ??
    'Subtask';

  return (
    // Above the bottom toolbar on narrow screens; bottom-center once there is room.
    <div
      ref={rootRef}
      className="absolute bottom-68 xl:bottom-10 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-4"
      data-testid="overflow-badge"
    >
      {open && (
        <ul
          id={panelId}
          className="pixel-panel m-0 py-4 px-0 list-none max-h-240 overflow-y-auto pixel-scrollbar w-260 max-w-[calc(100vw-32px)]"
          aria-label="Agentes fora do escritório"
        >
          {ids.map((id) => {
            const title = cleanTaskTitle(agentTaskTitles[id]);
            return (
              <li key={id} className="py-2 px-10 flex flex-col">
                <span className="text-xs leading-none">{labelOf(id)}</span>
                <span
                  className="text-2xs leading-none text-text-muted overflow-hidden text-ellipsis whitespace-nowrap"
                  title={title ?? undefined}
                >
                  {taskTitleText(title)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <button
        ref={buttonRef}
        type="button"
        className="pixel-panel cursor-pointer py-10 px-12 text-sm leading-none whitespace-nowrap hover:bg-btn-hover focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        +{ids.length} fora do escritório
      </button>
    </div>
  );
}
