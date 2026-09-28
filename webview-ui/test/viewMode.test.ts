import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  defaultOrbitCamera,
  readStoredOrbitCamera,
  readStoredOrbitProjection,
  readStoredViewMode,
  storeOrbitCamera,
  storeOrbitProjection,
  storeViewMode,
} from '../src/viewMode.js';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  } as Storage;
});
afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

describe('view mode storage', () => {
  it('round-trips orbit', () => {
    storeViewMode('orbit');
    expect(readStoredViewMode()).toBe('orbit');
  });
  it('falls back to 2d for unknown values', () => {
    store.set('pixel-agents.viewMode', 'vr');
    expect(readStoredViewMode()).toBe('2d');
  });
  it('defaults the projection to ortho and round-trips persp', () => {
    expect(readStoredOrbitProjection()).toBe('ortho');
    storeOrbitProjection('persp');
    expect(readStoredOrbitProjection()).toBe('persp');
  });
  it('returns the default camera when nothing or garbage is stored', () => {
    const def = readStoredOrbitCamera();
    expect(def.yaw).toBeCloseTo((35 * Math.PI) / 180);
    expect(def.polar).toBeCloseTo(((90 - 52) * Math.PI) / 180);
    store.set('pixel-agents.orbitCamera', '{bad json');
    expect(readStoredOrbitCamera()).toEqual(def);
    expect(defaultOrbitCamera()).toEqual(def);
  });
  it('round-trips the camera angles', () => {
    storeOrbitCamera({ yaw: 1.25, polar: 0.8 });
    expect(readStoredOrbitCamera()).toEqual({ yaw: 1.25, polar: 0.8 });
  });
  it('survives a throwing storage', () => {
    (globalThis as { localStorage?: Storage }).localStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    } as unknown as Storage;
    expect(readStoredViewMode()).toBe('2d');
    expect(() => storeOrbitCamera({ yaw: 0, polar: 1 })).not.toThrow();
  });
});
