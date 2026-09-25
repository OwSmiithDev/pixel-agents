import { transport } from '../../transport/index.js';
import type { OfficeState } from './officeState.js';

export interface OfficeClickHit {
  /** Character under the pointer, if any. */
  agentId: number | null;
  /** Pet under the pointer, if any (ignored when an agent was hit). */
  petId: string | null;
  /** Tile under the pointer; only resolved when a seat click is possible. */
  getTile: () => { col: number; row: number } | null;
}

/**
 * Normal-mode click behavior shared by the 2D canvas and the 3D view:
 * select/deselect agents, toggle pet hearts, reassign seats, clear selection.
 */
export function applyOfficeClick(
  officeState: OfficeState,
  hit: OfficeClickHit,
  onAgentClick: (agentId: number) => void,
): void {
  if (hit.agentId !== null) {
    const hitId = hit.agentId;
    // Dismiss any active bubble on click
    officeState.dismissBubble(hitId);
    // Toggle selection: click same agent deselects, different agent selects
    if (officeState.selectedAgentId === hitId) {
      officeState.selectedAgentId = null;
      officeState.cameraFollowId = null;
    } else {
      officeState.selectedAgentId = hitId;
      officeState.cameraFollowId = hitId;
    }
    onAgentClick(hitId); // still focus terminal
    return;
  }

  // Pet hit: toggle the heart bubble.
  if (hit.petId !== null) {
    const petId = hit.petId;
    const pet = officeState.pets.find((p) => p.id === petId);
    if (pet?.bubbleType) {
      officeState.dismissPetBubble(petId);
    } else {
      officeState.showPetBubble(petId);
    }
    return;
  }

  // No agent hit — check seat click while agent is selected
  if (officeState.selectedAgentId === null) return;
  const selectedCh = officeState.characters.get(officeState.selectedAgentId);
  // Skip seat reassignment for sub-agents
  if (selectedCh && !selectedCh.isSubagent) {
    const tile = hit.getTile();
    if (tile) {
      const seatId = officeState.getSeatAtTile(tile.col, tile.row);
      if (seatId) {
        const seat = officeState.seats.get(seatId);
        if (seat) {
          if (selectedCh.seatId === seatId) {
            // Clicked own seat — send agent back to it
            officeState.sendToSeat(officeState.selectedAgentId);
            officeState.selectedAgentId = null;
            officeState.cameraFollowId = null;
            return;
          } else if (!seat.assigned) {
            // Clicked available seat — reassign
            officeState.reassignSeat(officeState.selectedAgentId, seatId);
            officeState.selectedAgentId = null;
            officeState.cameraFollowId = null;
            transport.send({
              type: 'saveAgentSeats',
              seats: officeState.getPersistableSeats(),
            });
            return;
          }
        }
      }
    }
  }
  // Clicked empty space — deselect
  officeState.selectedAgentId = null;
  officeState.cameraFollowId = null;
}
