import type { QvmAbiProfile } from "../../contracts/execution.ts";
// Port of id Software's code/game/g_public.h sharedEntity_t and
// code/server/sv_world.c SV_ClipHandleForEntity. GPL-2.0-or-later.
// Copyright (C) 1999-2005 Id Software, Inc.
import { BinaryError } from "../../core/binary/index.ts";
import type { Vec3 } from "../../core/math.ts";
import type { QvmEntityState } from "./entity-record.ts";
import { borrowQvmEntityState } from "./entity-record.ts";

// The pinned g_public.h includes an unused entityState_t at r.s, bytes 208..415.
export const QVM_SHARED_ENTITY_BYTES = 516;
export function qvmSharedEntityBytes(profile: QvmAbiProfile): number { return profile === "q3-modern" ? 516 : 504; }
const SVF_CAPSULE = 0x00000400;

function readVector(view: DataView, offset: number): Vec3 {
  return {
    x: view.getFloat32(offset, true),
    y: view.getFloat32(offset + 4, true),
    z: view.getFloat32(offset + 8, true),
  };
}

function writeVector(view: DataView, offset: number, value: Vec3): void {
  view.setFloat32(offset, value.x, true);
  view.setFloat32(offset + 4, value.y, true);
  view.setFloat32(offset + 8, value.z, true);
}

/** Borrows the source shared prefix without decoding or replacing its storage. */
export function borrowQvmSharedEntity(view: DataView, profile: QvmAbiProfile = "q3-modern"): QvmSharedEntity {
  const QVM_SHARED_ENTITY_BYTES = qvmSharedEntityBytes(profile);
  const offset = (modern: number): number => profile === "q3-modern" ? modern : modern < 428 ? modern - 8 : modern - 12;
  if (view.byteLength < QVM_SHARED_ENTITY_BYTES) {
    throw new BinaryError("QVM sharedEntity_t", 0,
      `record requires ${QVM_SHARED_ENTITY_BYTES} bytes, received ${view.byteLength}`);
  }
  const s = borrowQvmEntityState(view, profile);
  return {
    s,
    r: {
      get linked(): boolean { return view.getInt32(offset(416), true) !== 0; },
      set linked(value: boolean) { view.setInt32(offset(416), value ? 1 : 0, true); },
      get linkcount(): number { return view.getInt32(offset(420), true); },
      set linkcount(value: number) { view.setInt32(offset(420), value, true); },
      get svFlags(): number { return view.getInt32(offset(424), true); },
      set svFlags(value: number) { view.setInt32(offset(424), value, true); },
      get singleClient(): number { return profile === "q3-modern" ? view.getInt32(428, true) : 0; },
      set singleClient(value: number) { if (profile === "q3-modern") view.setInt32(428, value, true); else if (value !== 0) throw new Error("Legacy QVM entity has no singleClient field"); },
      get mins(): Vec3 { return readVector(view, offset(436)); },
      set mins(value: Vec3) { writeVector(view, offset(436), value); },
      get maxs(): Vec3 { return readVector(view, offset(448)); },
      set maxs(value: Vec3) { writeVector(view, offset(448), value); },
      get contents(): number { return view.getInt32(offset(460), true); },
      set contents(value: number) { view.setInt32(offset(460), value, true); },
      get absmin(): Vec3 { return readVector(view, offset(464)); },
      set absmin(value: Vec3) { writeVector(view, offset(464), value); },
      get absmax(): Vec3 { return readVector(view, offset(476)); },
      set absmax(value: Vec3) { writeVector(view, offset(476), value); },
      get currentOrigin(): Vec3 { return readVector(view, offset(488)); },
      set currentOrigin(value: Vec3) { writeVector(view, offset(488), value); },
      get currentAngles(): Vec3 { return readVector(view, offset(500)); },
      set currentAngles(value: Vec3) { writeVector(view, offset(500), value); },
      get ownerNum(): number { return view.getInt32(offset(512), true); },
      set ownerNum(value: number) { view.setInt32(offset(512), value, true); },
      get model(): QvmEntityCollisionModel {
        if (view.getInt32(offset(432), true) !== 0) return { kind: "inline", index: s.modelindex };
        return (view.getInt32(offset(424), true) & SVF_CAPSULE) !== 0
          ? { kind: "capsule" } : { kind: "box" };
      },
      set model(value: QvmEntityCollisionModel) {
        switch (value.kind) {
          case "inline":
            s.modelindex = value.index;
            view.setInt32(offset(432), 1, true);
            break;
          case "box":
            view.setInt32(offset(432), 0, true);
            view.setInt32(offset(424), view.getInt32(offset(424), true) & ~SVF_CAPSULE, true);
            break;
          case "capsule":
            view.setInt32(offset(432), 0, true);
            view.setInt32(offset(424), view.getInt32(offset(424), true) | SVF_CAPSULE, true);
            break;
        }
      },
    },
  };
}

export type QvmEntityCollisionModel = { readonly kind: "inline"; readonly index: number } | { readonly kind: "box" } | { readonly kind: "capsule" };
export interface QvmSharedEntity {
  readonly s: QvmEntityState;
  readonly r: {
    linked: boolean;
    linkcount: number;
    svFlags: number;
    singleClient: number;
    mins: Vec3;
    maxs: Vec3;
    contents: number;
    absmin: Vec3;
    absmax: Vec3;
    currentOrigin: Vec3;
    currentAngles: Vec3;
    ownerNum: number;
    model: QvmEntityCollisionModel;
  };
}
