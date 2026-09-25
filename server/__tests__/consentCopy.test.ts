import { describe, expect, it } from 'vitest';

import {
  CONSENT_DISCLOSURE,
  CONSENT_EVENT_COUNT,
  CONSENT_INSTALL_HEADLINE,
  RECONSENT_DISCLOSURE,
  RECONSENT_HEADLINE,
} from '../src/providers/hook/claude/consentCopy.js';
import {
  CLAUDE_HOOK_EVENTS,
  SETTINGS_BACKUP_SUFFIX,
} from '../src/providers/hook/claude/constants.js';

it('counts the base events plus the prompt hook', () => {
  expect(CONSENT_EVENT_COUNT).toBe(CLAUDE_HOOK_EVENTS.length + 1);
});

/**
 * The consent copy is two pieces: the HEADLINE is the greeter's welcome line
 * and the DISCLOSURE is the speech-bubble body. Both surfaces render the same
 * `hooksConsentRequest` payload through the webview's IntroBubble.
 *
 * These tests pin the CONTENT contract — every disclosure fact is present, and
 * it lives in the shared constants rather than in either surface's own copy.
 */
describe('consent copy', () => {
  // The five facts the 1-star review said were missing: WHICH file is written,
  // that existing settings survive (+ where the backup goes), what data moves
  // and where it stops, and how to undo it. The event count is read from the
  // real list — a hardcoded number becomes a lie the next time it changes.
  it('carries all five disclosure facts', () => {
    const full = `${CONSENT_INSTALL_HEADLINE}\n\n${CONSENT_DISCLOSURE}`;
    expect(full).toContain('~/.claude/settings.json');
    expect(full).toContain(`${CONSENT_EVENT_COUNT.toString()} Claude Code events`);
    expect(full).toContain('your existing settings are kept');
    expect(full).toContain(`settings.json${SETTINGS_BACKUP_SUFFIX}`);
    expect(full).toContain('tool names, tool inputs and your prompts');
    expect(full).toContain('127.0.0.1');
    expect(full).toContain('Settings → Instant Detection (Hooks)');
  });

  // Every fact must be in the DISCLOSURE block, not the headline: the headline
  // is a title slot (the greeter's welcome), while the disclosure is what both
  // surfaces render as the body. A fact that drifted up into the headline
  // would still pass the assertion above while silently depending on how a
  // surface renders its title.
  it('keeps every disclosure fact in the shared block, not the headline', () => {
    expect(CONSENT_DISCLOSURE).toContain('~/.claude/settings.json');
    expect(CONSENT_DISCLOSURE).toContain(`${CONSENT_EVENT_COUNT.toString()} Claude Code events`);
    expect(CONSENT_DISCLOSURE).toContain(`settings.json${SETTINGS_BACKUP_SUFFIX}`);
    expect(CONSENT_DISCLOSURE).toContain('tool names, tool inputs and your prompts');
    expect(CONSENT_DISCLOSURE).toContain('127.0.0.1');
    expect(CONSENT_DISCLOSURE).toContain('Settings → Instant Detection (Hooks)');
  });

  // The ask is about a FIRST install and nothing else. A user who already has
  // our hooks is migrated silently, so any "already installed" wording here
  // would be copy for a surface that no longer exists. The disclosure asks in
  // install terms ("adds hooks"), and the headline is a pure welcome.
  it('asks about a first install, the only case that prompts', () => {
    expect(CONSENT_DISCLOSURE).toContain('adds hooks');
    expect(CONSENT_INSTALL_HEADLINE).not.toContain('already installed');
    expect(CONSENT_DISCLOSURE).not.toContain('already installed');
  });

  // The disclosure keeps its paragraph breaks: the bubble splits on the blank
  // lines and renders one <p> per fact. Collapsing it to one run of prose
  // would be a silent legibility regression.
  it('is a paragraph-separated block', () => {
    expect(CONSENT_DISCLOSURE.split('\n\n')).toHaveLength(3);
  });
});

describe('re-consent copy (prompt hook only)', () => {
  it('names the prompt hook and exactly what is sent, kept and shown', () => {
    expect(RECONSENT_DISCLOSURE).toContain('UserPromptSubmit');
    expect(RECONSENT_DISCLOSURE).toContain('every prompt you submit');
    expect(RECONSENT_DISCLOSURE).toContain('127.0.0.1');
    expect(RECONSENT_DISCLOSURE).toContain('at most 60 characters');
    expect(RECONSENT_DISCLOSURE).toContain('never stores, logs or forwards the prompt');
  });

  it('says existing hooks stay and what each re-ask button does', () => {
    expect(RECONSENT_DISCLOSURE).toContain('existing hooks stay exactly as they are');
    expect(RECONSENT_DISCLOSURE).toContain('"Keep Titles Off"');
    expect(RECONSENT_DISCLOSURE).toContain('"Not Now"');
    expect(RECONSENT_DISCLOSURE).toContain('Settings → Instant Detection (Hooks)');
  });

  it('never reuses the first-run install wording', () => {
    expect(RECONSENT_HEADLINE).not.toBe(CONSENT_INSTALL_HEADLINE);
    expect(RECONSENT_DISCLOSURE).not.toMatch(/adds hooks for \d+/);
    expect(RECONSENT_DISCLOSURE.split('\n\n')).toHaveLength(3);
  });
});
