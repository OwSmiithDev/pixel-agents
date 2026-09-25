import {
  DEFAULT_MAX_CONTEXT_TOKENS,
  TYPE_FRAME_DURATION_SEC,
  WALK_FRAME_DURATION_SEC,
  WALK_SPEED_PX_PER_SEC,
} from '../../constants.js';
import { findPath } from '../layout/tileMap.js';
import type { CharacterSprites } from '../sprites/spriteData.js';
import { isReadingToolName } from '../toolUtils.js';
import type { Character, Seat, SpriteData, TileType as TileTypeVal } from '../types.js';
import { CharacterState, Direction, TILE_SIZE } from '../types.js';

/** Whether a tool should show the reading animation (vs typing). Taxonomy comes
 *  from the active HookProvider via the `providerCapabilities` message. */
export function isReadingTool(tool: string | null): boolean {
  if (!tool) return false;
  return isReadingToolName(tool);
}

/** Pixel center of a tile */
function tileCenter(col: number, row: number): { x: number; y: number } {
  return {
    x: col * TILE_SIZE + TILE_SIZE / 2,
    y: row * TILE_SIZE + TILE_SIZE / 2,
  };
}

/** Direction from one tile to an adjacent tile */
function directionBetween(
  fromCol: number,
  fromRow: number,
  toCol: number,
  toRow: number,
): Direction {
  const dc = toCol - fromCol;
  const dr = toRow - fromRow;
  if (dc > 0) return Direction.RIGHT;
  if (dc < 0) return Direction.LEFT;
  if (dr > 0) return Direction.DOWN;
  return Direction.UP;
}

export function createCharacter(
  id: number,
  palette: number,
  seatId: string | null,
  seat: Seat | null,
  hueShift = 0,
): Character {
  const col = seat ? seat.seatCol : 1;
  const row = seat ? seat.seatRow : 1;
  const center = tileCenter(col, row);
  return {
    id,
    state: CharacterState.TYPE,
    dir: seat ? seat.facingDir : Direction.DOWN,
    x: center.x,
    y: center.y,
    tileCol: col,
    tileRow: row,
    path: [],
    moveProgress: 0,
    currentTool: null,
    palette,
    hueShift,
    frame: 0,
    frameTimer: 0,
    isActive: true,
    seatId,
    restSeatId: null,
    bubbleType: null,
    bubbleTimer: 0,
    seatTimer: 0,
    isSubagent: false,
    parentAgentId: null,
    matrixEffect: null,
    matrixEffectTimer: 0,
    matrixEffectSeeds: [],
    contextTokens: 0,
    maxContextTokens: DEFAULT_MAX_CONTEXT_TOKENS,
  };
}

function isAt(ch: Character, seat: Seat | undefined): boolean {
  return !!seat && ch.tileCol === seat.seatCol && ch.tileRow === seat.seatRow;
}

export function sit(ch: Character, state: CharacterState, dir: Direction): void {
  ch.state = state;
  ch.dir = dir;
  ch.path = [];
  ch.moveProgress = 0;
  ch.frame = 0;
  ch.frameTimer = 0;
}

/** Start walking from the current tile to `seat`. False when there is no path. */
export function walkTo(
  ch: Character,
  seat: Seat,
  tileMap: TileTypeVal[][],
  blockedTiles: Set<string>,
): boolean {
  const path = findPath(ch.tileCol, ch.tileRow, seat.seatCol, seat.seatRow, tileMap, blockedTiles);
  if (path.length === 0) return false;
  ch.path = path;
  ch.moveProgress = 0;
  ch.state = CharacterState.WALK;
  ch.frame = 0;
  ch.frameTimer = 0;
  return true;
}

/**
 * Routine FSM. An agent types at its work seat while active; when the turn
 * ends (`seatTimer` set by OfficeState.setAgentActive) it stays seated for the
 * delay, then walks to its rest seat and sits idle (REST). Without a rest seat
 * it sits idle at the PC. Becoming active sends it back to the PC — a walk in
 * progress finishes its current step first, so the character never jumps.
 * No random wandering. Caller must unblock the character's own seat tiles.
 */
export function updateCharacter(
  ch: Character,
  dt: number,
  seats: Map<string, Seat>,
  tileMap: TileTypeVal[][],
  blockedTiles: Set<string>,
): void {
  ch.frameTimer += dt;
  const workSeat = ch.seatId ? seats.get(ch.seatId) : undefined;
  const restSeat = ch.restSeatId ? seats.get(ch.restSeatId) : undefined;

  switch (ch.state) {
    case CharacterState.TYPE: {
      if (ch.frameTimer >= TYPE_FRAME_DURATION_SEC) {
        ch.frameTimer -= TYPE_FRAME_DURATION_SEC;
        ch.frame = (ch.frame + 1) % 2;
      }
      if (ch.isActive) break;
      if (ch.seatTimer > 0) {
        ch.seatTimer -= dt;
        break;
      }
      ch.seatTimer = 0;
      if (!restSeat || !walkTo(ch, restSeat, tileMap, blockedTiles)) {
        sit(ch, CharacterState.REST, ch.dir);
      }
      break;
    }

    case CharacterState.REST:
    case CharacterState.IDLE: {
      // Static pose. Only activation moves a seated-idle or standing character.
      ch.frame = 0;
      if (!ch.isActive || !workSeat) break;
      if (isAt(ch, workSeat)) {
        sit(ch, CharacterState.TYPE, workSeat.facingDir);
      } else {
        walkTo(ch, workSeat, tileMap, blockedTiles); // unreachable → keep waiting
      }
      break;
    }

    case CharacterState.WALK: {
      if (ch.frameTimer >= WALK_FRAME_DURATION_SEC) {
        ch.frameTimer -= WALK_FRAME_DURATION_SEC;
        ch.frame = (ch.frame + 1) % 4;
      }

      if (ch.path.length === 0) {
        // Path complete — snap to tile center and sit or stand
        const center = tileCenter(ch.tileCol, ch.tileRow);
        ch.x = center.x;
        ch.y = center.y;
        if (isAt(ch, workSeat)) {
          sit(ch, CharacterState.TYPE, workSeat!.facingDir);
        } else if (!ch.isActive && isAt(ch, restSeat)) {
          sit(ch, CharacterState.REST, restSeat!.facingDir);
        } else {
          sit(ch, CharacterState.IDLE, ch.dir);
        }
        break;
      }

      const nextTile = ch.path[0];
      ch.dir = directionBetween(ch.tileCol, ch.tileRow, nextTile.col, nextTile.row);
      ch.moveProgress += (WALK_SPEED_PX_PER_SEC / TILE_SIZE) * dt;

      const fromCenter = tileCenter(ch.tileCol, ch.tileRow);
      const toCenter = tileCenter(nextTile.col, nextTile.row);
      const t = Math.min(ch.moveProgress, 1);
      ch.x = fromCenter.x + (toCenter.x - fromCenter.x) * t;
      ch.y = fromCenter.y + (toCenter.y - fromCenter.y) * t;

      if (ch.moveProgress >= 1) {
        ch.tileCol = nextTile.col;
        ch.tileRow = nextTile.row;
        ch.x = toCenter.x;
        ch.y = toCenter.y;
        ch.path.shift();
        ch.moveProgress = 0;

        // On a tile boundary an active agent heads for its PC: this cancels a
        // rest route or a manual walk without any positional jump.
        if (ch.isActive && workSeat) {
          const last = ch.path[ch.path.length - 1];
          const headedToWork = last
            ? last.col === workSeat.seatCol && last.row === workSeat.seatRow
            : isAt(ch, workSeat);
          if (!headedToWork) {
            ch.path = findPath(
              ch.tileCol,
              ch.tileRow,
              workSeat.seatCol,
              workSeat.seatRow,
              tileMap,
              blockedTiles,
            );
          }
        }
      }
      break;
    }
  }
}

/** Get the correct sprite frame for a character's current state and direction */
export function getCharacterSprite(ch: Character, sprites: CharacterSprites): SpriteData {
  switch (ch.state) {
    case CharacterState.TYPE:
      if (isReadingTool(ch.currentTool)) {
        return sprites.reading[ch.dir][ch.frame % 2];
      }
      return sprites.typing[ch.dir][ch.frame % 2];
    case CharacterState.REST:
      // Seated idle: sitting pose, one static frame
      return sprites.typing[ch.dir][0];
    case CharacterState.WALK:
      return sprites.walk[ch.dir][ch.frame % 4];
    case CharacterState.IDLE:
      return sprites.walk[ch.dir][1];
    default:
      return sprites.walk[ch.dir][1];
  }
}
