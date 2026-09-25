import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';

import { Button } from '../../components/ui/Button.js';
import {
  CHARACTER_SITTING_OFFSET_PX,
  CONTEXT_CRITICAL_THRESHOLD,
  CONTEXT_DANGER_THRESHOLD,
  CONTEXT_GAUGE_BG,
  CONTEXT_GAUGE_COLOR_CRITICAL,
  CONTEXT_GAUGE_COLOR_DANGER,
  CONTEXT_GAUGE_COLOR_OK,
  CONTEXT_GAUGE_COLOR_WARN,
  CONTEXT_GAUGE_HEIGHT_PX,
  CONTEXT_GAUGE_WIDTH_PX,
  CONTEXT_WARN_THRESHOLD,
  TEAM_LEAD_COLOR,
  TEAM_ROLE_COLOR,
  TOOL_OVERLAY_VERTICAL_OFFSET,
} from '../../constants.js';
import type { SubagentCharacter } from '../../hooks/useExtensionMessages.js';
import type { OfficeState } from '../engine/officeState.js';
import { overlayProjection } from '../projection.js';
import type { ToolActivity } from '../types.js';
import { CharacterState } from '../types.js';
import { compactOverlayText, taskTitleText } from './overlayText.js';

// Both turn-end states show the green checkmark bubble. A finished turn (Stop)
// shows ONLY the checkmark (the label falls through to its normal idle text);
// going idle waiting on the user (Notification(idle_prompt)) additionally
// surfaces this label. Driven by Character.waitingAwaitingInput.
const WAITING_INPUT_ACTIVITY_TEXT = 'Waiting for input';

interface ToolOverlayProps {
  officeState: OfficeState;
  agents: number[];
  /** Server-derived task title per agent (agentTask). Untrusted plain text. */
  agentTaskTitles: Record<number, string>;
  agentTools: Record<number, ToolActivity[]>;
  subagentTools: Record<number, Record<string, ToolActivity[]>>;
  subagentCharacters: SubagentCharacter[];
  containerRef: React.RefObject<HTMLDivElement | null>;
  zoom: number;
  panRef: React.RefObject<{ x: number; y: number }>;
  onCloseAgent: (id: number) => void;
  alwaysShowOverlay: boolean;
  /**
   * Optional screen projection (3D view). Maps a character's ground position
   * plus a vertical lift in sprite pixels (negative = up) to container CSS px.
   * Defaults to the 2D canvas projection.
   */
  anchorToScreen?: (
    worldX: number,
    groundY: number,
    liftPx: number,
  ) => { x: number; y: number } | null;
}

/** Derive a short human-readable activity string from tools/status */
function getActivityText(
  agentId: number,
  agentTools: Record<number, ToolActivity[]>,
  isActive: boolean,
  bubbleType: 'permission' | 'waiting' | null,
  waitingAwaitingInput: boolean,
): string {
  if (bubbleType === 'permission') return 'Needs approval';
  // Only the idle case ("Waiting for input") gets a dedicated label. A finished
  // turn (Stop, waitingAwaitingInput=false) falls through so the checkmark alone
  // signals "done", same as the original behavior.
  if (bubbleType === 'waiting' && waitingAwaitingInput) return WAITING_INPUT_ACTIVITY_TEXT;

  const tools = agentTools[agentId];
  if (tools && tools.length > 0) {
    // Find the latest non-done tool
    const activeTool = [...tools].reverse().find((t) => !t.done);
    if (activeTool) {
      if (activeTool.permissionWait) return 'Needs approval';
      return activeTool.status;
    }
    // All tools done but agent still active (mid-turn) — keep showing last tool status
    if (isActive) {
      const lastTool = tools[tools.length - 1];
      if (lastTool) return lastTool.status;
    }
  }

  return 'Idle';
}

function getFuelColor(ratio: number): string {
  if (ratio >= CONTEXT_CRITICAL_THRESHOLD) return CONTEXT_GAUGE_COLOR_CRITICAL;
  if (ratio >= CONTEXT_DANGER_THRESHOLD) return CONTEXT_GAUGE_COLOR_DANGER;
  if (ratio >= CONTEXT_WARN_THRESHOLD) return CONTEXT_GAUGE_COLOR_WARN;
  return CONTEXT_GAUGE_COLOR_OK;
}

export function ToolOverlay({
  officeState,
  agents,
  agentTaskTitles,
  agentTools,
  subagentTools,
  subagentCharacters,
  containerRef,
  zoom,
  panRef,
  onCloseAgent,
  alwaysShowOverlay,
  anchorToScreen,
}: ToolOverlayProps) {
  const reduceMotion = useReducedMotion();
  const [, setTick] = useState(0);
  useEffect(() => {
    let rafId = 0;
    const tick = () => {
      setTick((n) => n + 1);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const el = containerRef.current;
  if (!el) return null;
  const project = overlayProjection(
    officeState.getLayout(),
    el.getBoundingClientRect(),
    zoom,
    panRef.current,
    window.devicePixelRatio || 1,
  );

  const selectedId = officeState.selectedAgentId;
  const hoveredId = officeState.hoveredAgentId;

  // All character IDs
  const allIds = [...agents, ...subagentCharacters.map((s) => s.id)];

  return (
    <>
      {allIds.map((id) => {
        const ch = officeState.characters.get(id);
        if (!ch) return null;

        const isSelected = selectedId === id;
        const isHovered = hoveredId === id;
        const isSub = ch.isSubagent;

        // Only show for hovered or selected agents (unless always-show is on)
        if (!alwaysShowOverlay && !isSelected && !isHovered) return null;

        // Position above character
        const sittingOffset =
          ch.state === CharacterState.TYPE || ch.state === CharacterState.REST
            ? CHARACTER_SITTING_OFFSET_PX
            : 0;
        const lift = sittingOffset - TOOL_OVERLAY_VERTICAL_OFFSET;
        const anchor = anchorToScreen
          ? anchorToScreen(ch.x, ch.y, lift)
          : { x: project.toScreenX(ch.x), y: project.toScreenY(ch.y + lift) };
        if (!anchor) return null;
        const screenX = anchor.x;
        const screenY = anchor.y;

        // A "Done" agent (finished turn: waiting bubble without awaitingInput)
        // shows ONLY its floating green checkmark bubble, never the label panel
        // (the panel would cover the bubble). Render an empty positioned marker
        // so overlay counts stay stable and hover/select can still bring the
        // panel back. When always-show is off, the early return above already
        // keeps the panel hidden for idle agents.
        const isDone = ch.bubbleType === 'waiting' && !ch.waitingAwaitingInput;
        if (isDone && !isSelected && !isHovered) {
          return (
            <div
              key={id}
              className="absolute"
              style={{ left: screenX, top: screenY, pointerEvents: 'none' }}
              data-testid="agent-overlay"
              data-agent-id={id}
            />
          );
        }

        // Get activity text
        const hasWaitingBubble = ch.bubbleType === 'waiting';
        const subHasPermission = isSub && ch.bubbleType === 'permission';
        let activityText: string;
        if (hasWaitingBubble && ch.waitingAwaitingInput) {
          // Idle, waiting on the user -> dedicated label. A finished turn (Stop)
          // shows only the checkmark and falls through to the normal idle text.
          activityText = WAITING_INPUT_ACTIVITY_TEXT;
        } else if (isSub) {
          if (subHasPermission) {
            activityText = 'Needs approval';
          } else {
            // Hover shows the subtask title; SELECTING the sub reveals its live
            // tool activity (watched sub-agents stream it via subagentToolStart).
            const sub = subagentCharacters.find((s) => s.id === id);
            const rows = sub ? subagentTools[sub.parentAgentId]?.[sub.parentToolId] : undefined;
            const activeRow =
              isSelected && rows ? [...rows].reverse().find((t) => !t.done) : undefined;
            activityText = activeRow?.status ?? (sub?.label || 'Subtask');
          }
        } else {
          activityText = getActivityText(
            id,
            agentTools,
            ch.isActive,
            ch.bubbleType,
            ch.waitingAwaitingInput ?? false,
          );
        }

        // Determine dot color
        const tools = agentTools[id];
        const hasPermission = subHasPermission || tools?.some((t) => t.permissionWait && !t.done);
        const hasActiveTools = tools?.some((t) => !t.done);
        const isActive = ch.isActive;
        const hasWaiting = ch.bubbleType === 'waiting';

        let dotColor: string | null = null;
        if (hasPermission || hasWaiting) {
          dotColor = 'var(--color-status-permission)';
        } else if (isActive && hasActiveTools) {
          dotColor = 'var(--color-status-active)';
        }

        // Team info
        const teamRoleLabel = ch.isTeamLead ? 'LEAD' : ch.agentName || null;
        // Role label: `IDE` / `Agente NN`; sub-agents keep their "Subtask: …" label
        const subLabel = isSub ? subagentCharacters.find((s) => s.id === id)?.label : undefined;
        const roleLabel = isSub ? subLabel || 'Subtask' : officeState.getAgentLabel(id);
        const taskTitle = isSub ? null : agentTaskTitles[id];
        const expanded = isSelected || isHovered;

        // Context gauge. Every agent gets one — lead, teammate, adopted,
        // headless — as soon as it has taken a turn. Sub-agents never do: they
        // have no session of their own, so contextTokens stays 0.
        const contextRatio = ch.contextTokens / ch.maxContextTokens;
        const showContextGauge = expanded && !isSub && ch.contextTokens > 0;

        const dot = dotColor && (
          <span
            className={`w-6 h-6 rounded-full shrink-0 ${isActive && !hasPermission && !hasWaiting ? 'pixel-pulse' : ''}`}
            style={{ background: dotColor }}
          />
        );
        const line = 'overflow-hidden text-ellipsis whitespace-nowrap block leading-none';

        let body: React.ReactNode;
        if (!expanded) {
          // COMPACT: one small line, no gauge, no close button
          const text = compactOverlayText(
            roleLabel,
            taskTitle,
            isSub && activityText === roleLabel ? undefined : activityText,
          );
          body = (
            <>
              {dot}
              <span
                className={`${line} text-2xs max-w-220`}
                style={{ fontStyle: isSub ? 'italic' : undefined }}
                title={text}
              >
                {text}
              </span>
            </>
          );
        } else {
          // EXPANDED: label (+ team role), task title, activity
          const line2 = isSub ? null : taskTitleText(taskTitle);
          const line3 = isSub && activityText === roleLabel ? null : activityText;
          body = (
            <>
              {dot}
              <div className="flex flex-col gap-2 overflow-hidden">
                <span className={`${line} text-xs`} title={roleLabel}>
                  {roleLabel}
                  {teamRoleLabel && (
                    <span
                      style={{
                        color: ch.isTeamLead ? TEAM_LEAD_COLOR : TEAM_ROLE_COLOR,
                        fontWeight: ch.isTeamLead ? 'bold' : undefined,
                      }}
                    >
                      {roleLabel ? ' · ' : ''}
                      {teamRoleLabel}
                    </span>
                  )}
                </span>
                {line2 && (
                  <span
                    className={`${line} text-sm`}
                    style={{ opacity: taskTitle ? undefined : 0.6 }}
                    title={line2}
                  >
                    {line2}
                  </span>
                )}
                {line3 && (
                  <span
                    className={`${line} text-xs text-text-muted`}
                    style={{ fontStyle: isSub ? 'italic' : undefined }}
                    title={line3}
                  >
                    {line3}
                  </span>
                )}
              </div>
              {isSelected && !isSub && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseAgent(id);
                  }}
                  title="Close agent"
                  className="ml-2 shrink-0 leading-none"
                >
                  ×
                </Button>
              )}
            </>
          );
        }

        return (
          <div
            key={id}
            // Bottom-anchored (-translate-y-full) so a taller expanded panel grows
            // upward and never covers the character's head.
            className="absolute flex flex-col items-center -translate-x-1/2 -translate-y-full"
            style={{
              left: screenX,
              top: screenY - 2,
              pointerEvents: isSelected ? 'auto' : 'none',
              opacity: alwaysShowOverlay && !expanded ? (isSub ? 0.5 : 0.75) : 1,
              zIndex: isSelected ? 42 : expanded ? 41 : 40,
            }}
            data-testid="agent-overlay"
            data-agent-id={id}
          >
            <motion.div
              className={`flex items-center border-border pixel-panel whitespace-nowrap ${
                expanded ? 'px-8 pt-4 pb-6 gap-5 max-w-2xs' : 'px-4 pt-1 pb-3 gap-4'
              }`}
              initial={reduceMotion ? false : { opacity: 0, y: 6, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ type: 'spring', stiffness: 520, damping: 34, mass: 0.6 }}
            >
              {body}
            </motion.div>
            {showContextGauge && (
              <div
                style={{
                  width: CONTEXT_GAUGE_WIDTH_PX,
                  height: CONTEXT_GAUGE_HEIGHT_PX,
                  background: CONTEXT_GAUGE_BG,
                  marginTop: 2,
                }}
                title={`${Math.round(contextRatio * 100)}% context used (${(ch.contextTokens / 1000).toFixed(0)}k of ${(ch.maxContextTokens / 1000).toFixed(0)}k tokens)`}
                data-testid="context-gauge"
                data-context-pct={Math.round(contextRatio * 100)}
              >
                <div
                  style={{
                    width: `${Math.min(contextRatio * 100, 100)}%`,
                    height: '100%',
                    background: getFuelColor(contextRatio),
                  }}
                />
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
