/**
 * The consent step's button labels. A re-ask (hooksConsentRequest.reconsent)
 * concerns only the prompt hook and leaves installed hooks alone, so its
 * labels must never read as the first-run "install / no hooks" choice.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { test } from 'vitest';

import { consentStepLabels } from '../src/components/introConsentLabels.js';

test('first-run ask keeps the install labels', () => {
  const l = consentStepLabels(false);
  assert.equal(l.install, 'Install Hooks');
  assert.equal(l.never, "Don't Ask Again");
  assert.equal(l.notNow, 'Not Now');
});

test('re-ask labels name the task-title scope, not hooks', () => {
  const l = consentStepLabels(true);
  assert.equal(l.install, 'Enable Task Titles');
  assert.equal(l.never, 'Keep Titles Off');
  assert.equal(l.notNow, 'Not Now');
  for (const label of [l.install, l.never, l.installPending, l.failedTitle]) {
    assert.doesNotMatch(label, /hook/i);
  }
});
