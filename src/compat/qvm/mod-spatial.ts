// SPDX-License-Identifier: GPL-2.0-or-later
import type { ActorId } from "../../contracts/identity.ts";
import type { Vec3 } from "../../contracts/math.ts";
import type { ModHostServices } from "../../world/session/mods.ts";
import { Q3_BINARY32_PROFILE } from "../../core/numeric.ts";
import { createBoxModel, createCapsuleModel } from "../../world/collision/q3/model.ts";
import type { borrowQvmSharedEntity } from "./shared-entity-record.ts";
import { QvmGameImport } from "./abi.ts";
import type { QvmHostCall } from "./syscalls.ts";
import { writeQvmTrace, QVM_TRACE_BYTES } from "./trace-record.ts";

export interface QvmSpatialHost {
  readonly services: ModHostServices;
  actorAt(slot: number): ActorId | null;
  entitySlot(actor: ActorId): number;
  pointerSlot(pointer: number): number;
  entity(slot: number): ReturnType<typeof borrowQvmSharedEntity>;
}

export function qvmSpatialSyscall(call: QvmHostCall, host: QvmSpatialHost): number | null {
  if (call.kind !== "engine" || call.role !== "qagame") return null;
  const word = (index: number) => call.words.getInt32(index * 4, true), vector = (address: number): Vec3 => {
    const data = call.guest.view(address, 12); return { x: data.getFloat32(0, true), y: data.getFloat32(4, true), z: data.getFloat32(8, true) }; };
  const scene = host.services.engine?.scene;
  if (call.code === QvmGameImport.G_ENTITIES_IN_BOX) {
    const query = host.services.engine?.areaEntities; if (query === undefined) throw new Error("QVM area queries require destination spatial services");
    const maximum = word(4), found = query({ min: vector(word(1)), max: vector(word(2)) });
    const actors = maximum < 0 ? found : found.slice(0, maximum);
    if (actors.length !== 0) {
      const output = call.guest.view(word(3), actors.length * 4);
      actors.forEach((actor, index) => output.setInt32(index * 4, host.entitySlot(actor), true));
    }
    return actors.length;
  }
  if (call.code === QvmGameImport.G_ENTITY_CONTACT || call.code === QvmGameImport.G_ENTITY_CONTACTCAPSULE) {
    const entity = host.entity(host.pointerSlot(word(3))), model = entity.r.model, bounds = { min: vector(word(1)), max: vector(word(2)) }, zero = { x: 0, y: 0, z: 0 };
    const capsule = call.code === QvmGameImport.G_ENTITY_CONTACTCAPSULE;
    if (model.kind === "inline") {
      if (scene === undefined) throw new Error("QVM entity contact requires destination scene services");
      const result = scene.trace({ start: zero, end: zero, shape: { kind: capsule ? "capsule" : "box", bounds },
        target: { kind: "model", model: model.index, origin: entity.r.currentOrigin, angles: entity.r.currentAngles }, passActor: null,
        numeric: Q3_BINARY32_PROFILE, policy: { kind: "q3", contentsMask: -1, curves: true, playerCurveClip: true } });
      return Number(result.startSolid || result.allSolid);
    }
    const target = { min: entity.r.mins, max: entity.r.maxs }, temporary = model.kind === "capsule" ? createCapsuleModel(target) : createBoxModel(target);
    const result = temporary.transformedTraceSource({ start: zero, end: zero, mask: -1,
      shape: { kind: capsule ? "capsule" : "box", mins: bounds.min, maxs: bounds.max } }, entity.r.currentOrigin, entity.r.currentAngles);
    return Number(result.startSolid || result.allSolid);
  }
  if (call.code === QvmGameImport.G_TRACE || call.code === QvmGameImport.G_TRACECAPSULE) {
    if (scene === undefined) throw new Error("QVM trace requires destination scene services");
    const bounds = { min: word(3) === 0 ? { x: 0, y: 0, z: 0 } : vector(word(3)), max: word(4) === 0 ? { x: 0, y: 0, z: 0 } : vector(word(4)) };
    const result = scene.trace({ start: vector(word(2)), end: vector(word(5)), shape: { kind: call.code === QvmGameImport.G_TRACECAPSULE ? "capsule" : "box", bounds },
      target: { kind: "world" }, passActor: host.actorAt(word(6)), numeric: Q3_BINARY32_PROFILE, policy: { kind: "q3", contentsMask: word(7), curves: true, playerCurveClip: true } });
    if (result.kind !== "q3") throw new Error("QVM trace lost its source collision policy");
    writeQvmTrace(call.guest.view(word(1), QVM_TRACE_BYTES), { ...result, plane: result.sourcePlane, entityNum: result.hit.kind === "actor" ? host.entitySlot(result.hit.actor) : result.fraction === 1 ? 1023 : 1022 }); return 0;
  }
  if (call.code === QvmGameImport.G_POINT_CONTENTS) {
    if (scene === undefined) throw new Error("QVM point contents requires destination scene services");
    const result = scene.pointContents({ point: vector(word(1)), target: { kind: "world" }, passActor: host.actorAt(word(2)), numeric: Q3_BINARY32_PROFILE,
      policy: { kind: "q3", contentsMask: -1, curves: true, playerCurveClip: true } });
    if (result.kind !== "q3") throw new Error("QVM contents lost its source policy"); return result.contents;
  }
  return null;
}
