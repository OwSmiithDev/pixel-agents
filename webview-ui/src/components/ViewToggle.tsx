import type { ViewMode } from '../viewMode.js';
import { Button } from './ui/Button.js';

interface ViewToggleProps {
  mode: ViewMode;
  onChange: (mode: ViewMode) => void;
  /** Why 3D is currently unavailable (editor / intro); disables the 3D option. */
  lockedReason: string | null;
}

export function ViewToggle({ mode, onChange, lockedReason }: ViewToggleProps) {
  const options: Array<{ value: ViewMode; label: string }> = [
    { value: '2d', label: '2D' },
    { value: '3d', label: '3D' },
  ];
  return (
    <div
      role="group"
      aria-label="Office view"
      className="absolute top-8 right-8 z-10 flex gap-4"
      data-testid="view-toggle"
    >
      {options.map((o) => {
        const active = mode === o.value;
        const disabled = o.value === '3d' && lockedReason !== null;
        return (
          <Button
            key={o.value}
            size="icon_lg"
            aria-pressed={active}
            disabled={disabled}
            title={disabled ? lockedReason! : `${o.label} view`}
            onClick={() => onChange(o.value)}
            className={`border-border! shadow-pixel disabled:cursor-default disabled:opacity-(--btn-disabled-opacity) ${
              active ? 'bg-accent-bright! border-accent! text-white' : ''
            }`}
          >
            {o.label}
          </Button>
        );
      })}
    </div>
  );
}
