import { useFrame } from '@react-three/fiber';
import { useState } from 'react';

import {
  THREE_ACCENT_COLOR,
  THREE_MONITOR_LIGHT_DISTANCE,
  THREE_MONITOR_LIGHT_HEIGHT,
  THREE_MONITOR_LIGHT_INTENSITY,
  THREE_MONITOR_LIGHT_MAX,
} from '../../constants.js';
import type { OfficeState } from '../engine/officeState.js';

type Layout = ReturnType<OfficeState['getLayout']>;

/** Tile positions of monitors placed in their "on" state. */
function monitorSpots(layout: Layout): Array<[number, number]> {
  return layout.furniture
    .filter((f) => /^PC_.*_ON/.test(f.type))
    .slice(0, THREE_MONITOR_LIGHT_MAX)
    .map((f) => [f.col + 0.5, f.row + 1.5]);
}

/**
 * Soft accent light pools under always-on monitors (NOC).
 * ponytail: static per layout and capped; per-agent dynamic lights if wanted later.
 */
export function MonitorLights({ officeState }: { officeState: OfficeState }) {
  const [layout, setLayout] = useState(() => officeState.getLayout());
  useFrame(() => {
    const current = officeState.getLayout();
    if (current !== layout) setLayout(current);
  });
  return (
    <>
      {monitorSpots(layout).map(([x, z]) => (
        <pointLight
          key={`${x},${z}`}
          position={[x, THREE_MONITOR_LIGHT_HEIGHT, z]}
          color={THREE_ACCENT_COLOR}
          intensity={THREE_MONITOR_LIGHT_INTENSITY}
          distance={THREE_MONITOR_LIGHT_DISTANCE}
          decay={2}
        />
      ))}
    </>
  );
}
