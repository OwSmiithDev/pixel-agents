/**
 * Pluggable persistence backend for agent state and user settings.
 *
 * Today both VS Code and the standalone CLI use FileStateAdapter, which
 * persists everything under ~/.pixel-agents/ as plain JSON. The interface
 * exists so future hosts (JetBrains plugin, browser-only mock for tests)
 * can swap in alternate backends without touching the rest of the code.
 *
 * Layout persistence (~/.pixel-agents/layout.json) is NOT part of this
 * interface -- it's already host-agnostic (plain fs I/O in layoutPersistence.ts).
 */

import type { PersistedAgent } from './schemas.js';

/** Persisted per-agent seat metadata. `restSeatId` (lounge seat) is newer:
 *  optional so older state files still load; null = no rest seat. */
export interface SeatMeta {
  palette?: number;
  hueShift?: number;
  seatId?: string | null;
  restSeatId?: string | null;
}

export interface StateAdapter {
  // ── Per-adapter persisted state (agents + seats) ────────────────────

  loadAgents(): PersistedAgent[];
  saveAgents(agents: PersistedAgent[]): void;

  loadSeats(): Record<string, SeatMeta>;
  saveSeats(seats: Record<string, SeatMeta>): void;

  // ── User-level settings (shared file, namespaced per adapter) ─────

  getSetting<T>(key: string, defaultValue: T): T;
  setSetting<T>(key: string, value: T): void;
}
