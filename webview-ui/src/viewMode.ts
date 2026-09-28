import {
  ORBIT_CAMERA_STORAGE_KEY,
  ORBIT_DEFAULT_PITCH_DEG,
  ORBIT_DEFAULT_YAW_DEG,
  ORBIT_PROJECTION_STORAGE_KEY,
  VIEW_MODE_STORAGE_KEY,
} from './constants.js';

export type ViewMode = '2d' | '3d' | 'orbit';
export type OrbitProjection = 'ortho' | 'persp';
/** Radians: yaw = azimuth (0 = camera on +z), polar = angle from straight up. */
export interface OrbitCamera {
  yaw: number;
  polar: number;
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage blocked (private window, webview policy) — the choice just won't persist.
  }
}

export function readStoredViewMode(): ViewMode {
  const v = read(VIEW_MODE_STORAGE_KEY);
  return v === '3d' || v === 'orbit' ? v : '2d';
}

export function storeViewMode(mode: ViewMode): void {
  write(VIEW_MODE_STORAGE_KEY, mode);
}

export function readStoredOrbitProjection(): OrbitProjection {
  return read(ORBIT_PROJECTION_STORAGE_KEY) === 'persp' ? 'persp' : 'ortho';
}

export function storeOrbitProjection(p: OrbitProjection): void {
  write(ORBIT_PROJECTION_STORAGE_KEY, p);
}

export function defaultOrbitCamera(): OrbitCamera {
  return {
    yaw: (ORBIT_DEFAULT_YAW_DEG * Math.PI) / 180,
    polar: ((90 - ORBIT_DEFAULT_PITCH_DEG) * Math.PI) / 180,
  };
}

export function readStoredOrbitCamera(): OrbitCamera {
  const raw = read(ORBIT_CAMERA_STORAGE_KEY);
  if (!raw) return defaultOrbitCamera();
  try {
    const v = JSON.parse(raw) as Partial<OrbitCamera>;
    if (Number.isFinite(v.yaw) && Number.isFinite(v.polar)) {
      return { yaw: v.yaw as number, polar: v.polar as number };
    }
  } catch {
    // fall through to the default
  }
  return defaultOrbitCamera();
}

export function storeOrbitCamera(c: OrbitCamera): void {
  write(ORBIT_CAMERA_STORAGE_KEY, JSON.stringify({ yaw: c.yaw, polar: c.polar }));
}
