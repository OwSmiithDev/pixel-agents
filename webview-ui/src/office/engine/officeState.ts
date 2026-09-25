import { pickDiversePalette } from '../../../../core/src/paletteUtils.js';
import {
  AUTO_ON_FACING_DEPTH,
  AUTO_ON_SIDE_DEPTH,
  CHARACTER_HIT_HALF_WIDTH,
  CHARACTER_HIT_HEIGHT,
  CHARACTER_SITTING_OFFSET_PX,
  DISMISS_BUBBLE_FAST_FADE_SEC,
  FURNITURE_ANIM_INTERVAL_SEC,
  GREETER_ID,
  GREETER_TILE_MARGIN,
  IDE_AREA_LABEL,
  INACTIVE_SEAT_TIMER_MIN_SEC,
  INACTIVE_SEAT_TIMER_RANGE_SEC,
  MAX_PET_ID_LENGTH,
  PET_HIT_HALF_WIDTH,
  PET_HIT_HEIGHT,
  REST_AREA_LABELS,
  REST_DELAY_SEC,
  WAITING_BUBBLE_DURATION_SEC,
} from '../../constants.js';
import { getAnimationFrames, getCatalogEntry, getOnStateType } from '../layout/furnitureCatalog.js';
import {
  createDefaultLayout,
  getBlockedTiles,
  layoutToFurnitureInstances,
  layoutToSeats,
  layoutToTileMap,
} from '../layout/layoutSerializer.js';
import { findPath, getWalkableTiles, isWalkable } from '../layout/tileMap.js';
import { getPetCount, getPetName } from '../sprites/petSpriteData.js';
import { getLoadedCharacterCount } from '../sprites/spriteData.js';
import type {
  Character,
  FurnitureInstance,
  OfficeLayout,
  Pet,
  PlacedFurniture,
  PlacedPet,
  Seat,
  TileType as TileTypeVal,
} from '../types.js';
import { CharacterState, Direction, PetState, TILE_SIZE } from '../types.js';
import { createCharacter, sit, updateCharacter, walkTo } from './characters.js';
import { advanceMatrixEffect, startMatrixEffect } from './matrixEffectState.js';
import { createPet, updatePet } from './petEntity.js';
import { anchorTile, closestFreeSeat } from './seatPlacement.js';

/** An agent (or sub-agent) waiting for a free work seat. No character exists for it. */
interface OverflowEntry {
  id: number;
  palette: number;
  hueShift: number;
  folderName?: string;
  preferredSeatId?: string;
  preferredRestSeatId?: string;
  nearAgentId?: number;
  /** Set for sub-agents */
  parentAgentId?: number;
  isActive: boolean;
  isHeadless: boolean;
}

/** One agent's entry in the `saveAgentSeats` payload. */
export interface PersistedSeat {
  palette: number;
  hueShift: number;
  seatId: string | null;
  restSeatId: string | null;
}

/** Options for findFreeWorkSeat. */
export interface WorkSeatQuery {
  /** Bias toward seats in the Areas mapped to this workspace folder */
  folderName?: string;
  /** Pick the free work seat closest to this tile */
  near?: { col: number; row: number };
  /** Allow seats inside an area labeled IDE (reserved for the IDE role) */
  allowIde?: boolean;
}

/** Internal helper: facing-tile coords for a seat. Returns null for invalid direction. */
function seatFacingOffset(direction: Direction): { dCol: number; dRow: number } {
  if (direction === Direction.RIGHT) return { dCol: 1, dRow: 0 };
  if (direction === Direction.LEFT) return { dCol: -1, dRow: 0 };
  if (direction === Direction.DOWN) return { dCol: 0, dRow: 1 };
  return { dCol: 0, dRow: -1 };
}

export class OfficeState {
  layout: OfficeLayout;
  tileMap: TileTypeVal[][];
  seats: Map<string, Seat>;
  blockedTiles: Set<string>;
  furniture: FurnitureInstance[];
  walkableTiles: Array<{ col: number; row: number }>;
  characters: Map<number, Character> = new Map();
  pets: Pet[] = [];
  /** Accumulated time for furniture animation frame cycling */
  furnitureAnimTimer = 0;
  selectedAgentId: number | null = null;
  cameraFollowId: number | null = null;
  hoveredAgentId: number | null = null;
  hoveredTile: { col: number; row: number } | null = null;
  /** Maps "parentId:toolId" → sub-agent character ID (negative) */
  subagentIdMap: Map<string, number> = new Map();
  /** Reverse lookup: sub-agent character ID → parent info */
  subagentMeta: Map<number, { parentAgentId: number; parentToolId: string }> = new Map();
  private nextSubagentId = -1;
  /** Agents with no free work seat, oldest first (promoted when a work seat frees). */
  private overflow: OverflowEntry[] = [];
  /** Seats facing electronics. Every other seat is a rest seat. */
  private workSeatIds = new Set<string>();

  /**
   * folderName → list of Area labels that workspace folder belongs to.
   * Populated by useExtensionMessages on `areaMappingsLoaded`. Consulted by
   * `findFreeSeat()` to bias new agents toward seats inside their folder's Area.
   */
  areaMappings: Record<string, string[]> = {};

  /**
   * The first-run consent greeter, deliberately NOT in `characters`.
   *
   * `characters` means "agents": everything that iterates it — seat
   * assignment, palette diversity, the wander FSM, hit-testing, the seat
   * payload the webview persists — is asking an agent question the greeter has
   * no answer to. Holding it here instead of tagging it with a flag makes
   * every one of those loops correct by default, rather than correct as long
   * as each remembers an `isGreeter` guard. It is drawn because
   * `getCharacters()` appends it, and that is the only place it joins the
   * others.
   */
  greeter: Character | null = null;

  /** World-space point the camera drifts to while the greeter is up
   *  (the bubble overlay recomputes it every frame: the combined center of the
   *  character and its speech bubble). An explicit cameraFollowId outranks it. */
  greeterCameraTarget: { x: number; y: number } | null = null;
  /** Latched by a manual pan during the ask: the user took the camera, so the
   *  overlay's per-frame updates stop re-centering. Reset on spawn/despawn. */
  private greeterCameraCancelled = false;

  setAreaMappings(mappings: Record<string, string[]>): void {
    this.areaMappings = mappings;
  }

  constructor(layout?: OfficeLayout) {
    this.layout = layout || createDefaultLayout();
    this.tileMap = layoutToTileMap(this.layout);
    this.seats = layoutToSeats(this.layout.furniture);
    this.blockedTiles = getBlockedTiles(this.layout.furniture);
    this.furniture = layoutToFurnitureInstances(this.layout.furniture);
    this.walkableTiles = getWalkableTiles(this.tileMap, this.blockedTiles);
    this.classifySeats();
    // Pets are built last because they need walkableTiles populated for spawn.
    this.rebuildPetsFromLayout(this.layout);
  }

  /** Rebuild all derived state from a new layout. Reassigns existing characters.
   *  @param shift Optional pixel shift to apply when grid expands left/up */
  rebuildFromLayout(layout: OfficeLayout, shift?: { col: number; row: number }): void {
    this.layout = layout;
    this.tileMap = layoutToTileMap(layout);
    this.seats = layoutToSeats(layout.furniture);
    this.blockedTiles = getBlockedTiles(layout.furniture);
    this.rebuildFurnitureInstances();
    this.walkableTiles = getWalkableTiles(this.tileMap, this.blockedTiles);
    this.classifySeats();

    // Shift character positions when grid expands left/up
    if (shift && (shift.col !== 0 || shift.row !== 0)) {
      for (const ch of this.characters.values()) {
        ch.tileCol += shift.col;
        ch.tileRow += shift.row;
        ch.x += shift.col * TILE_SIZE;
        ch.y += shift.row * TILE_SIZE;
        // Clear path since tile coords changed
        ch.path = [];
        ch.moveProgress = 0;
      }
    }

    // Shift pet positions when grid expands left/up
    if (shift && (shift.col !== 0 || shift.row !== 0)) {
      for (const pet of this.pets) {
        pet.tileCol += shift.col;
        pet.tileRow += shift.row;
        pet.x += shift.col * TILE_SIZE;
        pet.y += shift.row * TILE_SIZE;
        pet.path = [];
        pet.moveProgress = 0;
      }
    }

    // Reassign characters to new seats, preserving existing assignments when possible
    for (const seat of this.seats.values()) {
      seat.assigned = false;
    }

    // First pass: keep seats that still exist, are free, and kept their work/rest role
    for (const ch of this.characters.values()) {
      ch.seatId = this.claimSeat(ch.seatId, true);
      ch.restSeatId = this.claimSeat(ch.restSeatId, false);
    }

    // Second pass: re-seat the rest. No work seat left → back to the overflow list.
    for (const ch of [...this.characters.values()]) {
      if (!ch.seatId) {
        const near =
          ch.parentAgentId !== null
            ? anchorTile(this.characters.get(ch.parentAgentId), this.seats)
            : undefined;
        ch.seatId = this.claimSeat(
          this.findFreeWorkSeat(near ? { near } : { folderName: ch.folderName }),
          true,
        );
      }
      if (!ch.seatId) {
        this.characters.delete(ch.id);
        if (ch.matrixEffect !== 'despawn') this.overflow.push(this.overflowEntryOf(ch));
        continue;
      }
      if (!ch.restSeatId && !ch.isSubagent) this.assignRestSeat(ch);
      // Editor rebuilds happen on every edit: leave a character seated on its own
      // seat alone, and re-route one standing/walking on the floor.
      const seated = ch.state === CharacterState.TYPE || ch.state === CharacterState.REST;
      if (seated && this.ownSeatKeys(ch).includes(`${ch.tileCol},${ch.tileRow}`)) continue;
      if (!seated && isWalkable(ch.tileCol, ch.tileRow, this.tileMap, this.blockedTiles)) {
        const target = this.seats.get((ch.isActive ? null : ch.restSeatId) ?? ch.seatId)!;
        if (
          this.withOwnSeatUnblocked(ch, () => walkTo(ch, target, this.tileMap, this.blockedTiles))
        )
          continue;
      }
      // Otherwise snap to the work seat; an inactive agent heads to its rest seat from there
      const seat = this.seats.get(ch.seatId)!;
      ch.tileCol = seat.seatCol;
      ch.tileRow = seat.seatRow;
      ch.x = seat.seatCol * TILE_SIZE + TILE_SIZE / 2;
      ch.y = seat.seatRow * TILE_SIZE + TILE_SIZE / 2;
      sit(ch, CharacterState.TYPE, seat.facingDir);
    }
    this.promoteOverflow();

    // Relocate any pets that ended up outside bounds or on non-walkable tiles
    for (const pet of this.pets) {
      if (
        pet.tileCol < 0 ||
        pet.tileCol >= layout.cols ||
        pet.tileRow < 0 ||
        pet.tileRow >= layout.rows ||
        !isWalkable(pet.tileCol, pet.tileRow, this.tileMap, this.blockedTiles)
      ) {
        if (this.walkableTiles.length > 0) {
          const spawn = this.walkableTiles[Math.floor(Math.random() * this.walkableTiles.length)];
          pet.tileCol = spawn.col;
          pet.tileRow = spawn.row;
          pet.x = spawn.col * TILE_SIZE + TILE_SIZE / 2;
          pet.y = spawn.row * TILE_SIZE + TILE_SIZE / 2;
          pet.path = [];
          pet.moveProgress = 0;
          pet.state = PetState.IDLE;
          pet.frame = 0;
          pet.frameTimer = 0;
          pet.followTargetId = null;
        }
      }
    }

    // Reconcile pets against the layout roster (handles editor add/remove)
    this.rebuildPetsFromLayout(layout);
  }

  getLayout(): OfficeLayout {
    return this.layout;
  }

  /** Blocked-tile keys of a character's own seats (work + rest) */
  private ownSeatKeys(ch: Character): string[] {
    const keys: string[] = [];
    for (const uid of [ch.seatId, ch.restSeatId]) {
      const seat = uid ? this.seats.get(uid) : undefined;
      if (seat) keys.push(`${seat.seatCol},${seat.seatRow}`);
    }
    return keys;
  }

  /** Temporarily unblock a character's own seats (work + rest), run fn, then re-block.
   *  Every other seat stays blocked. */
  private withOwnSeatUnblocked<T>(ch: Character, fn: () => T): T {
    const keys = this.ownSeatKeys(ch).filter((k) => this.blockedTiles.delete(k));
    try {
      return fn();
    } finally {
      for (const k of keys) this.blockedTiles.add(k);
    }
  }

  /** Recompute which seats are work seats (face electronics). */
  private classifySeats(): void {
    const electronics = this.buildElectronicsTileSet();
    this.workSeatIds = new Set(
      [...this.seats.values()]
        .filter((s) => this.isSeatFacingElectronics(s, electronics))
        .map((s) => s.uid),
    );
  }

  /** Work seat = a seat facing electronics (PC, monitor). Every other seat is a rest seat. */
  isWorkSeat(uid: string): boolean {
    return this.workSeatIds.has(uid);
  }

  private seatInArea(uid: string, labels: string[]): boolean {
    const zone = this.seatZone(uid);
    return zone !== null && labels.includes(zone.toLowerCase());
  }

  /** Mark `uid` assigned and return it when it exists, is free and has the wanted
   *  role (work or rest); otherwise null. */
  private claimSeat(uid: string | null | undefined, work: boolean): string | null {
    const seat = uid ? this.seats.get(uid) : undefined;
    if (!seat || seat.assigned || this.isWorkSeat(seat.uid) !== work) return null;
    seat.assigned = true;
    return seat.uid;
  }

  /**
   * Free work seat for an agent, or null. Seats in an `IDE` area are skipped
   * unless `allowIde` (the IDE role hook). With `near`, the closest seat wins;
   * otherwise the 3-stage folder/Area picker (mapped Areas → unzoned → any).
   */
  findFreeWorkSeat(opts: WorkSeatQuery = {}): string | null {
    const free = [...this.workSeatIds].filter(
      (uid) =>
        !this.seats.get(uid)!.assigned &&
        (opts.allowIde || !this.seatInArea(uid, [IDE_AREA_LABEL])),
    );
    if (free.length === 0) return null;
    if (opts.near) return this.closestOf(free, opts.near);

    const pick = (uids: string[]) =>
      uids.length > 0 ? uids[Math.floor(Math.random() * uids.length)] : null;
    const areaLabels = opts.folderName ? this.areaMappings[opts.folderName] : undefined;
    if (areaLabels && areaLabels.length > 0) {
      const wanted = new Set(areaLabels);
      const inArea = pick(free.filter((uid) => wanted.has(this.seatZone(uid) ?? '')));
      if (inArea) return inArea;
    }
    return pick(free.filter((uid) => this.seatZone(uid) === null)) ?? pick(free);
  }

  /** Free rest seat closest to `near`, preferring Descanso/Lounge/Rest areas; IDE area skipped. */
  private findFreeRestSeat(near: { col: number; row: number }): string | null {
    const free = [...this.seats.values()]
      .filter(
        (s) => !s.assigned && !this.isWorkSeat(s.uid) && !this.seatInArea(s.uid, [IDE_AREA_LABEL]),
      )
      .map((s) => s.uid);
    const preferred = free.filter((uid) => this.seatInArea(uid, REST_AREA_LABELS));
    return this.closestOf(preferred.length > 0 ? preferred : free, near);
  }

  private closestOf(uids: string[], near: { col: number; row: number }): string | null {
    return closestFreeSeat(
      new Map(uids.map((uid) => [uid, this.seats.get(uid)!])),
      near.col,
      near.row,
    );
  }

  private assignRestSeat(ch: Character, preferred?: string): void {
    ch.restSeatId =
      this.claimSeat(preferred, false) ??
      this.claimSeat(this.findFreeRestSeat({ col: ch.tileCol, row: ch.tileRow }), false);
  }

  /** Collect every tile occupied by electronics furniture (PCs, monitors, etc.). */
  private buildElectronicsTileSet(): Set<string> {
    const out = new Set<string>();
    for (const item of this.layout.furniture) {
      const entry = getCatalogEntry(item.type);
      if (!entry || entry.category !== 'electronics') continue;
      for (let dr = 0; dr < entry.footprintH; dr++) {
        for (let dc = 0; dc < entry.footprintW; dc++) {
          out.add(`${item.col + dc},${item.row + dr}`);
        }
      }
    }
    return out;
  }

  /** Find the area label assigned to a seat's tile, or null. Public for e2e
   *  observability (getAgentSeats hook reads a seated agent's area). */
  seatZone(uid: string): string | null {
    const seat = this.seats.get(uid);
    if (!seat) return null;
    const tiles = this.layout.areaTiles;
    if (!tiles || tiles.length === 0) return null;
    const idx = seat.seatRow * this.layout.cols + seat.seatCol;
    if (idx < 0 || idx >= tiles.length) return null;
    return tiles[idx] ?? null;
  }

  /**
   * Does this seat face an electronics tile (PC, monitor)? Mirrors the
   * forward-and-flanking scan used by furniture auto-state.
   */
  private isSeatFacingElectronics(seat: Seat, electronicsTiles: Set<string>): boolean {
    const { dCol, dRow } = seatFacingOffset(seat.facingDir);
    for (let d = 1; d <= AUTO_ON_FACING_DEPTH; d++) {
      const tileCol = seat.seatCol + dCol * d;
      const tileRow = seat.seatRow + dRow * d;
      if (electronicsTiles.has(`${tileCol},${tileRow}`)) return true;
      if (dCol !== 0) {
        if (
          electronicsTiles.has(`${tileCol},${tileRow - 1}`) ||
          electronicsTiles.has(`${tileCol},${tileRow + 1}`)
        ) {
          return true;
        }
      } else if (
        electronicsTiles.has(`${tileCol - 1},${tileRow}`) ||
        electronicsTiles.has(`${tileCol + 1},${tileRow}`)
      ) {
        return true;
      }
    }
    return false;
  }

  /** Closest walkable tile to (col,row) not occupied by another character, or null. */
  private closestFreeWalkableTile(col: number, row: number): { col: number; row: number } | null {
    const occupied = new Set<string>();
    for (const ch of this.characters.values()) {
      occupied.add(`${ch.tileCol},${ch.tileRow}`);
    }
    let best: { col: number; row: number } | null = null;
    let bestDist = Infinity;
    for (const tile of this.walkableTiles) {
      if (occupied.has(`${tile.col},${tile.row}`)) continue;
      const d = Math.abs(tile.col - col) + Math.abs(tile.row - row);
      if (d < bestDist) {
        best = tile;
        bestDist = d;
      }
    }
    return best;
  }

  /**
   * Pick a diverse palette for a new agent based on currently active agents.
   * First 6 agents each get a unique skin (random order). Beyond 6, skins
   * repeat in balanced rounds with a random hue shift (≥45°).
   */
  private pickDiversePalette(): { palette: number; hueShift: number } {
    // Count how many non-sub-agents use each base palette (0-5)
    const paletteCount = getLoadedCharacterCount();
    const counts = new Array(paletteCount).fill(0) as number[];
    for (const ch of this.characters.values()) {
      if (ch.isSubagent) continue;
      if (ch.palette < paletteCount) counts[ch.palette]++;
    }
    return pickDiversePalette(paletteCount, counts);
  }

  addAgent(
    id: number,
    preferredPalette?: number,
    preferredHueShift?: number,
    preferredSeatId?: string,
    skipSpawnEffect?: boolean,
    folderName?: string,
    nearAgentId?: number,
    preferredRestSeatId?: string,
  ): void {
    const existing = this.characters.get(id);
    if (existing) {
      // Re-added mid-despawn: revive it. Its seats are still held — they are
      // only released once the despawn finishes.
      if (existing.matrixEffect === 'despawn') startMatrixEffect(existing, 'spawn');
      return;
    }
    if (this.overflow.some((e) => e.id === id)) return;

    let palette: number;
    let hueShift: number;
    if (preferredPalette !== undefined) {
      palette = preferredPalette;
      hueShift = preferredHueShift ?? 0;
    } else {
      const pick = this.pickDiversePalette();
      palette = pick.palette;
      hueShift = pick.hueShift;
    }

    const entry: OverflowEntry = {
      id,
      palette,
      hueShift,
      folderName,
      preferredSeatId,
      preferredRestSeatId,
      nearAgentId,
      isActive: true,
      isHeadless: false,
    };
    if (!this.place(entry, skipSpawnEffect)) this.overflow.push(entry);
  }

  /** Agent ids waiting for a free work seat, oldest first (no character exists for them). */
  getOverflowAgentIds(): number[] {
    return this.overflow.map((e) => e.id);
  }

  /**
   * Create the character for an agent or sub-agent on a free work seat (plus a
   * rest seat for top-level agents). Returns false when no work seat is free.
   *
   * Top-level: persisted seat if still a free work seat, then (teammates) the
   * work seat closest to the anchor's SEAT — stable from creation, so a
   * teammate placed while the lead is still walking clusters around the final
   * seat — then the folder/Area picker. Sub-agents: the work seat closest to
   * the parent, or any work seat when the parent has no character.
   */
  private place(e: OverflowEntry, skipSpawnEffect = false): boolean {
    const anchorId = e.parentAgentId ?? e.nearAgentId;
    const anchorAt =
      anchorId !== undefined ? anchorTile(this.characters.get(anchorId), this.seats) : undefined;
    const seatId =
      this.claimSeat(e.preferredSeatId, true) ??
      this.claimSeat(
        this.findFreeWorkSeat(anchorAt ? { near: anchorAt } : { folderName: e.folderName }),
        true,
      );
    if (!seatId) return false;

    const parent = e.parentAgentId !== undefined ? this.characters.get(e.parentAgentId) : undefined;
    const ch = createCharacter(
      e.id,
      parent?.palette ?? e.palette,
      seatId,
      this.seats.get(seatId)!,
      parent?.hueShift ?? e.hueShift,
    );
    ch.isActive = e.isActive;
    if (e.isHeadless) ch.isHeadless = true;
    if (e.folderName) ch.folderName = e.folderName;
    if (e.parentAgentId !== undefined) {
      ch.isSubagent = true;
      ch.parentAgentId = e.parentAgentId;
    } else {
      this.assignRestSeat(ch, e.preferredRestSeatId);
    }
    if (!skipSpawnEffect) startMatrixEffect(ch, 'spawn');
    this.characters.set(e.id, ch);
    return true;
  }

  /** Promote overflow agents, oldest first, while work seats are free. */
  private promoteOverflow(): void {
    while (this.overflow.length > 0 && this.place(this.overflow[0])) this.overflow.shift();
  }

  private dropOverflow(id: number): boolean {
    const i = this.overflow.findIndex((e) => e.id === id);
    if (i >= 0) this.overflow.splice(i, 1);
    return i >= 0;
  }

  private overflowEntryOf(ch: Character): OverflowEntry {
    return {
      id: ch.id,
      palette: ch.palette,
      hueShift: ch.hueShift,
      folderName: ch.folderName,
      nearAgentId: ch.leadAgentId,
      parentAgentId: ch.isSubagent && ch.parentAgentId !== null ? ch.parentAgentId : undefined,
      isActive: ch.isActive,
      isHeadless: !!ch.isHeadless,
    };
  }

  /** Release a character's work and rest seats. */
  private releaseSeats(ch: Character): void {
    for (const uid of [ch.seatId, ch.restSeatId]) {
      const seat = uid ? this.seats.get(uid) : undefined;
      if (seat) seat.assigned = false;
    }
  }

  // ── Greeter ───────────────────────────────────────────────────
  // The Intro is diegetic: a char_0 character stands near the office's
  // bottom-left corner and "speaks" the tour through a DOM bubble
  // (IntroBubble). It is not an agent — see the `greeter` field.

  /** Spawn the greeter near the office's bottom-left corner: target tile
   *  GREETER_TILE_MARGIN in from the left and bottom edges, falling
   *  back to the closest walkable tile when the target is a seat, furniture,
   *  a wall, or VOID (seat tiles are in blockedTiles, so closestFreeWalkableTile
   *  covers every one of those). Idempotent; a remount mid-despawn (StrictMode)
   *  revives it. */
  spawnGreeter(): void {
    this.greeterCameraCancelled = false;
    if (this.greeter) {
      if (this.greeter.matrixEffect === 'despawn') startMatrixEffect(this.greeter, 'spawn');
      return;
    }
    const spawn = this.closestFreeWalkableTile(
      GREETER_TILE_MARGIN,
      this.layout.rows - 1 - GREETER_TILE_MARGIN,
    );
    if (!spawn) return; // no walkable tile — IntroBubble falls back to a fixed panel
    const ch = createCharacter(GREETER_ID, 0, null, null, 0);
    ch.isGreeter = true;
    ch.state = CharacterState.IDLE;
    ch.isActive = false;
    ch.dir = Direction.DOWN;
    ch.x = spawn.col * TILE_SIZE + TILE_SIZE / 2;
    ch.y = spawn.row * TILE_SIZE + TILE_SIZE / 2;
    ch.tileCol = spawn.col;
    ch.tileRow = spawn.row;
    startMatrixEffect(ch, 'spawn');
    this.greeter = ch;
  }

  /** Start the greeter's despawn effect and release the greeter camera. The
   *  character is dropped once the effect finishes (see update()).
   *  Idempotent — every close path (answer, Escape, hooksStatus) funnels here. */
  despawnGreeter(): void {
    this.greeterCameraTarget = null;
    this.greeterCameraCancelled = false;
    if (!this.greeter || this.greeter.matrixEffect === 'despawn') return;
    startMatrixEffect(this.greeter, 'despawn');
  }

  /** Per-frame update from the bubble overlay; ignored once the user panned. */
  setGreeterCameraTarget(p: { x: number; y: number }): void {
    if (!this.greeterCameraCancelled) this.greeterCameraTarget = p;
  }

  /** Manual pan during the ask: stop re-centering until the next spawn. */
  cancelGreeterCamera(): void {
    this.greeterCameraTarget = null;
    this.greeterCameraCancelled = true;
  }

  removeAgent(id: number): void {
    if (this.dropOverflow(id)) return;
    const ch = this.characters.get(id);
    if (!ch) return;
    if (ch.matrixEffect === 'despawn') return; // already despawning
    // Seats stay held until the despawn finishes (update), so nobody
    // materializes on the chair while the old sprite is still dissolving.
    if (this.selectedAgentId === id) this.selectedAgentId = null;
    if (this.cameraFollowId === id) this.cameraFollowId = null;
    // Start despawn animation instead of immediate delete
    startMatrixEffect(ch, 'despawn');
    ch.bubbleType = null;
  }

  /** Find seat uid at a given tile position, or null */
  getSeatAtTile(col: number, row: number): string | null {
    for (const [uid, seat] of this.seats) {
      if (seat.seatCol === col && seat.seatRow === row) return uid;
    }
    return null;
  }

  /** Move an agent to another work seat. A refused move (seat missing, taken, or
   *  not a work seat) leaves the agent on its current seat. */
  reassignSeat(agentId: number, seatId: string): void {
    const ch = this.characters.get(agentId);
    if (!ch || ch.seatId === seatId) return;
    const seat = this.seats.get(seatId);
    if (!seat || seat.assigned || !this.isWorkSeat(seatId)) return;
    const old = ch.seatId ? this.seats.get(ch.seatId) : undefined;
    if (old) old.assigned = false;
    seat.assigned = true;
    ch.seatId = seatId;
    this.headToWorkSeat(ch);
  }

  /**
   * Move a just-linked teammate to the free work seat closest to its lead, so
   * teams cluster. Only moves when that seat is strictly closer than the
   * teammate's current one — a teammate created as a plain external agent
   * (seated by the folder/Area picker) and tagged as a teammate only after tag
   * discovery would otherwise keep its arbitrary seat, unlike an inline
   * teammate seated next to the lead at creation.
   */
  private reseatNextToLead(teammateId: number, leadId: number): void {
    const teammate = this.characters.get(teammateId);
    const lead = this.characters.get(leadId);
    if (!teammate || !lead) return;
    const anchorAt = anchorTile(lead, this.seats);
    if (!anchorAt) return;
    const target = this.findFreeWorkSeat({ near: anchorAt });
    if (!target || target === teammate.seatId) return;
    const targetSeat = this.seats.get(target)!;
    const targetDist =
      Math.abs(targetSeat.seatCol - anchorAt.col) + Math.abs(targetSeat.seatRow - anchorAt.row);
    const currentSeat = teammate.seatId ? this.seats.get(teammate.seatId) : undefined;
    const currentDist = currentSeat
      ? Math.abs(currentSeat.seatCol - anchorAt.col) + Math.abs(currentSeat.seatRow - anchorAt.row)
      : Infinity;
    if (targetDist < currentDist) {
      this.reassignSeat(teammateId, target);
    }
  }

  /** Send an agent back to their work seat */
  sendToSeat(agentId: number): void {
    const ch = this.characters.get(agentId);
    if (ch) this.headToWorkSeat(ch);
  }

  /** Walk (or sit) to the work seat. An idle agent sits there a few seconds
   *  before its rest routine takes it back to the lounge. */
  private headToWorkSeat(ch: Character): void {
    const seat = ch.seatId ? this.seats.get(ch.seatId) : undefined;
    if (!seat) return;
    if (!ch.isActive) {
      ch.seatTimer = INACTIVE_SEAT_TIMER_MIN_SEC + Math.random() * INACTIVE_SEAT_TIMER_RANGE_SEC;
    }
    if (ch.tileCol === seat.seatCol && ch.tileRow === seat.seatRow) {
      sit(ch, CharacterState.TYPE, seat.facingDir);
    } else {
      this.withOwnSeatUnblocked(ch, () => walkTo(ch, seat, this.tileMap, this.blockedTiles));
    }
  }

  /** Walk an agent to an arbitrary walkable tile (right-click command) */
  walkToTile(agentId: number, col: number, row: number): boolean {
    const ch = this.characters.get(agentId);
    if (!ch || ch.isSubagent) return false;
    if (!isWalkable(col, row, this.tileMap, this.blockedTiles)) {
      // Also allow walking to own seat tiles (blocked for others but not self)
      if (!this.ownSeatKeys(ch).includes(`${col},${row}`)) return false;
    }
    const path = this.withOwnSeatUnblocked(ch, () =>
      findPath(ch.tileCol, ch.tileRow, col, row, this.tileMap, this.blockedTiles),
    );
    if (path.length === 0) return false;
    ch.path = path;
    ch.moveProgress = 0;
    ch.state = CharacterState.WALK;
    ch.frame = 0;
    ch.frameTimer = 0;
    return true;
  }

  /** Create a sub-agent with the parent's palette on the free work seat closest
   *  to the parent (no rest seat). No free work seat → overflow. Returns the ID. */
  addSubagent(parentAgentId: number, parentToolId: string): number {
    const key = `${parentAgentId}:${parentToolId}`;
    if (this.subagentIdMap.has(key)) return this.subagentIdMap.get(key)!;

    const id = this.nextSubagentId--;
    const parentCh = this.characters.get(parentAgentId);
    const entry: OverflowEntry = {
      id,
      palette: parentCh ? parentCh.palette : 0,
      hueShift: parentCh ? parentCh.hueShift : 0,
      parentAgentId,
      isActive: true,
      isHeadless: false,
    };
    if (!this.place(entry)) this.overflow.push(entry);

    this.subagentIdMap.set(key, id);
    this.subagentMeta.set(id, { parentAgentId, parentToolId });
    return id;
  }

  /** Remove a specific sub-agent (its seat frees when the despawn finishes) */
  removeSubagent(parentAgentId: number, parentToolId: string): void {
    const key = `${parentAgentId}:${parentToolId}`;
    const id = this.subagentIdMap.get(key);
    if (id === undefined) return;

    this.dropOverflow(id);
    const ch = this.characters.get(id);
    if (ch && ch.matrixEffect !== 'despawn') {
      // Start despawn animation — keep character in map for rendering
      startMatrixEffect(ch, 'despawn');
      ch.bubbleType = null;
    }
    // Clean up tracking maps immediately so keys don't collide
    this.subagentIdMap.delete(key);
    this.subagentMeta.delete(id);
    if (this.selectedAgentId === id) this.selectedAgentId = null;
    if (this.cameraFollowId === id) this.cameraFollowId = null;
  }

  /** Remove all sub-agents belonging to a parent agent */
  removeAllSubagents(parentAgentId: number): void {
    const toolIds = [...this.subagentMeta.values()]
      .filter((m) => m.parentAgentId === parentAgentId)
      .map((m) => m.parentToolId);
    for (const toolId of toolIds) this.removeSubagent(parentAgentId, toolId);
  }

  /** Look up the sub-agent character ID for a given parent+toolId, or null */
  getSubagentId(parentAgentId: number, parentToolId: string): number | null {
    return this.subagentIdMap.get(`${parentAgentId}:${parentToolId}`) ?? null;
  }

  setAgentActive(id: number, active: boolean): void {
    const waiting = this.overflow.find((e) => e.id === id);
    if (waiting) waiting.isActive = active;
    const ch = this.characters.get(id);
    if (ch) {
      // Turn just ended: linger at the PC for REST_DELAY_SEC before the rest routine.
      if (ch.isActive && !active) ch.seatTimer = REST_DELAY_SEC;
      ch.isActive = active;
      this.rebuildFurnitureInstances();
    }
  }

  /** Rebuild furniture instances with auto-state applied (active agents turn electronics ON) */
  private rebuildFurnitureInstances(): void {
    // Collect tiles where active agents face desks
    const autoOnTiles = new Set<string>();
    for (const ch of this.characters.values()) {
      if (!ch.isActive || !ch.seatId) continue;
      const seat = this.seats.get(ch.seatId);
      if (!seat) continue;
      // Find the desk tile(s) the agent faces from their seat
      const dCol =
        seat.facingDir === Direction.RIGHT ? 1 : seat.facingDir === Direction.LEFT ? -1 : 0;
      const dRow = seat.facingDir === Direction.DOWN ? 1 : seat.facingDir === Direction.UP ? -1 : 0;
      // Check tiles in the facing direction (desk could be 1-3 tiles deep)
      for (let d = 1; d <= AUTO_ON_FACING_DEPTH; d++) {
        const tileCol = seat.seatCol + dCol * d;
        const tileRow = seat.seatRow + dRow * d;
        autoOnTiles.add(`${tileCol},${tileRow}`);
      }
      // Also check tiles to the sides of the facing direction (desks can be wide)
      for (let d = 1; d <= AUTO_ON_SIDE_DEPTH; d++) {
        const baseCol = seat.seatCol + dCol * d;
        const baseRow = seat.seatRow + dRow * d;
        if (dCol !== 0) {
          // Facing left/right: check tiles above and below
          autoOnTiles.add(`${baseCol},${baseRow - 1}`);
          autoOnTiles.add(`${baseCol},${baseRow + 1}`);
        } else {
          // Facing up/down: check tiles left and right
          autoOnTiles.add(`${baseCol - 1},${baseRow}`);
          autoOnTiles.add(`${baseCol + 1},${baseRow}`);
        }
      }
    }

    if (autoOnTiles.size === 0) {
      this.furniture = layoutToFurnitureInstances(this.layout.furniture);
      return;
    }

    // Build modified furniture list with auto-state and animation applied
    const animFrame = Math.floor(this.furnitureAnimTimer / FURNITURE_ANIM_INTERVAL_SEC);
    const modifiedFurniture: PlacedFurniture[] = this.layout.furniture.map((item) => {
      const entry = getCatalogEntry(item.type);
      if (!entry) return item;
      // Check if any tile of this furniture overlaps an auto-on tile
      for (let dr = 0; dr < entry.footprintH; dr++) {
        for (let dc = 0; dc < entry.footprintW; dc++) {
          if (autoOnTiles.has(`${item.col + dc},${item.row + dr}`)) {
            let onType = getOnStateType(item.type);
            if (onType !== item.type) {
              // Check if the on-state type has animation frames
              const frames = getAnimationFrames(onType);
              if (frames && frames.length > 1) {
                const frameIdx = animFrame % frames.length;
                onType = frames[frameIdx];
              }
              return { ...item, type: onType };
            }
            return item;
          }
        }
      }
      return item;
    });

    this.furniture = layoutToFurnitureInstances(modifiedFurniture);
  }

  setAgentTool(id: number, tool: string | null): void {
    const ch = this.characters.get(id);
    if (ch) {
      ch.currentTool = tool;
    }
  }

  showPermissionBubble(id: number): void {
    const ch = this.characters.get(id);
    if (ch) {
      ch.bubbleType = 'permission';
      ch.bubbleTimer = 0;
    }
  }

  clearPermissionBubble(id: number): void {
    const ch = this.characters.get(id);
    if (ch && ch.bubbleType === 'permission') {
      ch.bubbleType = null;
      ch.bubbleTimer = 0;
    }
  }

  showWaitingBubble(id: number, awaitingInput = false): void {
    const ch = this.characters.get(id);
    if (ch) {
      ch.bubbleType = 'waiting';
      ch.waitingAwaitingInput = awaitingInput;
      ch.bubbleTimer = WAITING_BUBBLE_DURATION_SEC;
    }
  }

  /** Dismiss bubble on click — permission: instant, waiting: quick fade */
  dismissBubble(id: number): void {
    const ch = this.characters.get(id);
    if (!ch || !ch.bubbleType) return;
    if (ch.bubbleType === 'permission') {
      ch.bubbleType = null;
      ch.bubbleTimer = 0;
    } else if (ch.bubbleType === 'waiting') {
      // Trigger immediate fade (0.3s remaining)
      ch.bubbleTimer = Math.min(ch.bubbleTimer, DISMISS_BUBBLE_FAST_FADE_SEC);
    }
  }

  // ── Pets ──────────────────────────────────────────────────────

  /**
   * Add a pet to the live runtime. Spawns at a uniformly-random walkable tile.
   * Mirror in `this.layout.pets` so debounced saveLayout serialises the roster.
   * Bounds-checks petType against the loaded sprite count to defend against stale layouts.
   */
  addPet(placedPet: PlacedPet): void {
    // Defensive guards (upstream 5e6c0a0)
    if (
      typeof placedPet.id !== 'string' ||
      placedPet.id.length === 0 ||
      placedPet.id.length > MAX_PET_ID_LENGTH
    ) {
      return;
    }
    if (
      !Number.isInteger(placedPet.petType) ||
      placedPet.petType < 0 ||
      placedPet.petType >= getPetCount()
    ) {
      return;
    }
    if (this.pets.some((p) => p.id === placedPet.id)) return; // de-dupe
    if (this.walkableTiles.length === 0) return; // no spawn space — silently drop

    const spawn = this.walkableTiles[Math.floor(Math.random() * this.walkableTiles.length)];
    const pet = createPet(placedPet.id, placedPet.petType, spawn.col, spawn.row);
    pet.name = getPetName(placedPet.petType);
    this.pets.push(pet);
    this.syncLayoutPets();
  }

  /** Remove a pet by id. Idempotent. */
  removePet(id: string): void {
    const before = this.pets.length;
    this.pets = this.pets.filter((p) => p.id !== id);
    if (this.pets.length !== before) {
      this.syncLayoutPets();
    }
  }

  /** Shallow snapshot for external consumers (renderer, hooks). */
  getPets(): Pet[] {
    return this.pets.slice();
  }

  /** Unique petType values currently placed. Used by the Pets toolbar to mark active rows. */
  getActivePetTypes(): number[] {
    const seen = new Set<number>();
    for (const p of this.pets) seen.add(p.petType);
    return Array.from(seen);
  }

  /**
   * Hit-test pets at a pixel world position. Sorts back-to-front (largest y wins on tie)
   * so the visually-frontmost pet receives the click.
   * Returns the pet id or null.
   */
  getPetAt(worldX: number, worldY: number): string | null {
    const ordered = this.pets.slice().sort((a, b) => b.y - a.y);
    for (const pet of ordered) {
      const left = pet.x - PET_HIT_HALF_WIDTH;
      const right = pet.x + PET_HIT_HALF_WIDTH;
      const top = pet.y - PET_HIT_HEIGHT;
      const bottom = pet.y;
      if (worldX >= left && worldX <= right && worldY >= top && worldY <= bottom) {
        return pet.id;
      }
    }
    return null;
  }

  /** Show the heart bubble on a pet for WAITING_BUBBLE_DURATION_SEC. */
  showPetBubble(petId: string): void {
    const pet = this.pets.find((p) => p.id === petId);
    if (!pet) return;
    pet.bubbleType = 'heart';
    pet.bubbleTimer = WAITING_BUBBLE_DURATION_SEC;
  }

  /** Dismiss the heart bubble on click; collapses timer to a fast fade. */
  dismissPetBubble(petId: string): void {
    const pet = this.pets.find((p) => p.id === petId);
    if (!pet || !pet.bubbleType) return;
    pet.bubbleTimer = Math.min(pet.bubbleTimer, DISMISS_BUBBLE_FAST_FADE_SEC);
  }

  /**
   * Reconcile `this.pets` to match the layout's placed-pet roster.
   * - Pets in layout but not in runtime → spawn via addPet().
   * - Pets in runtime but not in layout → remove.
   * - Pets in both → keep existing runtime state (position, FSM).
   *
   * Called from constructor and rebuildFromLayout. Always runs AFTER walkableTiles
   * is populated.
   */
  private rebuildPetsFromLayout(layout: OfficeLayout): void {
    const placed = layout.pets ?? [];
    const placedIds = new Set(placed.map((p) => p.id));

    // 1. Remove pets no longer in layout
    this.pets = this.pets.filter((p) => placedIds.has(p.id));

    // 2. Add pets that exist in layout but not in runtime
    const existingIds = new Set(this.pets.map((p) => p.id));
    for (const p of placed) {
      if (existingIds.has(p.id)) continue;
      this.addPet(p); // pushes onto this.pets, calls syncLayoutPets()
    }
    // syncLayoutPets() inside addPet keeps this.layout.pets coherent; one final
    // sync handles the removal-only branch where addPet was never called.
    this.syncLayoutPets();
  }

  /**
   * Re-export the current pet roster into `this.layout.pets`. Called only from
   * mutating methods (addPet / removePet / rebuildPetsFromLayout) — NEVER from
   * getLayout(), which runs on every render frame.
   */
  private syncLayoutPets(): void {
    this.layout.pets = this.pets.map((p) => ({ id: p.id, petType: p.petType }));
  }

  setTeamInfo(
    id: number,
    teamName?: string,
    agentName?: string,
    isTeamLead?: boolean,
    leadAgentId?: number,
    teamUsesTmux?: boolean,
  ): void {
    const ch = this.characters.get(id);
    if (!ch) return;
    const wasUnlinked = ch.leadAgentId === undefined;
    ch.teamName = teamName;
    ch.agentName = agentName;
    ch.isTeamLead = isTeamLead;
    ch.leadAgentId = leadAgentId;
    if (teamUsesTmux !== undefined) {
      ch.teamUsesTmux = teamUsesTmux;
    }
    // A teammate is not a headless agent: clicking it focuses its lead's terminal.
    // Adopted sessions are marked headless at creation and only later discovered
    // to be teammates, so drop the mark once the link lands.
    if (leadAgentId !== undefined) {
      ch.isHeadless = false;
    }
    // A teammate discovered only after its plain external session was adopted is
    // linked here, not at creation, so it never went through the seat-next-to-lead
    // path addAgent runs for inline teammates. Cluster it now, once, on first link.
    if (wasUnlinked && leadAgentId !== undefined && !isTeamLead) {
      this.reseatNextToLead(id, leadAgentId);
    }
  }

  /** Mark an agent as headless (adopted, no terminal to focus). */
  setHeadless(id: number, headless: boolean): void {
    const waiting = this.overflow.find((e) => e.id === id);
    if (waiting) waiting.isHeadless = headless;
    const ch = this.characters.get(id);
    if (!ch) return;
    ch.isHeadless = headless;
  }

  setAgentContext(id: number, contextTokens: number, maxContextTokens: number): void {
    const ch = this.characters.get(id);
    if (!ch) return;
    ch.contextTokens = contextTokens;
    ch.maxContextTokens = maxContextTokens;
  }

  update(dt: number): void {
    // Furniture animation cycling
    const prevFrame = Math.floor(this.furnitureAnimTimer / FURNITURE_ANIM_INTERVAL_SEC);
    this.furnitureAnimTimer += dt;
    const newFrame = Math.floor(this.furnitureAnimTimer / FURNITURE_ANIM_INTERVAL_SEC);
    if (newFrame !== prevFrame) {
      this.rebuildFurnitureInstances();
    }

    // The greeter materializes and dematerializes like anyone else, but runs
    // no FSM — it stands where it spawned for as long as the ask is up.
    if (this.greeter && advanceMatrixEffect(this.greeter, dt) === 'despawned') {
      this.greeter = null;
    }

    const toDelete: number[] = [];
    for (const ch of this.characters.values()) {
      const effect = advanceMatrixEffect(ch, dt);
      if (effect !== 'none') {
        if (effect === 'despawned') toDelete.push(ch.id);
        continue; // skip normal FSM while the effect is (or just was) active
      }

      // Temporarily unblock own seats (work + rest) so the character can path to them
      this.withOwnSeatUnblocked(ch, () =>
        updateCharacter(ch, dt, this.seats, this.tileMap, this.blockedTiles),
      );

      // Tick bubble timer for waiting bubbles
      if (ch.bubbleType === 'waiting') {
        ch.bubbleTimer -= dt;
        if (ch.bubbleTimer <= 0) {
          ch.bubbleType = null;
          ch.bubbleTimer = 0;
        }
      }
    }
    // Remove characters that finished despawn; their seats go to the overflow queue
    for (const id of toDelete) {
      this.releaseSeats(this.characters.get(id)!);
      this.characters.delete(id);
    }
    if (toDelete.length > 0) this.promoteOverflow();

    // ── Pet FSM ────────────────────────────────────────────────
    for (const pet of this.pets) {
      updatePet(pet, dt, this.walkableTiles, this.characters, this.tileMap, this.blockedTiles);

      // Tick heart bubble timer (mirrors character waiting-bubble pattern)
      if (pet.bubbleType) {
        pet.bubbleTimer -= dt;
        if (pet.bubbleTimer <= 0) {
          pet.bubbleType = null;
          pet.bubbleTimer = 0;
        }
      }
    }
  }

  /** The `saveAgentSeats` payload: palette, hue, work seat and rest seat for
   *  every agent worth restoring (overflow agents with null seats). Sub-agents
   *  are excluded because they are derived state the runtime re-materializes,
   *  and the greeter never reaches here at all — it is not in `characters`. */
  getPersistableSeats(): Record<number, PersistedSeat> {
    const seats: Record<number, PersistedSeat> = {};
    for (const ch of this.characters.values()) {
      if (ch.isSubagent) continue;
      seats[ch.id] = {
        palette: ch.palette,
        hueShift: ch.hueShift,
        seatId: ch.seatId,
        restSeatId: ch.restSeatId,
      };
    }
    for (const e of this.overflow) {
      if (e.parentAgentId !== undefined) continue;
      seats[e.id] = { palette: e.palette, hueShift: e.hueShift, seatId: null, restSeatId: null };
    }
    return seats;
  }

  /** Everything the renderer draws: the agents plus, while the first-run ask
   *  is up, the consent greeter. This is the ONE place the greeter joins the
   *  agents — every other consumer reads `characters` and gets agents only. */
  getCharacters(): Character[] {
    const chars = Array.from(this.characters.values());
    if (this.greeter) chars.push(this.greeter);
    return chars;
  }

  /** Get character at pixel position (for hit testing). Returns id or null.
   *  Agents only: clicks pass straight through the consent greeter, which is
   *  a prop, not something to select or follow. */
  getCharacterAt(worldX: number, worldY: number): number | null {
    const chars = Array.from(this.characters.values()).sort((a, b) => b.y - a.y);
    for (const ch of chars) {
      // Skip characters that are despawning
      if (ch.matrixEffect === 'despawn') continue;
      // Character sprite is 16x24, anchored bottom-center
      // Apply sitting offset to match visual position
      const sittingOffset =
        ch.state === CharacterState.TYPE || ch.state === CharacterState.REST
          ? CHARACTER_SITTING_OFFSET_PX
          : 0;
      const anchorY = ch.y + sittingOffset;
      const left = ch.x - CHARACTER_HIT_HALF_WIDTH;
      const right = ch.x + CHARACTER_HIT_HALF_WIDTH;
      const top = anchorY - CHARACTER_HIT_HEIGHT;
      const bottom = anchorY;
      if (worldX >= left && worldX <= right && worldY >= top && worldY <= bottom) {
        return ch.id;
      }
    }
    return null;
  }
}
