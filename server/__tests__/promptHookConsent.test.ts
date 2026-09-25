import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tmpBase: string;

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => tmpBase };
});

const { AgentRuntime } = await import('../src/agentRuntime.js');
const { AgentStateStore } = await import('../src/agentStateStore.js');
const config = await import('../src/configPersistence.js');
const { claudeProvider } = await import('../src/providers/hook/claude/claude.js');
const { consentActionFor, hooksConsentRequest } =
  await import('../src/providers/hook/consentGate.js');
const { applyConsentChoice } = await import('../src/providers/hook/consentExecutor.js');
const { LEGACY_HOOKS_CONSENT_VERSION } = await import('../src/constants.js');

/** Events holding one of OUR hook commands in ~/.claude/settings.json. */
function ourEvents(): string[] {
  const file = path.join(tmpBase, '.claude', 'settings.json');
  if (!fs.existsSync(file)) return [];
  const hooks = (JSON.parse(fs.readFileSync(file, 'utf-8')).hooks ?? {}) as Record<
    string,
    Array<{ hooks: Array<{ command: string }> }>
  >;
  return Object.entries(hooks)
    .filter(([, entries]) =>
      entries.some((e) => e.hooks.some((h) => h.command.includes('claude-hook.js'))),
    )
    .map(([event]) => event);
}

/** A consent recorded before versioning existed (no hooksConsentVersion). */
function seedLegacyConsent(): void {
  const cfg = config.readConfig();
  cfg.hooksConsent.claude = 'granted';
  delete cfg.hooksConsentVersion;
  config.writeConfig(cfg);
}

describe('prompt hook (UserPromptSubmit) consent + taskTitleFromPrompt', () => {
  beforeEach(() => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-prompt-hook-'));
    fs.mkdirSync(path.join(tmpBase, '.claude'), { recursive: true });
  });
  afterEach(() => {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  });

  it('old-version consent does not install it and triggers re-consent', async () => {
    seedLegacyConsent();
    await claudeProvider.installHooks('', '');
    expect(ourEvents()).not.toContain('UserPromptSubmit');
    expect(ourEvents()).toContain('Stop');

    expect(config.isHooksConsentCurrent('claude')).toBe(false);
    expect(config.needsHooksReconsent('claude')).toBe(true);
    const request = hooksConsentRequest(
      {
        installed: true,
        hooksEnabled: true,
        consentAnswered: true,
        privileged: true,
        reconsent: config.needsHooksReconsent('claude'),
      },
      claudeProvider,
    );
    expect(request?.type).toBe('hooksConsentRequest');
  });

  it('a silent (legacy-version) grant does not authorize it either', async () => {
    config.grantHooksConsent('claude', LEGACY_HOOKS_CONSENT_VERSION);
    await claudeProvider.installHooks('', '');
    expect(ourEvents()).not.toContain('UserPromptSubmit');
    expect(config.needsHooksReconsent('claude')).toBe(true);
  });

  it('re-consent answers only touch the added scope', () => {
    const state = { installed: true, consent: 'granted' as const, outdated: true };
    expect(consentActionFor('install', state)).toBe('install');
    expect(consentActionFor('never', state)).toBe('declinePrompt');
    expect(consentActionFor('notNow', state)).toBe('none');
  });

  it('no re-consent once the setting is off', () => {
    seedLegacyConsent();
    config.persistTaskTitleFromPrompt(false);
    expect(config.needsHooksReconsent('claude')).toBe(false);
  });

  it('current consent + setting on -> installed; an upgrade grant adds it', async () => {
    seedLegacyConsent();
    config.grantHooksConsent('claude'); // Install on the re-consent ask
    expect(config.isHooksConsentCurrent('claude')).toBe(true);
    expect(config.needsHooksReconsent('claude')).toBe(false);
    await claudeProvider.installHooks('', '');
    expect(ourEvents()).toContain('UserPromptSubmit');
  });

  it('setting off -> not installed; toggling off removes it, on re-adds it', async () => {
    config.grantHooksConsent('claude');
    config.persistTaskTitleFromPrompt(false);
    await claudeProvider.installHooks('', '');
    expect(ourEvents()).not.toContain('UserPromptSubmit');

    const runtime = new AgentRuntime(new AgentStateStore(), claudeProvider);
    try {
      await runtime.setTaskTitleFromPrompt(true);
      expect(runtime.taskTitleFromPrompt.current).toBe(true);
      expect(ourEvents()).toContain('UserPromptSubmit');

      await runtime.setTaskTitleFromPrompt(false);
      expect(config.getTaskTitleFromPrompt()).toBe(false);
      expect(runtime.taskTitleFromPrompt.current).toBe(false);
      expect(ourEvents()).not.toContain('UserPromptSubmit');
      expect(ourEvents()).toContain('Stop'); // other events unaffected
    } finally {
      runtime.dispose();
    }
  });

  it('turning the setting on never installs hooks that are not installed', async () => {
    config.grantHooksConsent('claude');
    const runtime = new AgentRuntime(new AgentStateStore(), claudeProvider);
    try {
      await runtime.setTaskTitleFromPrompt(true);
      expect(ourEvents()).toEqual([]);
    } finally {
      runtime.dispose();
    }
  });

  /** The Settings toggle as both surfaces run it (cli.ts / PixelAgentsViewProvider.setHooksEnabled). */
  async function toggleHooks(enabled: boolean): Promise<void> {
    if (enabled) {
      config.grantHooksConsentKeepingVersion('claude');
      await claudeProvider.installHooks('', '');
    } else {
      await claudeProvider.uninstallHooks();
    }
  }

  it('a Settings toggle off/on keeps a v1 grant at v1: no prompt hook, re-ask still pending', async () => {
    config.grantHooksConsent('claude', LEGACY_HOOKS_CONSENT_VERSION);
    await claudeProvider.installHooks('', '');
    await toggleHooks(false);
    await toggleHooks(true);
    expect(ourEvents()).toContain('Stop');
    expect(ourEvents()).not.toContain('UserPromptSubmit');
    expect(config.isHooksConsentCurrent('claude')).toBe(false);
    expect(config.needsHooksReconsent('claude')).toBe(true);
  });

  it('a Settings toggle with no grant yet grants the current version', () => {
    config.grantHooksConsentKeepingVersion('claude');
    expect(config.isHooksConsentCurrent('claude')).toBe(true);
  });

  it('Install on the re-consent ask (the executor) upgrades the grant and adds the prompt hook', async () => {
    config.grantHooksConsent('claude', LEGACY_HOOKS_CONSENT_VERSION);
    await claudeProvider.installHooks('', '');
    await applyConsentChoice('claude', 'install', {
      setHooksEnabled: (enabled) => toggleHooks(enabled),
      uninstallHooks: () => claudeProvider.uninstallHooks(),
      areHooksInstalled: () => claudeProvider.areHooksInstalled(),
      syncHooksPreferenceOff: () => {},
      reportHooksStatus: async () => {},
      setTaskTitleFromPrompt: async () => {},
    });
    expect(config.isHooksConsentCurrent('claude')).toBe(true);
    expect(ourEvents()).toContain('UserPromptSubmit');
  });
});
