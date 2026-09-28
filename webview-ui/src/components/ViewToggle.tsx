import type { OrbitProjection, ViewMode } from '../viewMode.js';
import { Button } from './ui/Button.js';

interface ViewToggleProps {
  mode: ViewMode;
  onChange: (mode: ViewMode) => void;
  projection: OrbitProjection;
  onProjectionChange: (projection: OrbitProjection) => void;
  /** Why 3D/orbit is currently unavailable (editor / intro); disables both. */
  lockedReason: string | null;
}

const MODES: Array<{ value: ViewMode; label: string; title: string }> = [
  { value: '2d', label: '2D', title: '2D view' },
  { value: '3d', label: '3D', title: '3D view' },
  { value: 'orbit', label: 'Órbita', title: 'Orbit view: drag to rotate, Q/E turn, R reset' },
];
const PROJECTIONS: Array<{ value: OrbitProjection; label: string; title: string }> = [
  { value: 'ortho', label: 'Miniatura', title: 'Miniature camera (orthographic)' },
  { value: 'persp', label: 'Jogo', title: 'Game camera (perspective)' },
];

export function ViewToggle({
  mode,
  onChange,
  projection,
  onProjectionChange,
  lockedReason,
}: ViewToggleProps) {
  const btn = (active: boolean) =>
    `border-border! shadow-pixel disabled:cursor-default disabled:opacity-(--btn-disabled-opacity) px-8! w-auto! ${
      active ? 'bg-accent-bright! border-accent! text-white' : ''
    }`;
  return (
    <div className="absolute top-8 right-8 z-10 flex flex-col items-end gap-4">
      <div role="group" aria-label="Office view" className="flex gap-4" data-testid="view-toggle">
        {MODES.map((o) => {
          const disabled = o.value !== '2d' && lockedReason !== null;
          return (
            <Button
              key={o.value}
              size="icon_lg"
              aria-pressed={mode === o.value}
              disabled={disabled}
              title={disabled ? lockedReason! : o.title}
              onClick={() => onChange(o.value)}
              className={btn(mode === o.value)}
            >
              {o.label}
            </Button>
          );
        })}
      </div>
      {mode === 'orbit' && (
        <div
          role="group"
          aria-label="Orbit camera"
          className="flex gap-4"
          data-testid="orbit-projection"
        >
          {PROJECTIONS.map((p) => (
            <Button
              key={p.value}
              size="sm"
              aria-pressed={projection === p.value}
              title={p.title}
              onClick={() => onProjectionChange(p.value)}
              className={btn(projection === p.value)}
            >
              {p.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
