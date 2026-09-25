# Agent routines: work seat, rest seat, task titles

Date: 2026-09-25
Status: approved in chat (3 stages + 10-agent layout)

## Goal

Characters behave like a team: each agent owns a **work seat** (a PC) and a
**rest seat** (lounge). With a task they walk to the PC and type/read; when
the turn ends they wait ~2 s and go sit in the lounge (no random wandering).
The bubble shows who they are, what task they are on and what they are doing.
Works for any template size: more PC seats = more agents on the floor.

Decisions from the user:

- Title sources: all three, priority **C > B > A** (below).
- No hard cap. Agents beyond the free work seats are shown as a **"+N fora do
  escritório"** badge instead of spawning on top of others.
- **IDE/coordinator = the first session opened.**
- Bug to fix: agents were rendered on top of each other at the same seat.

## Seat classification (generic, no layout flags required)

- **Work seat** = seat that faces electronics (existing `isSeatFacingElectronics`).
- **Rest seat** = any other seat (sofas, lounge/meeting chairs).
- Optional area labels refine it: a seat inside an area labeled `IDE` is
  reserved for the IDE agent; areas labeled `Descanso`/`Lounge`/`Rest`
  (case-insensitive) are preferred rest seats.
- Layouts with no rest seats keep a fallback: the idle agent stays seated at
  its PC in the seated-idle pose.

## Stage 1 — Routines (webview engine)

- `Character` gains `restSeatId: string | null` (work seat stays `seatId`).
- On `addAgent`: pick a free **work** seat only (never a rest seat), plus a free
  rest seat. No free work seat → the agent goes to an overflow list (no
  character); when a work seat frees, the oldest overflow agent is promoted.
- Idle routine: turn end (`setAgentActive(false)`) → wait
  `REST_DELAY_SEC = 2` → walk to rest seat → **seated idle** (sitting pose,
  no typing frames, no wandering). Becoming active cancels the rest route
  and re-paths to the work seat from the current tile (no teleport).
- Permission pending keeps the agent at the work seat (unchanged signal).
- Pathfinding unblocks both of the character's own seats; all other seats
  stay blocked.
- Persistence stores `restSeatId` next to `seatId`; restore never assigns a
  seat that is already taken (fixes the stacking bug if that is the cause).
- Sub-agents keep today's behavior (spawn next to the parent, no seats).

## Stage 2 — IDE role, labels, overflow badge

- First agent created (lowest live id at creation time; re-evaluated when it
  closes) gets `role: 'ide'`; others `'agent'` with a stable display label
  `Agente 01..N` (order of creation, reused numbers fill gaps).
- IDE prefers seats in an area labeled `IDE`; other agents avoid them.
- Overlay panel shows: `IDE` / `Agente 03` · task title · activity summary.
- `+N fora do escritório` badge (pixel UI, bottom-center) listing overflow.

## Stage 3 — Task titles (server + protocol + overlay)

New message `agentTask { id, title: string | null, source: 'tag'|'todo'|'prompt' }`.

- **C — tag**: prompt line matching `^(TASK|TAREFA|TÍTULO|TITULO|TITLE|OBJECTIVE):\s*(.+)`
  (first match, case-insensitive) → title.
- **B — todo**: `TodoWrite` in-progress item (`activeForm` or `content`), or the
  `TaskUpdate`→in_progress / `TaskCreate` subject → title while no tag exists.
- **A — prompt**: first words of the prompt (≤ 8 words / 60 chars, whitespace
  collapsed, code fences stripped).
- Requires installing the `UserPromptSubmit` hook (upstream disabled it for
  privacy). The server derives the title immediately and **never stores or
  forwards the full prompt**. A setting `taskTitleFromPrompt` (default on)
  turns sources A and C off.
- No title → overlay shows `Sem tarefa informada`.

## 10-agent template

`scripts/layouts/ten-agents.mjs` → `layouts/smiith-10-agentes.json` (importable
via Settings → Import Layout): 1 IDE desk (area `IDE`), 9 agent desks, lounge
with 10 rest seats (area `Descanso`), fixing the reported issues (east chairs
facing away, stacked chair pairs, armchair over table).

## Testing

- Webview Vitest: seat classification, overflow promotion, rest routine state
  machine (fake timers / dt stepping), two-seat unblocking, no two characters
  on one seat, restore with conflicting persisted seats.
- Server Vitest: prompt/tag/todo title derivation, prompt text never retained.
- Layout test: 10 work + 10 rest seats, facing, no overlaps, reachability.
- `npm run build`; browser-mock screenshots of the routine.
