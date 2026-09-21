// Q3 botlib VM records, derived from id Software and quake-3-ts. GPL-2.0-or-later.
import type { Vec3 } from "../../contracts/math.ts";
import type { BotGoal } from "../../bots/behavior/library/goals.ts";
import type { BotInitMove, BotMoveResult } from "../../bots/behavior/q3/movement-state.ts";
import { BinaryError } from "../../core/binary/index.ts";
type MovementTarget = { value: Vec3 };
export interface BotEntityUpdate {
  readonly type: number;
  readonly flags: number;
  readonly origin: Vec3;
  readonly angles: Vec3;
  readonly oldOrigin: Vec3;
  readonly mins: Vec3;
  readonly maxs: Vec3;
  readonly groundEntity: number;
  readonly solid: number;
  readonly modelIndex: number;
  readonly modelIndex2: number;
  readonly frame: number;
  readonly event: number;
  readonly eventParameter: number;
  readonly powerups: number;
  readonly weapon: number;
  readonly legsAnimation: number;
  readonly torsoAnimation: number;
}

export interface AasEntityInfo extends BotEntityUpdate {
  readonly valid: boolean;
  readonly number: number;
  readonly lastVisibleOrigin: Vec3;
  readonly lastUpdateTime: number;
  readonly updateInterval: number;
}

export const QVM_BOT_GOAL_BYTES = 56;

function referenceField(pointer: () => Uint8Array | null, offset: number): DataView {
  const bytes = pointer();
  if (bytes === null) throw new RangeError("QVM bot goal input requires a nonnull pointer");
  if (offset + 4 > bytes.byteLength) throw new RangeError("QVM bot goal input exceeds allocation");
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4);
}

function referenceVector(pointer: () => Uint8Array | null, offset: number): Vec3 {
  return {
    get x(): number { return referenceField(pointer, offset).getFloat32(0, true); },
    get y(): number { return referenceField(pointer, offset + 4).getFloat32(0, true); },
    get z(): number { return referenceField(pointer, offset + 8).getFloat32(0, true); },
  };
}

/** Reads only reached fields and observes writes through overlapping VM pointers. */
export function readQvmBotGoalReference(pointer: () => Uint8Array | null): BotGoal {
  return {
    origin: referenceVector(pointer, 0),
    get area(): number { return referenceField(pointer, 12).getInt32(0, true); },
    mins: referenceVector(pointer, 16),
    maxs: referenceVector(pointer, 28),
    get entity(): number { return referenceField(pointer, 40).getInt32(0, true); },
    get number(): number { return referenceField(pointer, 44).getInt32(0, true); },
    get flags(): number { return referenceField(pointer, 48).getInt32(0, true); },
    get itemInfo(): number { return referenceField(pointer, 52).getInt32(0, true); },
  };
}

function requireGoalRecord(view: DataView, length: number): void {
  if (view.byteLength < length) {
    throw new BinaryError("QVM bot_goal_t", 0,
      `record requires ${length} bytes, received ${view.byteLength}`);
  }
}

function readVector(view: DataView, offset: number): Vec3 {
  return {
    x: view.getFloat32(offset, true),
    y: view.getFloat32(offset + 4, true),
    z: view.getFloat32(offset + 8, true),
  };
}

function writeGoalVector(view: DataView, offset: number, value: Vec3): void {
  view.setFloat32(offset, value.x, true);
  view.setFloat32(offset + 4, value.y, true);
  view.setFloat32(offset + 8, value.z, true);
}

/** Reads an owned goal from an already-resolved source record. */
export function readQvmBotGoal(view: DataView): BotGoal {
  requireGoalRecord(view, QVM_BOT_GOAL_BYTES);
  return {
    origin: readVector(view, 0),
    area: view.getInt32(12, true),
    mins: readVector(view, 16),
    maxs: readVector(view, 28),
    entity: view.getInt32(40, true),
    number: view.getInt32(44, true),
    flags: view.getInt32(48, true),
    itemInfo: view.getInt32(52, true),
  };
}

/** Queries write only their source fields; the remaining bytes are never read. */
export function writeQvmBotGoal(
  view: DataView, goal: BotGoal, fields: "full" | "level-item" | "location" = "full",
): void {
  requireGoalRecord(view, fields === "full" ? QVM_BOT_GOAL_BYTES : fields === "level-item" ? 52 : 44);
  view.setInt32(12, goal.area, true);
  writeGoalVector(view, 0, goal.origin);
  view.setInt32(40, goal.entity, true);
  writeGoalVector(view, 16, goal.mins);
  writeGoalVector(view, 28, goal.maxs);
  if (fields === "location") return;
  view.setInt32(44, goal.number, true);
  view.setInt32(48, goal.flags, true);
  if (fields === "full") view.setInt32(52, goal.itemInfo, true);
}

export const QVM_BOT_INIT_MOVE_BYTES = 68;
export const QVM_BOT_MOVE_RESULT_BYTES = 52;

type Pointer = () => Uint8Array | null;
type FieldView = (bytes: Uint8Array, offset: number) => DataView;

function field(pointer: Pointer, offset: number, view?: FieldView): DataView {
  const bytes = pointer();
  if (bytes === null) throw new RangeError("QVM bot movement requires a nonnull pointer");
  if (offset + 4 > bytes.byteLength) {
    throw new BinaryError("QVM bot movement record", offset,
      `field exceeds ${bytes.byteLength}-byte allocation`);
  }
  return view === undefined ? new DataView(bytes.buffer, bytes.byteOffset + offset, 4) : view(bytes, offset);
}

function movementVector(pointer: Pointer, offset: number): Vec3 {
  return {
    get x(): number { return field(pointer, offset).getFloat32(0, true); },
    get y(): number { return field(pointer, offset + 4).getFloat32(0, true); },
    get z(): number { return field(pointer, offset + 8).getFloat32(0, true); },
  };
}

function writeVector(pointer: Pointer, offset: number, value: Vec3, view: FieldView): void {
  field(pointer, offset, view).setFloat32(0, value.x, true);
  field(pointer, offset + 4, view).setFloat32(0, value.y, true);
  field(pointer, offset + 8, view).setFloat32(0, value.z, true);
}

/** Field reads follow the owning BotInitMoveState handle check and copy order. */
export function qvmBotInitMoveReference(pointer: Pointer): BotInitMove {
  return {
    origin: movementVector(pointer, 0),
    velocity: movementVector(pointer, 12),
    viewOffset: movementVector(pointer, 24),
    get entityNum(): number { return field(pointer, 36).getInt32(0, true); },
    get client(): number { return field(pointer, 40).getInt32(0, true); },
    get thinkTime(): number { return field(pointer, 44).getFloat32(0, true); },
    get presenceType(): number { return field(pointer, 48).getInt32(0, true); },
    viewAngles: movementVector(pointer, 52),
    get orMoveFlags(): number { return field(pointer, 64).getInt32(0, true); },
  };
}

/** The source clears six words before checking the handle, leaving the tail live. */
export function qvmBotMoveResultReference(pointer: Pointer, view: FieldView): BotMoveResult {
  return {
    get failure(): boolean { return field(pointer, 0).getInt32(0, true) !== 0; },
    set failure(value: boolean) { field(pointer, 0, view).setInt32(0, Number(value), true); },
    get type(): number { return field(pointer, 4).getInt32(0, true); },
    set type(value: number) { field(pointer, 4, view).setInt32(0, value, true); },
    get blocked(): boolean { return field(pointer, 8).getInt32(0, true) !== 0; },
    set blocked(value: boolean) { field(pointer, 8, view).setInt32(0, Number(value), true); },
    get blockEntity(): number { return field(pointer, 12).getInt32(0, true); },
    set blockEntity(value: number) { field(pointer, 12, view).setInt32(0, value, true); },
    get travelType(): number { return field(pointer, 16).getInt32(0, true); },
    set travelType(value: number) { field(pointer, 16, view).setInt32(0, value, true); },
    get flags(): number { return field(pointer, 20).getInt32(0, true); },
    set flags(value: number) { field(pointer, 20, view).setInt32(0, value, true); },
    get weapon(): number { return field(pointer, 24).getInt32(0, true); },
    set weapon(value: number) { field(pointer, 24, view).setInt32(0, value, true); },
    get moveDirection(): Vec3 { return movementVector(pointer, 28); },
    set moveDirection(value: Vec3) { writeVector(pointer, 28, value, view); },
    get idealViewAngles(): Vec3 { return movementVector(pointer, 40); },
    set idealViewAngles(value: Vec3) { writeVector(pointer, 40, value, view); },
  };
}

export function qvmBotMovementVector(pointer: Pointer): Vec3 { return movementVector(pointer, 0); }

/** Target writes are visible immediately, including a route query returning false. */
export function qvmBotMovementTarget(pointer: Pointer, view: FieldView): MovementTarget {
  return {
    get value(): Vec3 { return movementVector(pointer, 0); },
    set value(value: Vec3) { writeVector(pointer, 0, value, view); },
  };
}

export const QVM_BOT_ENTITY_STATE_BYTES = 112;

function entityVector(view: DataView, offset: number): Vec3 {
  return { x: view.getFloat32(offset, true), y: view.getFloat32(offset + 4, true), z: view.getFloat32(offset + 8, true) };
}

/** Borrows VM fields so source host callbacks can change later reads in this update. */
export function borrowQvmBotEntityState(view: DataView): BotEntityUpdate {
  if (view.byteLength < QVM_BOT_ENTITY_STATE_BYTES) {
    throw new BinaryError("QVM bot_entitystate_t", 0,
      `record requires ${QVM_BOT_ENTITY_STATE_BYTES} bytes, received ${view.byteLength}`);
  }
  return {
    get type(): number { return view.getInt32(0, true); },
    get flags(): number { return view.getInt32(4, true); },
    get origin(): Vec3 { return entityVector(view, 8); },
    get angles(): Vec3 { return entityVector(view, 20); },
    get oldOrigin(): Vec3 { return entityVector(view, 32); },
    get mins(): Vec3 { return entityVector(view, 44); },
    get maxs(): Vec3 { return entityVector(view, 56); },
    get groundEntity(): number { return view.getInt32(68, true); },
    get solid(): number { return view.getInt32(72, true); },
    get modelIndex(): number { return view.getInt32(76, true); },
    get modelIndex2(): number { return view.getInt32(80, true); },
    get frame(): number { return view.getInt32(84, true); },
    get event(): number { return view.getInt32(88, true); },
    get eventParameter(): number { return view.getInt32(92, true); },
    get powerups(): number { return view.getInt32(96, true); },
    get weapon(): number { return view.getInt32(100, true); },
    get legsAnimation(): number { return view.getInt32(104, true); },
    get torsoAnimation(): number { return view.getInt32(108, true); },
  };
}

/** Detached decoding for records which must outlive the VM call. */
export function readQvmBotEntityState(view: DataView): BotEntityUpdate {
  return { ...borrowQvmBotEntityState(view) };
}

export const QVM_AAS_ENTITY_INFO_BYTES = 140;
export function writeQvmAasEntityInfo(view: DataView, info: AasEntityInfo): void {
  requireGoalRecord(view, QVM_AAS_ENTITY_INFO_BYTES);
  view.setInt32(0, Number(info.valid), true);
  view.setInt32(4, info.type, true);
  view.setInt32(8, info.flags, true);
  view.setFloat32(12, info.lastUpdateTime, true);
  view.setFloat32(16, info.updateInterval, true);
  view.setInt32(20, info.number, true);
  writeGoalVector(view, 24, info.origin);
  writeGoalVector(view, 36, info.angles);
  writeGoalVector(view, 48, info.oldOrigin);
  writeGoalVector(view, 60, info.lastVisibleOrigin);
  writeGoalVector(view, 72, info.mins);
  writeGoalVector(view, 84, info.maxs);
  view.setInt32(96, info.groundEntity, true);
  view.setInt32(100, info.solid, true);
  view.setInt32(104, info.modelIndex, true);
  view.setInt32(108, info.modelIndex2, true);
  view.setInt32(112, info.frame, true);
  view.setInt32(116, info.event, true);
  view.setInt32(120, info.eventParameter, true);
  view.setInt32(124, info.powerups, true);
  view.setInt32(128, info.weapon, true);
  view.setInt32(132, info.legsAnimation, true);
  view.setInt32(136, info.torsoAnimation, true);
}

