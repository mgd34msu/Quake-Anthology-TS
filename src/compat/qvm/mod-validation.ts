// SPDX-License-Identifier: GPL-2.0-or-later
import { modCallbackInputs } from "../../world/session/mod-callback-inputs.ts";
import { validateModClientOutputs } from "../../world/session/mod-client-outputs.ts";
import { validateQvmObjectiveAddress } from "./mod-objectives.ts";
import { validateSourceMatchField } from "../../contracts/source-match.ts";
import { qvmActorBootstrap, validateQvmModActorFrame } from "./mod-actor-frame.ts";
import { validateQvmModItems } from "./mod-items.ts";
import { qvmSharedEntityBytes } from "./shared-entity-record.ts";
import type { ModCallbackInput } from "../../contracts/mod-callbacks.ts";
import type { QvmModActorRecord, QvmModCallbackDeclaration, QvmModSourceCall, QvmModValue } from "../../contracts/qvm-mod-callbacks.ts";
import { QvmOpcode, QVM_MAX_PRIVATE_ARGUMENT_WORDS } from "./image.ts";
import { QvmEntityTokens } from "./entity-tokens.ts";
import { qvmPlayerStateBytes } from "./player-record.ts";
import { validateQvmModActors } from "./mod-actors.ts";
import { validateQvmModProtection } from "./mod-protection.ts";
import { validateQvmModPickups } from "./mod-pickups.ts";
import { type Artifact, fieldSize, scalar, shared } from "./mod-fields.ts";

export function validateQvmMod(artifact: Artifact, declaration: QvmModCallbackDeclaration): void {
  if (
    artifact.module.digest !== declaration.program.digest ||
    artifact.module.artifactPath !== declaration.program.path ||
    artifact.role !== "qagame" ||
    (artifact.abiProfile ?? "q3-modern") !== declaration.abiProfile
  )
    throw new Error("Gameplay mod differs from its declared QVM artifact or ABI");
  new QvmEntityTokens(declaration.spawnEntities ?? "");
  const sourceEnd = artifact.image.dataLength + artifact.image.literalLength + artifact.image.bssLength;
  const range = (address: number, size: number): void => {
    if (!Number.isSafeInteger(address) || address < 0 || !Number.isSafeInteger(size) || size < 1 || address + size > sourceEnd)
      throw new Error("QVM mod declaration exceeds source data");
  };
  const records = new Map<string, QvmModActorRecord>(),
    canonical = new Set<string>();
  for (const record of declaration.actorRecords) {
    if (
      records.has(record.id) ||
      record.id.length === 0 ||
      record.address === 0 ||
      record.address % 4 !== 0 ||
      !Number.isSafeInteger(record.stride) ||
      record.stride < 4 ||
      record.stride % 4 !== 0 ||
      !Number.isSafeInteger(record.capacity) ||
      record.capacity < 1 ||
      record.capacity > 1024
    )
      throw new Error("Invalid QVM mod actor array");
    range(record.address, record.stride * record.capacity);
    for (const previous of records.values())
      if (record.address < previous.address + previous.stride * previous.capacity && previous.address < record.address + record.stride * record.capacity)
        throw new Error("Overlapping QVM mod actor arrays");
    records.set(record.id, record);
    const occupied = new Set<number>();
    for (const field of record.fields) {
      if (field.binding === "team" || field.binding === "score") validateSourceMatchField(field);
      const size = fieldSize(field);
      if (!Number.isSafeInteger(field.offset) || field.offset < 0 || field.offset % 4 !== 0 || size < 1 || field.offset + size > record.stride)
        throw new Error("QVM mod actor field exceeds its source record");
      for (let byte = field.offset; byte < field.offset + size; byte++) {
        if (occupied.has(byte)) throw new Error("Overlapping QVM mod actor fields");
        occupied.add(byte);
      }
      if (field.access !== undefined && !shared(field)) throw new Error("QVM projection direction requires a canonical field");
      if (shared(field) && field.access !== "read-only") {
        const key = field.binding === "inventory" ? `inventory:${field.item}` : field.binding;
        if (canonical.has(key)) throw new Error(`Multiple authoritative QVM mod stores for ${key}`);
        canonical.add(key);
      }
      if (field.binding === "constant") scalar(field.value, field.encoding);
      if (field.binding === "constant-vector") for (const value of [field.value.x, field.value.y, field.value.z]) scalar(value, "float32");
    }
  }
  if (declaration.entityRecord !== null && !records.has(declaration.entityRecord)) throw new Error("Unknown QVM engine entity record");
  const clients = declaration.clients;
  const outputField = (field: { readonly record: string; readonly offset: number }, length: number): void => {
    const record = records.get(field.record);
    if (
      clients === undefined ||
      record === undefined ||
      (!clients.records.includes(record.id) && record.id !== declaration.entityRecord) ||
      !Number.isInteger(field.offset) ||
      field.offset < 0 ||
      field.offset % 4 !== 0 ||
      !record.fields.some(
        value =>
          (value.binding === "private" && value.offset <= field.offset && field.offset + length <= value.offset + value.byteLength) ||
          (length === 12 && (value.binding === "bounds-min" || value.binding === "bounds-max") && value.offset === field.offset),
      )
    )
      throw new Error("QVM client output requires declared private client storage");
  };
  validateModClientOutputs(clients?.outputs ?? [], { scalar: field => outputField(field, 4), vector: field => outputField(field, 12) });
  for (const output of clients?.outputs ?? [])
    if (output.kind === "body-shape") {
      for (const [field, binding] of [
        [output.min, "bounds-min"],
        [output.max, "bounds-max"],
      ] satisfies readonly (readonly [{ readonly record: string; readonly offset: number }, string])[])
        if (!records.get(field.record)?.fields.some(value => value.binding === binding && value.offset === field.offset && value.access !== "read-only"))
          throw new Error("Client body shape must name its writable source mins/maxs");
    }
  if (clients !== undefined) {
    const state = records.get(clients.playerStateRecord),
      entity = declaration.entityRecord === null ? undefined : records.get(declaration.entityRecord);
    if (
      !Number.isSafeInteger(clients.maximum) ||
      clients.maximum < 1 ||
      clients.maximum > 64 ||
      entity === undefined ||
      entity.capacity < clients.maximum ||
      clients.records.includes(entity.id) ||
      new Set(clients.records).size !== clients.records.length ||
      clients.records.some(id => !records.has(id)) ||
      state === undefined ||
      !clients.records.includes(state.id) ||
      state.stride < qvmPlayerStateBytes(declaration.abiProfile) ||
      [...records.values()].some(record => record.capacity < clients.maximum)
    )
      throw new Error("Invalid QVM source client record reservation");
  }
  for (const record of records.values())
    for (const field of record.fields) if (field.binding === "record" && !records.has(field.record)) throw new Error("Unknown linked QVM actor record");
  const checkValue = (value: QvmModValue, available: ReadonlySet<ModCallbackInput>): void => {
    if (value.kind === "address") {
      if (value.value !== 0) range(value.value, 1);
      return;
    }
    if (value.kind === "actor") {
      if (!records.has(value.record) || !available.has(value.input)) throw new Error("Invalid QVM actor argument");
      return;
    }
    if (value.kind === "client") {
      if (clients === undefined || !available.has(value.input)) throw new Error("Invalid QVM client argument");
      return;
    }
    if (value.kind === "time") {
      if (!available.has(value.input)) throw new Error("Unavailable QVM time input");
      return;
    }
    const kind =
      value.value.kind === "input"
        ? ["self", "other", "activator", "attacker", "inflictor"].includes(value.value.name)
          ? "actor"
          : ["point", "direction", "normal", "view-angles"].includes(value.value.name)
            ? "vector"
            : value.value.name === "item"
              ? "string"
              : "float"
        : value.value.kind;
    if (value.value.kind === "input" && !available.has(value.value.name)) throw new Error(`Unavailable QVM callback input ${value.value.name}`);
    if (kind !== (value.kind === "int32" || value.kind === "float32" ? "float" : value.kind))
      throw new Error("QVM callback value has an incompatible representation");
    if (value.value.kind === "float" && (value.kind === "int32" || value.kind === "float32")) scalar(value.value.value, value.kind);
  };
  const checkCall = (call: QvmModSourceCall, available: ReadonlySet<ModCallbackInput>): void => {
    if (artifact.image.instructions[call.entry]?.opcode !== QvmOpcode.OP_ENTER || call.arguments.length > QVM_MAX_PRIVATE_ARGUMENT_WORDS)
      throw new Error("QVM mod callback requires a source function entry and bounded OP_ARG arguments");
    const globals = new Set<number>();
    for (const value of call.arguments) checkValue(value, available);
    for (const global of call.globals) {
      const size = global.value.kind === "vector" ? 12 : 4;
      range(global.address, size);
      if (global.address % 4 !== 0) throw new Error("Unaligned QVM callback global");
      for (let byte = global.address; byte < global.address + size; byte++) {
        if (globals.has(byte)) throw new Error("Overlapping QVM callback globals");
        globals.add(byte);
      }
      checkValue(global.value, available);
    }
  };
  const lifecycle = declaration.sourceActors;
  qvmActorBootstrap(lifecycle?.initialStores ?? [], artifact.image, declaration.actorRecords);
  if (lifecycle?.frame !== undefined) {
    const record = declaration.actorRecords.find(record => record.id === declaration.entityRecord);
    if (record === undefined || lifecycle.update !== null) throw new Error("QVM actor frame requires exclusive original lifecycle ownership");
    validateQvmModActorFrame(lifecycle.frame, artifact.image, record, lifecycle.inuse);
    checkCall(lifecycle.frame.call, new Set(["time", "elapsed"]));
  }
  if (declaration.presentation?.runtime === "qvm-scene") {
    const record = declaration.entityRecord === null ? undefined : records.get(declaration.entityRecord);
    if (clients === undefined || record === undefined || record.stride < qvmSharedEntityBytes(declaration.abiProfile))
      throw new Error("QVM scene presentation requires admitted source clients and the original shared entity prefix");
  }
  if (lifecycle !== undefined) {
    const entity = declaration.entityRecord === null ? undefined : records.get(declaration.entityRecord);
    if (
      entity === undefined ||
      entity.stride < qvmSharedEntityBytes(declaration.abiProfile) ||
      lifecycle.inuse < qvmSharedEntityBytes(declaration.abiProfile) ||
      lifecycle.inuse % 4 !== 0 ||
      lifecycle.inuse + 4 > entity.stride ||
      !Number.isSafeInteger(lifecycle.eventEntityType) ||
      lifecycle.eventEntityType < 0 ||
      lifecycle.release.argument >= QVM_MAX_PRIVATE_ARGUMENT_WORDS ||
      lifecycle.allocate === lifecycle.release.entry ||
      artifact.image.instructions[lifecycle.allocate]?.opcode !== QvmOpcode.OP_ENTER ||
      artifact.image.instructions[lifecycle.release.entry]?.opcode !== QvmOpcode.OP_ENTER
    )
      throw new Error("Invalid QVM source actor lifecycle");
    if (lifecycle.update !== null) checkCall(lifecycle.update, new Set(["self", "time", "elapsed"]));
  }
  for (const objective of declaration.objectives ?? []) {
    for (const address of [objective.state.storage.address, objective.carrier, objective.target])
      if (address !== null) validateQvmObjectiveAddress(sourceEnd, address);
    if (objective.role === "owned" && objective.change !== null) checkCall(objective.change, new Set(["self", "other", "activator", "amount", "time"]));
  }
  for (const item of declaration.items?.definitions ?? [])
    for (const call of [item.actions?.use, item.actions?.drop].filter(call => call !== undefined)) checkCall(call, new Set(["self", "time"]));
  for (const call of declaration.initialize) checkCall(call, new Set(["time"]));
  if (clients !== undefined) for (const call of [...clients.admit, ...clients.userinfo, ...clients.disconnect]) checkCall(call, new Set(["self", "time"]));
  for (const call of clients?.frame ?? []) checkCall(call, new Set(["self", "time", "elapsed"]));
  for (const binding of clients?.input ?? []) {
    for (const call of binding.calls)
      checkCall(call, new Set(["self", "time", "elapsed", "view-angles", "attack", "jump", "impulse", "forward-move", "side-move", "up-move"]));
    if (binding.phase === "before")
      for (const output of binding.outputs ?? []) {
        if (output.kind === "field") continue;
        if (artifact.image.instructions[output.entry]?.opcode !== QvmOpcode.OP_ENTER) throw new Error("QVM input handler requires an original function entry");
        for (const pointer of output.kind === "command" ? [output.actor.pointer, output.command] : [output.actor.pointer])
          if (pointer.kind === "global") range(pointer.address, 4);
        if (output.kind === "handler" && output.returns !== undefined) scalar(output.returns.value, output.returns.encoding);
      }
  }
  if (declaration.combat !== undefined)
    checkCall({ entry: declaration.combat.entry, arguments: [], globals: declaration.combat.globals, returns: "void" }, new Set(["time"]));
  validateQvmModActors(artifact, declaration);
  validateQvmModProtection(declaration);
  if (declaration.items !== undefined) validateQvmModItems(declaration.items, declaration, artifact.image);
  for (const definition of declaration.protection ?? [])
    checkCall(
      definition.absorb,
      new Set(["self", "attacker", "inflictor", "amount", "knockback", "damage-flags", "regular-protection-scale", "point", "direction", "normal", "time"]),
    );
  validateQvmModPickups(declaration);
  for (const rule of declaration.pickups ?? []) {
    const available = new Set<ModCallbackInput>(["self", "other", "item", "time", "pickup-count", "pickup-has-count", "pickup-dropped"]);
    for (const field of rule.context) checkValue(field.value, available);
    if (rule.operation.kind === "gate-then-grant") checkCall(rule.operation.gate, available);
    checkCall(rule.operation.grant, available);
  }
  const ids = new Set<string>();
  for (const call of declaration.callbacks) {
    if (ids.has(call.id) || (call.stage !== "observe" && call.returns === "void")) throw new Error("Duplicate QVM callback or missing source return value");
    ids.add(call.id);
    const available = modCallbackInputs(call);
    checkCall(call, available);
  }
}
