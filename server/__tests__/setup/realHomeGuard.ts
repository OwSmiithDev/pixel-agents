import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { afterAll, beforeAll, expect, vi } from 'vitest';

/**
 * Guard: no server test may touch the REAL user profile. Snapshots the user's
 * own Pixel Agents config/state and Claude settings before each test file and
 * fails that file if any of them changed. The real homedir comes from the
 * unmocked `os`, so per-file `vi.mock('os')` redirections don't hide it.
 */
const { homedir } = await vi.importActual<typeof import('os')>('os');
const REAL_HOME = homedir();
const WATCHED = [
  path.join(REAL_HOME, '.pixel-agents', 'config.json'),
  path.join(REAL_HOME, '.pixel-agents', 'standalone-state.json'),
  path.join(REAL_HOME, '.claude', 'settings.json'),
];

function fingerprint(file: string): string {
  try {
    return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  } catch {
    return 'absent';
  }
}

let before: string[] = [];

beforeAll(() => {
  before = WATCHED.map(fingerprint);
});

afterAll(() => {
  const changed = WATCHED.filter((file, i) => fingerprint(file) !== before[i]);
  expect(changed, 'a test modified files in the REAL home directory').toEqual([]);
});
