// SPDX-License-Identifier: GPL-2.0-or-later
import type { QvmCheckpoint } from "../../contracts/execution.ts";
import type { QvmModCallbackDeclaration } from "../../contracts/qvm-mod-callbacks.ts";
import { decodeCheckpointValue, SaveReader } from "../../persistence/value.ts";
import { readSavedActor } from "../../persistence/save-image.ts";
import { qvmApi } from "./module.ts";
import { QvmEntityTokens } from "./entity-tokens.ts";
import { readQvmPlayerEvents } from "./mod-player-events.ts";
import { type Artifact, clientRecord } from "./mod-fields.ts";

/** Structural decode of the mod host state shared by validation and restore; nothing here reads the module's data image. */
export function decodeQvmModHostState(bytes: Uint8Array, declaration: QvmModCallbackDeclaration) {
  const reader = new SaveReader(decodeCheckpointValue(bytes)); reader.field("version").literal(1);
  const entityTokens = new QvmEntityTokens(declaration.spawnEntities ?? "");
  entityTokens.restoreSaveState(reader.field("entityTokens").value);
  const commonRecords = declaration.actorRecords.filter(record => !clientRecord(declaration, record));
  const slots = new Set<number>(), actors = new Set<string>(), capacity = commonRecords.length === 0 ? 0 : Math.min(...commonRecords.map(record => record.capacity));
  const nextSlot = reader.field("nextSlot").integer(0);
  if (nextSlot > capacity) throw new Error("Invalid QVM projection allocation cursor");
  const projections = reader.field("projections").list(entry => {
    const actor = readSavedActor(entry.field("actor")), slot = entry.field("slot").integer(0), owned = entry.field("owned").boolean(), key = `${actor.slot}:${actor.generation}`;
    if ((owned ? declaration.sourceActors === undefined || slot >= (declaration.actorRecords.find(record => record.id === declaration.entityRecord)?.capacity ?? 0) : slot >= nextSlot) || slots.has(slot) || actors.has(key)) throw new Error("Invalid saved QVM actor projection");
    slots.add(slot); actors.add(key); const event = entry.field("event").nullable(value => value.string()); return { actor, slot, owned, event };
  });
  const clientSlots = reader.field("clientSlots").value === undefined ? [] : reader.field("clientSlots").list(entry => ({ actor: readSavedActor(entry.field("actor")), slot: entry.field("slot").integer(0), admitted: entry.field("admitted").boolean() }));
  const reserved = declaration.clients?.maximum ?? 0, occupiedClients = new Set<number>();
  for (const entry of clientSlots) {
    if (entry.slot >= reserved || occupiedClients.has(entry.slot) || !projections.some(projection => !projection.owned && projection.slot === entry.slot
      && projection.actor.slot === entry.actor.slot && projection.actor.generation === entry.actor.generation)) throw new Error("Invalid QVM saved source client mapping");
    occupiedClients.add(entry.slot);
  }
  if (projections.some(entry => entry.slot < reserved && !occupiedClients.has(entry.slot))) throw new Error("QVM saved actor occupies a reserved client row");
  const playerEvents = readQvmPlayerEvents(reader.field("playerEvents"));
  if (playerEvents !== null && playerEvents.clients.length !== clientSlots.length) throw new Error("Saved QVM player event cursors differ from source clients");
  const defaults = reader.field("defaults").list(entry => entry).map((entry, index) => {
    const record = declaration.actorRecords[index]; if (record === undefined) throw new Error("Unexpected QVM actor template");
    const id = entry.field("id").literal(record.id), bytes = entry.field("bytes").bytes();
    if (bytes.length !== record.stride * record.capacity) throw new Error("QVM actor template differs from its source layout");
    return { id, bytes };
  });
  if (defaults.length !== declaration.actorRecords.length) throw new Error("Missing QVM actor templates");
  const configstrings = reader.field("configstrings").list(entry => ({ index: entry.field("index").integer(0), value: entry.field("value").string() }));
  if (new Set(configstrings.map(entry => entry.index)).size !== configstrings.length || configstrings.some(entry => entry.index >= 1024)) throw new Error("Invalid QVM configstrings");
  return { reader, projections, clientSlots, nextSlot, defaults, configstrings, playerEvents, cvars: reader.field("cvars").value, files: reader.field("files").value };
}

export function hostImage(checkpoint: QvmCheckpoint, declaration: QvmModCallbackDeclaration) {
  if (checkpoint.hostState.format !== "qvm:mod-host-v1" || checkpoint.random.length !== 0 || checkpoint.callbacks.length !== 0) throw new Error("Invalid QVM mod host checkpoint");
  const image = decodeQvmModHostState(checkpoint.hostState.bytes, declaration), { playerEvents, clientSlots } = image;
  if (playerEvents !== null) {
    const record = declaration.actorRecords.find(record => record.id === declaration.clients?.playerStateRecord);
    for (const cursor of playerEvents.clients) {
      const client = clientSlots.find(entry => entry.actor.slot === cursor.actor.slot && entry.actor.generation === cursor.actor.generation);
      if (client === undefined || record === undefined || new DataView(checkpoint.data.buffer, checkpoint.data.byteOffset).getInt32(record.address + client.slot * record.stride + 108, true) !== cursor.observedSequence)
        throw new Error("Saved QVM player event cursor differs from its source client");
    }
  }
  return image;
}
export function validateQvmModCheckpoint(artifact: Artifact, declaration: QvmModCallbackDeclaration, checkpoint: QvmCheckpoint): void {
  const module = artifact.module, api = qvmApi("qagame", declaration.abiProfile);
  if (checkpoint.module.id !== module.id || checkpoint.module.digest !== module.digest || checkpoint.module.artifactPath !== module.artifactPath
    || checkpoint.module.revision !== module.revision || checkpoint.data.length !== artifact.image.allocatedDataLength
    || checkpoint.api.kind !== api.kind || checkpoint.api.version !== api.version || (checkpoint.abiProfile ?? "q3-modern") !== declaration.abiProfile
    || checkpoint.instructionIndex !== 0 || checkpoint.operandStack.length !== 0 || checkpoint.programStack !== checkpoint.data.length
    || checkpoint.hostState.module.id !== module.id || checkpoint.hostState.module.digest !== module.digest
    || checkpoint.hostState.module.revision !== module.revision || checkpoint.hostState.module.artifactPath !== module.artifactPath)
    throw new Error("Incompatible QVM gameplay mod checkpoint");
  hostImage(checkpoint, declaration);
}
