import type { QvmModScenePublication } from "../../world/session/mod-presentations.ts";
import type { SavedActorId } from "../../contracts/session.ts";
import type { ActorId } from "../../contracts/identity.ts";
import { savedActorId, readSavedActor } from "../../persistence/save-image.ts";
import { readBounds } from "../../persistence/shared.ts";
import { writeSourceQvmPlayerState } from "./player-record.ts";
import { writeSourceQvmEntityState } from "./entity-record.ts";
import { QvmMemory } from "./memory.ts";
import type { QvmAbiProfile } from "../../contracts/execution.ts";
import { SaveReader } from "../../persistence/value.ts";
import type { SourceGameStateRecord } from "../../network/q3/game-state.ts";
import { readSourceQvmPlayerState, qvmPlayerStateBytes } from "./player-record.ts";
import { readSourceQvmEntityState, qvmEntityStateBytes } from "./entity-record.ts";
import { qvmSnapshotBytes, writeSourceQvmSnapshot, type QvmSourceSnapshot } from "./client-state-record.ts";

export function capturePresentationGameState(state: SourceGameStateRecord) {
  return { stringOffsets: Array.from(state.stringOffsets), stringData: state.stringData.slice(), dataCount: state.dataCount };
}
export function readPresentationGameState(r: SaveReader): SourceGameStateRecord {
  const offsets = Int32Array.from(r.field("stringOffsets").list(item => item.integer(0)));
  const data = r.field("stringData").bytes().slice(), count = r.field("dataCount").integer(0);
  if (offsets.length !== 1024 || data.length !== 16000 || count > 16000 || offsets.some(offset => offset >= Math.max(1, count))) r.fail("invalid source gameState extent");
  return { stringOffsets: offsets, stringData: data, dataCount: count };
}
export function capturePresentationSnapshot(snapshot: QvmSourceSnapshot, profile: QvmAbiProfile) {
  const size = qvmSnapshotBytes(profile), memory = new QvmMemory(new Uint8Array(2 ** Math.ceil(Math.log2(size))));
  const bytes = memory.bytes.subarray(0, size);
  writeSourceQvmSnapshot(memory, memory.dataView(0, bytes.length), snapshot, profile);
  return { number: snapshot.number, bytes };
}
export function readPresentationSnapshot(r: SaveReader, profile: QvmAbiProfile): QvmSourceSnapshot {
  const number = r.field("number").integer(0), bytes = r.field("bytes").bytes().slice();
  if (bytes.length !== qvmSnapshotBytes(profile)) r.fail("invalid source snapshot extent");
  const view = new DataView(bytes.buffer), playerSize = qvmPlayerStateBytes(profile), entitySize = qvmEntityStateBytes(profile);
  const count = view.getInt32(44 + playerSize, true);
  if (count < 0 || count > 256) r.fail("invalid source snapshot entity count");
  return { number, serverTime: view.getInt32(8, true), flags: view.getInt32(0, true), areaMask: bytes.slice(12, 44),
    playerState: readSourceQvmPlayerState(new DataView(bytes.buffer, 44, playerSize), profile),
    entities: Array.from({ length: count }, (_, index) => readSourceQvmEntityState(new DataView(bytes.buffer, 48 + playerSize + index * entitySize, entitySize), profile)),
    serverCommandSequence: view.getInt32(bytes.length - 4, true) };
}

export function captureSceneContext(scene: import("./mod-presentation.ts").QvmSceneContext, profile: QvmAbiProfile): unknown {
  return { revision: scene.revision, gameState: capturePresentationGameState(scene.gameState), gameStateRevision: scene.gameStateRevision,
    snapshot: capturePresentationSnapshot({ ...scene.snapshot, number: 0 }, profile),
    actors: scene.actors.map(row => ({ ...row, actor: { slot: row.actor.slot, generation: row.actor.generation } })),
    commands: scene.commands, baseline: scene.baseline === undefined ? null : captureSceneContext(scene.baseline, profile) };
}
export function readSceneContext(r: SaveReader, profile: QvmAbiProfile, resolve: (saved: import("../../contracts/session.ts").SavedActorId) => import("../../contracts/identity.ts").ActorId, depth = 0): import("./mod-presentation.ts").QvmSceneContext {
  if (depth > 1) r.fail("nested scene baseline");
  const baseline = r.field("baseline").nullable(v => readSceneContext(v, profile, resolve, depth + 1));
  return { revision: r.field("revision").integer(0), gameState: readPresentationGameState(r.field("gameState")), gameStateRevision: r.field("gameStateRevision").integer(0),
    snapshot: readPresentationSnapshot(r.field("snapshot"), profile),
    actors: r.field("actors").list(row => ({ slot: row.field("slot").integer(0), owned: row.field("owned").boolean(),
      actor: resolve({ slot: row.field("actor").field("slot").integer(0), generation: row.field("actor").field("generation").integer(0) }) })),
    commands: r.field("commands").list(row => ({ sequence: row.field("sequence").integer(0), arguments: row.field("arguments").list(v => v.string()) })),
    ...(baseline === null ? {} : { baseline }) };
}

export function captureModScenePublication(scene: QvmModScenePublication, profile: QvmAbiProfile) {
  return { revision: scene.revision, serverTime: scene.serverTime, gameStateRevision: scene.gameStateRevision,
    gameState: capturePresentationGameState(scene.gameState),
    clients: scene.clients.map(row => { const state = new Uint8Array(qvmPlayerStateBytes(profile)); writeSourceQvmPlayerState(new DataView(state.buffer), row.state, profile);
      return { actor: savedActorId(row.actor), slot: row.slot, state }; }),
    entities: scene.entities.map(row => { const state = new Uint8Array(qvmEntityStateBytes(profile)); writeSourceQvmEntityState(new DataView(state.buffer), row.state, profile);
      return { ...row, actor: savedActorId(row.actor), state }; }),
    commands: scene.commands.map(command => ({ ...command, recipient: command.recipient === null ? null : savedActorId(command.recipient) })) };
}
export function readModScenePublication(r: SaveReader, profile: QvmAbiProfile, resolve: (saved: SavedActorId) => ActorId): QvmModScenePublication {
  return { revision: r.field("revision").integer(0), serverTime: r.field("serverTime").integer(0), gameStateRevision: r.field("gameStateRevision").integer(0),
    gameState: readPresentationGameState(r.field("gameState")),
    clients: r.field("clients").list(row => { const state = row.field("state").bytes();
      if (state.length !== qvmPlayerStateBytes(profile)) row.fail("invalid source player bytes");
      return { actor: resolve(readSavedActor(row.field("actor"))), slot: row.field("slot").integer(0),
        state: readSourceQvmPlayerState(new DataView(state.buffer, state.byteOffset, state.byteLength), profile) }; }),
    entities: r.field("entities").list(row => { const state = row.field("state").bytes();
      if (state.length !== qvmEntityStateBytes(profile)) row.fail("invalid source entity bytes");
      return { actor: resolve(readSavedActor(row.field("actor"))), owned: row.field("owned").boolean(), linked: row.field("linked").boolean(),
        serverFlags: row.field("serverFlags").integer(), singleClient: row.field("singleClient").integer(), bounds: readBounds(row.field("bounds")),
        state: readSourceQvmEntityState(new DataView(state.buffer, state.byteOffset, state.byteLength), profile) }; }),
    commands: r.field("commands").list(row => ({ sequence: row.field("sequence").integer(0), text: row.field("text").string(),
      recipient: row.field("recipient").nullable(v => resolve(readSavedActor(v))) })) };
}
