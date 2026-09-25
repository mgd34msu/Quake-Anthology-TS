import type { ActorId } from "../../../contracts/identity.ts";
import type { PresentationOwner } from "../../../contracts/presentation.ts";
import type { ModIdentity } from "../../../contracts/mods.ts";
import type { QvmAbiProfile } from "../../../contracts/execution.ts";
import type { QvmPresentationContext, QvmSceneContext } from "../../../compat/qvm/mod-presentation.ts";
import type { SourceGameStateRecord } from "../../../network/q3/game-state.ts";
import { qvmPlayerStateBytes, readSourceQvmPlayerState, writeSourceQvmPlayerState } from "../../../compat/qvm/player-record.ts";
import { qvmEntityStateBytes, readSourceQvmEntityState, writeSourceQvmEntityState } from "../../../compat/qvm/entity-record.ts";
import { readModIdentity } from "../../../persistence/mods.ts";
import { SaveReader, namespaced } from "../../../persistence/value.ts";
import { actor, wireActor } from "./unified-frame-values.ts";
import type { UnifiedIdentityDecoder } from "./unified-types.ts";

export interface UnifiedComponentIdentity {
  readonly owner: PresentationOwner;
  readonly identity: ModIdentity;
  readonly generation: number;
  readonly abi: QvmAbiProfile;
  readonly runtime: "qvm-scene" | "qvm-player-events";
}
export interface UnifiedComponentPublication extends UnifiedComponentIdentity {
  readonly viewer: ActorId;
  readonly context: Omit<QvmPresentationContext, "frameTimeMilliseconds" | "viewOrigin">;
  readonly bindings: QvmSceneContext["actors"];
}
/** Reliable original configstrings and commands; no locally generated CG_* side effects. */
export interface UnifiedComponentState extends UnifiedComponentIdentity {
  readonly gameStateRevision: number;
  readonly gameState: SourceGameStateRecord | null;
  readonly commandBase: number;
  readonly commands: QvmSceneContext["commands"];
}
export interface UnifiedComponentFrame {
  readonly owner: PresentationOwner;
  readonly generation: number;
  readonly abi: QvmAbiProfile;
  readonly viewer: ActorId;
  readonly clientNumber: number;
  readonly gameStateRevision: number;
  readonly snapshot: QvmPresentationContext["snapshot"];
  readonly weaponPresented: boolean;
  readonly bindings: QvmSceneContext["actors"];
  readonly scene: Omit<QvmSceneContext, "gameState" | "gameStateRevision" | "commands" | "actors" | "baseline"> | null;
}
export interface UnifiedComponentUpdate { readonly revision: number; readonly sources: readonly UnifiedComponentState[]; }
export interface UnifiedComponentFrames { readonly revision: number; readonly sources: readonly UnifiedComponentFrame[]; }

function integer(reader: SaveReader, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  const value = reader.integer(minimum);
  return Number.isSafeInteger(value) && value <= maximum ? value : reader.fail("component integer exceeds its range");
}
export function readComponentOwner(reader: SaveReader): PresentationOwner {
  return { provider: namespaced(reader.field("provider")), generation: integer(reader.field("generation"), 1) };
}
function bytes(reader: SaveReader, length: number): Uint8Array {
  const result = reader.bytes(); return result.length === length ? result : reader.fail("invalid original source record extent");
}
function view(bytes: Uint8Array): DataView { return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }
function encodeRecord(length: number, write: (value: DataView) => void): Uint8Array { const result = new Uint8Array(length); write(view(result)); return result; }
function writeState(value: SourceGameStateRecord) { return { stringOffsets: Array.from(value.stringOffsets), stringData: value.stringData, dataCount: value.dataCount }; }
function readState(reader: SaveReader): SourceGameStateRecord {
  const count = integer(reader.field("dataCount"), 0, 16000), data = bytes(reader.field("stringData"), 16000);
  const offsets = reader.field("stringOffsets").list(offset => integer(offset, 0, Math.max(0, count - 1)));
  if (offsets.length !== 1024 || data[0] !== 0) return reader.fail("invalid original gameState_t");
  for (const offset of offsets) if (offset !== 0 && (data.indexOf(0, offset) < 0 || data.indexOf(0, offset) >= count)) return reader.fail("unterminated original configstring");
  return { stringOffsets: Int32Array.from(offsets), stringData: data, dataCount: count };
}
function readCommands(reader: SaveReader): QvmSceneContext["commands"] {
  const commands = reader.list(value => ({ sequence: integer(value.field("sequence"), 1, 2147483647), arguments: value.field("arguments").list(argument => {
    const text = argument.string(); return text.length <= 8192 && !text.includes("\0") ? text : argument.fail("invalid component command argument");
  }) }));
  if (commands.length > 64 || commands.some((command, index) => command.arguments.length > 128 || index > 0 && command.sequence !== (commands[index - 1]?.sequence ?? 0) + 1))
    return reader.fail("invalid original reliable command window");
  return commands;
}
export function writeComponentUpdate(update: UnifiedComponentUpdate) {
  return { revision: update.revision, sources: update.sources.map(source => ({ ...source, gameState: source.gameState === null ? null : writeState(source.gameState) })) };
}
export function readComponentUpdate(reader: SaveReader): UnifiedComponentUpdate {
  const sources = reader.field("sources").list(source => ({ owner: readComponentOwner(source.field("owner")), identity: readModIdentity(source.field("identity")),
    generation: integer(source.field("generation"), 0), abi: source.field("abi").choice("q3-modern", "q3-1.16n-base"),
    runtime: source.field("runtime").choice("qvm-scene", "qvm-player-events"), gameStateRevision: integer(source.field("gameStateRevision"), 0),
    gameState: source.field("gameState").nullable(readState), commandBase: integer(source.field("commandBase"), 0, 2147483647), commands: readCommands(source.field("commands")) }));
  if (sources.length > 256 || new Set(sources.map(source => source.owner.provider)).size !== sources.length) return reader.fail("invalid component owner set");
  return { revision: integer(reader.field("revision"), 1), sources };
}
export function writeComponentFrames(frames: UnifiedComponentFrames) {
  return { revision: frames.revision, sources: frames.sources.map(source => {
    const playerState = encodeRecord(qvmPlayerStateBytes(source.abi), value => writeSourceQvmPlayerState(value, source.snapshot.playerState, source.abi));
    return { ...source, viewer: wireActor(source.viewer), snapshot: { serverTime: source.snapshot.serverTime, playerState },
      bindings: source.bindings.map(binding => ({ ...binding, actor: wireActor(binding.actor) })),
      scene: source.scene === null ? null : { revision: source.scene.revision, snapshot: { ...source.scene.snapshot, playerState,
        entities: source.scene.snapshot.entities.map(entity => encodeRecord(qvmEntityStateBytes(source.abi), value => writeSourceQvmEntityState(value, entity, source.abi))) } } };
  }) };
}
export function readComponentFrames(reader: SaveReader, identity: UnifiedIdentityDecoder): UnifiedComponentFrames {
  const sources = reader.field("sources").list(source => {
    const abi = source.field("abi").choice("q3-modern", "q3-1.16n-base"), snapshot = source.field("snapshot");
    const playerState = readSourceQvmPlayerState(view(bytes(snapshot.field("playerState"), qvmPlayerStateBytes(abi))), abi);
    const bindings = source.field("bindings").list(binding => ({ actor: actor(binding.field("actor"), identity), slot: integer(binding.field("slot"), 0, 1023), owned: binding.field("owned").boolean() }));
    if (bindings.length > 1024 || new Set(bindings.map(binding => binding.slot)).size !== bindings.length) return source.fail("duplicate source actor slots");
    const scene = source.field("scene").nullable(value => {
      const state = value.field("snapshot"), entities = state.field("entities").list(entity => readSourceQvmEntityState(view(bytes(entity, qvmEntityStateBytes(abi))), abi));
      if (entities.length > 256 || new Set(entities.map(entity => entity.number)).size !== entities.length) return value.fail("invalid visible source entity set");
      return { revision: integer(value.field("revision"), 0), snapshot: { serverTime: integer(state.field("serverTime"), 0, 2147483647), flags: integer(state.field("flags"), 0, 255),
        areaMask: bytes(state.field("areaMask"), 32), playerState, entities, serverCommandSequence: integer(state.field("serverCommandSequence"), 0, 2147483647) } };
    });
    return { owner: readComponentOwner(source.field("owner")), generation: integer(source.field("generation"), 0), abi, viewer: actor(source.field("viewer"), identity), clientNumber: integer(source.field("clientNumber"), 0, 1023),
      gameStateRevision: integer(source.field("gameStateRevision"), 0), snapshot: { serverTime: integer(snapshot.field("serverTime"), 0, 2147483647), playerState },
      weaponPresented: source.field("weaponPresented").boolean(), bindings, scene };
  });
  if (sources.length > 256 || new Set(sources.map(source => source.owner.provider)).size !== sources.length) return reader.fail("invalid component frame owner set");
  return { revision: integer(reader.field("revision"), 0), sources };
}
