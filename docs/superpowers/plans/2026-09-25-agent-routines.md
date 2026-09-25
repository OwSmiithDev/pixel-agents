# Agent Routines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agents own a work seat and a rest seat, rest in the lounge when idle, show IDE/agent label + task title + activity, overflow beyond free work seats as a "+N fora do escritório" badge; plus a fixed 10-agent template.

**Architecture:** Webview `OfficeState` gains seat classification (work = faces electronics, rest = other seats), a rest routine in the character FSM, overflow tracking and roles. Server derives a task title from hooks (tag line > in-progress todo > prompt first words) and sends a new `agentTask` message. Overlay renders label/title/activity.

**Tech Stack:** TypeScript, React 19, Vitest, Node server, AsyncAPI-generated messages (`npm run asyncapi:generate`).

**Spec:** `docs/superpowers/specs/2026-09-25-agent-routines-design.md`

## Global Constraints

- Work seat = seat where `isSeatFacingElectronics` is true; rest seat = every other seat. Never auto-assign a rest seat as a work seat.
- `REST_DELAY_SEC = 2` between turn end and walking to the rest seat.
- Title priority: tag line `^(TASK|TAREFA|TÍTULO|TITULO|TITLE|OBJECTIVE):\s*(.+)` (case-insensitive, first match) > in-progress todo > first words of prompt (≤ 8 words, ≤ 60 chars, whitespace collapsed, code fences stripped). No title → overlay text `Sem tarefa informada`.
- The server never stores or forwards the full prompt text; only the derived title (≤ 60 chars).
- IDE = first agent created (re-evaluated when it closes). Labels `IDE`, `Agente 01`… (2-digit, creation order, gaps reused).
- Overflow text: `+N fora do escritório`.
- Color literals only in `webview-ui/src/constants.ts`; pixel UI rules (FS Pixel Sans, `2px 2px 0` shadows).
- One writer per file; parallel tasks run in separate git worktrees.
- Commits: conventional, no AI attribution.

---

### Task 1: 10-agent template (parallel, worktree)

**Files:** Create `scripts/layouts/ten-agents.mjs`, `layouts/smiith-10-agentes.json`, `webview-ui/test/tenAgentsLayout.test.ts`.
**Produces:** importable 32×24 layout: 1 IDE desk in area `IDE`, 9 agent desks (area `Agentes`), lounge area `Descanso` with ≥10 rest seats (sofas/chairs, none facing a PC), east-side chairs use `:left` variants, no stacked chair pairs, graphite+cyan palette consistent with `scripts/layouts/smiith-tech.mjs`.

- [ ] Test: 32×24; exactly 10 seats facing a PC (reuse the facing rule: BACK→UP, FRONT→DOWN, SIDE→RIGHT, SIDE:left→LEFT; faces electronics if the adjacent tile in facing direction, or the next one, is a PC tile); ≥10 other seats inside `Descanso`; no footprint overlaps (bg rows excluded); reachability from every seat to every other.
- [ ] Implement generator; run; tests pass; commit.

### Task 2: Server task titles (parallel, worktree)

**Files:** `server/src/providers/hook/claude/claude.ts`, `server/src/providers/hook/claude/constants.ts`, server hook event handling (`server/src/hookEventHandler.ts`), new `server/src/taskTitle.ts`, protocol (`core/` AsyncAPI spec + regenerated `core/src/messages.ts`), server config for `taskTitleFromPrompt`, tests under `server/__tests__/`.
**Produces:** message `agentTask { id: number; title: string | null; source: 'tag' | 'todo' | 'prompt' }` sent to clients whenever the derived title changes; `UserPromptSubmit` installed again; `deriveTitleFromPrompt(prompt): { title, source } | null` and todo extraction from `TodoWrite` (`todos[].status === 'in_progress'` → `activeForm ?? content`) and `TaskCreate`/`TaskUpdate` (subject of the task set to in_progress).

- [ ] Unit tests for derivation (tag wins, first words, fences stripped, 60-char cap, empty → null) and for "full prompt never retained" (no field on any state/message holds it).
- [ ] Implement, regenerate protocol, server tests for touched files pass; commit.

### Task 3: Stacking bug root cause (read-only, parallel)

Investigate why several agents rendered at the same seat. Output: root cause with file:line and a failing-test recipe for Task 4. No edits.

### Task 4: Stage 1 — routines (webview engine)

**Files:** `webview-ui/src/office/engine/officeState.ts`, `characters.ts`, `webview-ui/src/office/types.ts`, `existingAgents.ts`, `webview-ui/src/constants.ts`, tests `webview-ui/test/agentRoutines.test.ts`.
**Consumes:** Task 3 root cause.
**Produces:** `Character.restSeatId`, `CharacterState.REST` (seated idle, static frame), `OfficeState.getOverflowAgentIds(): number[]`, work/rest seat classification, two-seat unblocking, 2 s rest delay, promotion from overflow, stacking fix.

- [ ] Tests first (see spec Testing), implement, `npx vitest run` in webview-ui passes, commit.

### Task 5: Stage 2 — roles, labels, overflow badge, task title in overlay

**Files:** `webview-ui/src/hooks/useExtensionMessages.ts`, `webview-ui/src/office/components/ToolOverlay.tsx`, new `webview-ui/src/components/OverflowBadge.tsx`, `webview-ui/src/App.tsx`, `officeState.ts` (roles/labels only), `constants.ts`.
**Consumes:** Task 2 `agentTask`, Task 4 overflow API.

- [ ] Tests for label assignment (IDE = first, gap reuse) and title fallback text; implement; build passes; commit.
