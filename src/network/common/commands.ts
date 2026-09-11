import type { ArsenalIntent, ItemId } from "../../contracts/gameplay.ts";
import type { ActorId, ProviderId } from "../../contracts/identity.ts";
import type { Vec3 } from "../../contracts/math.ts";
import type { UserCommand } from "../../contracts/protocol.ts";
import type { ActorCommand, CommandSource } from "../../contracts/session.ts";
import { BinaryReader, BinaryWriter } from "../../core/binary/index.ts";

export interface UnifiedCommandActor {
  readonly actor: ActorId;
  readonly movement: UserCommand["kind"];
  readonly arsenal: ProviderId;
}
export interface UnifiedCommandReceiver {
  /** Comes from the authenticated connection or seat, never from packet bytes. */
  readonly source: CommandSource;
  /** Returns only a current actor controlled by this receiver's authenticated source. */
  resolveControlledActor(slot: number, generation: number): UnifiedCommandActor | null;
}

const names: readonly UserCommand["kind"][] = ["q1-netquake", "q1-quakeworld", "q2-classic", "q2-rerelease", "q3"];
const encoder = new TextEncoder(), decoder = new TextDecoder("utf-8", { fatal: true });

function identifier(value: string): ItemId {
  const colon = value.indexOf(":");
  if (colon < 1 || colon === value.length - 1 || value.includes("\0")) throw new Error("Unified command identifier must have a namespace and name");
  return `${value.slice(0, colon)}:${value.slice(colon + 1)}`;
}
function stringBytes(value: string): Uint8Array {
  identifier(value);
  const bytes = encoder.encode(value);
  if (bytes.length > 65535) throw new RangeError("Unified command identifier is too long");
  return bytes;
}
function number(reader: BinaryReader): number {
  const value = reader.f64();
  if (!Number.isFinite(value)) throw new RangeError("Unified command contains a non-finite number");
  return value;
}
function vector(reader: BinaryReader): Vec3 { return { x: number(reader), y: number(reader), z: number(reader) }; }
function fields(command: UserCommand): readonly number[] {
  switch (command.kind) {
    case "q1-netquake": return [command.acknowledgedServerTimeSeconds, command.viewAngles.x, command.viewAngles.y, command.viewAngles.z,
      command.forwardMove, command.sideMove, command.upMove, command.buttons, command.impulse];
    case "q1-quakeworld": return [command.milliseconds, command.angles.x, command.angles.y, command.angles.z,
      command.forwardMove, command.sideMove, command.upMove, command.buttons, command.impulse];
    case "q2-classic": return [command.milliseconds, ...command.angleShorts, command.forwardMove, command.sideMove,
      command.upMove, command.buttons, command.impulse, command.lightLevel];
    case "q2-rerelease": return [command.milliseconds, command.angles.x, command.angles.y, command.angles.z,
      command.forwardMove, command.sideMove, command.buttons, command.serverFrame];
    case "q3": return [command.serverTimeMilliseconds, ...command.angleWords, command.buttons, command.weapon,
      command.forwardMove, command.rightMove, command.upMove];
  }
}
function movement(reader: BinaryReader): UserCommand {
  const kind = names[reader.u8()];
  switch (kind) {
    case "q1-netquake": return { kind, acknowledgedServerTimeSeconds: number(reader), viewAngles: vector(reader), forwardMove: number(reader),
      sideMove: number(reader), upMove: number(reader), buttons: number(reader), impulse: number(reader) };
    case "q1-quakeworld": return { kind, milliseconds: number(reader), angles: vector(reader), forwardMove: number(reader),
      sideMove: number(reader), upMove: number(reader), buttons: number(reader), impulse: number(reader) };
    case "q2-classic": return { kind, milliseconds: number(reader), angleShorts: [number(reader), number(reader), number(reader)],
      forwardMove: number(reader), sideMove: number(reader), upMove: number(reader), buttons: number(reader), impulse: number(reader), lightLevel: number(reader) };
    case "q2-rerelease": return { kind, milliseconds: number(reader), angles: vector(reader), forwardMove: number(reader),
      sideMove: number(reader), buttons: number(reader), serverFrame: number(reader) };
    case "q3": return { kind, serverTimeMilliseconds: number(reader), angleWords: [number(reader), number(reader), number(reader)],
      buttons: number(reader), weapon: number(reader), forwardMove: number(reader), rightMove: number(reader), upMove: number(reader) };
    default: throw new Error("Unknown unified movement command dialect");
  }
}

/** Version 1 preserves numeric values exactly; the selected provider performs its own source rounding. */
export function encodeUnifiedActorCommand(input: ActorCommand): Uint8Array {
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 0) throw new RangeError("Unified command sequence must be a nonnegative safe integer");
  const values = fields(input.command), intent = input.arsenal;
  const provider = intent === undefined ? null : stringBytes(intent.provider), weapon = intent?.weapon == null ? null : stringBytes(intent.weapon);
  const writer = new BinaryWriter(32 + values.length * 8 + (provider?.length ?? 0) + (weapon?.length ?? 0));
  writer.bytes(encoder.encode("QTCM")); writer.u16(1);
  writer.u32(input.actor.slot); writer.u32(input.actor.generation); writer.f64(input.sequence);
  writer.u8(names.indexOf(input.command.kind));
  for (const value of values) {
    if (!Number.isFinite(value)) throw new RangeError("Unified command contains a non-finite number");
    writer.f64(value);
  }
  writer.u8(intent === undefined ? 0 : 1);
  if (intent !== undefined && provider !== null) {
    writer.u16(provider.length); writer.bytes(provider);
    writer.u8(weapon === null ? 0 : 1);
    if (weapon !== null) { writer.u16(weapon.length); writer.bytes(weapon); }
    writer.u8(intent.useHoldable ? 1 : 0);
  }
  return writer.finish();
}

/** Used only after unified composition admission; this packet is never a source-native move message. */
export function decodeUnifiedActorCommand(bytes: Uint8Array, receiver: UnifiedCommandReceiver): ActorCommand {
  const reader = new BinaryReader(bytes, "unified-command"); reader.expectMagic("QTCM");
  if (reader.u16() !== 1) throw new Error("Unsupported unified command version");
  const slot = reader.u32(), generation = reader.u32(), sequence = number(reader);
  if (!Number.isSafeInteger(sequence) || sequence < 0) throw new RangeError("Invalid unified command sequence");
  const command = movement(reader), hasIntent = reader.u8();
  let arsenal: ArsenalIntent | undefined;
  if (hasIntent === 1) {
    const provider = identifier(decoder.decode(reader.bytes(reader.u16()))), hasWeapon = reader.u8();
    if (hasWeapon !== 0 && hasWeapon !== 1) throw new Error("Invalid unified weapon selection tag");
    const weapon = hasWeapon === 0 ? null : identifier(decoder.decode(reader.bytes(reader.u16()))), useHoldable = reader.u8();
    if (useHoldable !== 0 && useHoldable !== 1) throw new Error("Invalid unified holdable state");
    arsenal = { provider, weapon, useHoldable: useHoldable === 1 };
  } else if (hasIntent !== 0) throw new Error("Invalid unified arsenal intent tag");
  if (reader.remaining !== 0) throw new Error("Trailing unified command bytes");
  const controlled = receiver.resolveControlledActor(slot, generation);
  if (controlled === null || controlled.actor.slot !== slot || controlled.actor.generation !== generation)
    throw new Error("Unified command actor is stale or not controlled by this source");
  const source = receiver.source;
  if (source.kind !== "bot" && controlled.actor.session !== source.client.session
    || source.kind === "local-seat" && controlled.actor.session !== source.seat.session) throw new Error("Unified command source belongs to another session");
  if (command.kind !== controlled.movement) throw new Error("Unified movement dialect differs from the selected actor provider");
  if (arsenal !== undefined && arsenal.provider !== controlled.arsenal) throw new Error("Unified arsenal intent belongs to another provider");
  return { actor: controlled.actor, source, sequence, command, ...(arsenal === undefined ? {} : { arsenal }) };
}
