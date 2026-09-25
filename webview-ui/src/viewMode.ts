import { VIEW_MODE_STORAGE_KEY } from './constants.js';

export type ViewMode = '2d' | '3d';

export function readStoredViewMode(): ViewMode {
  try {
    return localStorage.getItem(VIEW_MODE_STORAGE_KEY) === '3d' ? '3d' : '2d';
  } catch {
    return '2d';
  }
}

export function storeViewMode(mode: ViewMode): void {
  try {
    localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
  } catch {
    // Storage blocked (private window, webview policy) — the choice just won't persist.
  }
}
