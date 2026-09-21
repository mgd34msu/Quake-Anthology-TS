// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestAddress } from "../../../contracts/execution.ts";
import type { Bounds } from "../../../contracts/math.ts";
import type { EquipmentMovement } from "../../../contracts/movement.ts";
import type { NumericOperations } from "../../../contracts/numeric.ts";
import type { BspPlane, TraceResult } from "../../../contracts/scene.ts";
import { pmoveClassic, Q2_PLAYER_BOUNDS } from "../../../movement/q2/index.ts";
import type { ClassicPmove, MovementEntity, TraceT, Vec3 } from "../../../movement/q2/types.ts";
import { CLASSIC_Q2_PMOVE_BYTES, classicSignature, q2Int, q2Pointer, q2Trace } from "./layout.ts";
import type { ClassicQ2GuestHost } from "./host.ts";

export interface ClassicGuestPmoveOptions { readonly numeric: NumericOperations; readonly characterBounds?: Bounds; readonly airAccelerate?: number; readonly equipment?: EquipmentMovement }
/** Source Pmove calls source trace/contents callbacks synchronously on the same guest stack. */
export function runClassicGuestPmove(address: GuestAddress, host: ClassicQ2GuestHost, options: ClassicGuestPmoveOptions): undefined {
  const memory = host.memory, view = memory.borrow(address, CLASSIC_Q2_PMOVE_BYTES);
  const traceTarget = memory.readPointer(memory.offset(address, 232n)), contentsTarget = memory.readPointer(memory.offset(address, 236n));
  if (traceTarget === null || contentsTarget === null) throw new Error("API 3 Pmove callback pointer is null");
  if (options.equipment !== undefined) {
    view.setInt16(18, options.numeric.toInt32(options.numeric.multiply(view.getInt16(18, true), options.equipment.gravityScale)), true);
    view.setUint8(16, options.equipment.predictionSuppressed ? view.getUint8(16) | 64 : view.getUint8(16) & ~64);
  }
  if (options.equipment?.velocity !== undefined) {
    for (const [index, value] of [options.equipment.velocity.x, options.equipment.velocity.y, options.equipment.velocity.z].entries())
      view.setInt16(10 + index * 2, options.numeric.toInt32(options.numeric.multiply(value, 8)), true);
  }
  return host.applyInputMovement(address, () => runMovement(address, host, options));
}

function runMovement(address: GuestAddress, host: ClassicQ2GuestHost, options: ClassicGuestPmoveOptions): undefined {
  const memory = host.memory, view = memory.borrow(address, CLASSIC_Q2_PMOVE_BYTES);
  const scratch = memory.allocate({ byteLength: 48, label: "API 3 nested Pmove vectors" });
  const canonical = new Map<bigint, MovementEntity>();
  function entity(pointer: GuestAddress | null): MovementEntity | null {
    if (pointer === null) return null;
    const previous = canonical.get(pointer.byteOffset); if (previous !== undefined) return previous;
    const record = host.edicts.fromPointer(pointer);
    const actor = host.edicts.observe(pointer);
    if (actor === null) throw new Error("Pmove callback returned an inactive edict");
    const result: MovementEntity = record.slot === 0 ? { kind: "world", model: 0 } : { kind: "actor", actor: actor.id };
    canonical.set(pointer.byteOffset, result); return result;
  }
  function pointer(hit: MovementEntity | null): GuestAddress | null {
    return hit === null ? null : hit.kind === "world" ? host.edicts.at(0).address : host.edicts.pointer(hit.actor);
  }
  function vector(offset: number, storage: "short" | "float"): Vec3 {
    return storage === "short" ? [view.getInt16(offset, true), view.getInt16(offset + 2, true), view.getInt16(offset + 4, true)]
      : [view.getFloat32(offset, true), view.getFloat32(offset + 4, true), view.getFloat32(offset + 8, true)];
  }
  function writeVector(offset: number, value: Vec3, storage: "short" | "float"): void {
    if (storage === "short") { view.setInt16(offset, value[0], true); view.setInt16(offset + 2, value[1], true); view.setInt16(offset + 4, value[2], true); }
    else { view.setFloat32(offset, value[0], true); view.setFloat32(offset + 4, value[1], true); view.setFloat32(offset + 8, value[2], true); }
  }
  function prepareVector(index: number, value: Vec3): GuestAddress {
    const location = memory.offset(scratch, BigInt(index * 12));
    memory.writeFloat32(location, value[0]); memory.writeFloat32(memory.offset(location, 4n), value[1]); memory.writeFloat32(memory.offset(location, 8n), value[2]);
    return location;
  }
  function commit(): void {
    view.setInt32(0, pm.s.pm_type, true); writeVector(4, pm.s.origin, "short"); writeVector(10, pm.s.velocity, "short");
    view.setUint8(16, pm.s.pm_flags); view.setUint8(17, pm.s.pm_time); view.setInt16(18, pm.s.gravity, true); writeVector(20, pm.s.delta_angles, "short");
    view.setInt32(48, pm.numtouch, true);
    for (const [index, hit] of pm.touchents.slice(0, pm.numtouch).entries()) { if (index >= 32) throw new Error("Pmove exceeded MAXTOUCH"); memory.writePointer(memory.offset(address, BigInt(52 + index * 4)), pointer(hit)); }
    writeVector(180, pm.viewangles, "float"); view.setFloat32(192, pm.viewheight, true); writeVector(196, pm.mins, "float"); writeVector(208, pm.maxs, "float");
    memory.writePointer(memory.offset(address, 220n), pointer(pm.groundentity)); view.setInt32(224, pm.watertype, true); view.setInt32(228, pm.waterlevel, true);
  }
  function reload(): void {
    pm.s.pm_type = view.getInt32(0, true); pm.s.origin = vector(4, "short"); pm.s.velocity = vector(10, "short");
    pm.s.pm_flags = view.getUint8(16); pm.s.pm_time = view.getUint8(17); pm.s.gravity = view.getInt16(18, true); pm.s.delta_angles = vector(20, "short");
    pm.cmd.msec = view.getUint8(28); pm.cmd.buttons = view.getUint8(29); pm.cmd.angles = vector(30, "short");
    pm.cmd.forwardmove = view.getInt16(36, true); pm.cmd.sidemove = view.getInt16(38, true); pm.cmd.upmove = view.getInt16(40, true); pm.cmd.impulse = view.getUint8(42); pm.cmd.lightlevel = view.getUint8(43);
    pm.snapinitial = view.getInt32(44, true) !== 0; pm.numtouch = view.getInt32(48, true);
    if (pm.numtouch < 0 || pm.numtouch > 32) throw new Error("Source callback set an invalid Pmove touch count");
    const touches: MovementEntity[] = [];
    for (let index = 0; index < pm.numtouch; index++) { const hit = entity(memory.readPointer(memory.offset(address, BigInt(52 + index * 4)))); if (hit === null) throw new Error("Source callback set a null Pmove touch"); touches.push(hit); }
    pm.touchents = touches; pm.viewangles = vector(180, "float"); pm.viewheight = view.getFloat32(192, true); pm.mins = vector(196, "float"); pm.maxs = vector(208, "float");
    pm.groundentity = entity(memory.readPointer(memory.offset(address, 220n))); pm.watertype = view.getInt32(224, true); pm.waterlevel = view.getInt32(228, true);
  }
  const pm: ClassicPmove = {
    s: { pm_type: view.getInt32(0, true), origin: vector(4, "short"), velocity: vector(10, "short"), pm_flags: view.getUint8(16), pm_time: view.getUint8(17), gravity: view.getInt16(18, true), delta_angles: vector(20, "short") },
    cmd: { msec: view.getUint8(28), buttons: view.getUint8(29), angles: vector(30, "short"), forwardmove: view.getInt16(36, true), sidemove: view.getInt16(38, true), upmove: view.getInt16(40, true), impulse: view.getUint8(42), lightlevel: view.getUint8(43) },
    snapinitial: view.getInt32(44, true) !== 0, numtouch: 0, touchents: [], touchtraces: [], viewangles: vector(180, "float"), viewheight: view.getFloat32(192, true),
    mins: vector(196, "float"), maxs: vector(208, "float"), groundentity: null, watertype: view.getInt32(224, true), waterlevel: view.getInt32(228, true),
    characterBounds: options.characterBounds ?? Q2_PLAYER_BOUNDS,
    trace: (start, mins, maxs, end) => {
      commit();
      const target = memory.readPointer(memory.offset(address, 232n)); if (target === null) throw new Error("Source cleared Pmove trace callback");
      const result = host.invoke(target, classicSignature([q2Pointer, q2Pointer, q2Pointer, q2Pointer], q2Trace),
        [start, mins, maxs, end].map((value, index) => ({ kind: "pointer", value: prepareVector(index, value) })));
      reload();
      if (result.kind !== "aggregate" || result.bytes.length !== 56) throw new Error("API 3 Pmove trace returned an invalid trace_t");
      const data = new DataView(result.bytes.buffer, result.bytes.byteOffset, result.bytes.byteLength);
      const hit = entity(memory.pointer(BigInt(data.getUint32(52, true))));
      const sourcePlane: BspPlane = { normal: { x: data.getFloat32(24, true), y: data.getFloat32(28, true), z: data.getFloat32(32, true) }, distance: data.getFloat32(36, true), type: data.getUint8(40), signbits: data.getUint8(41) };
      const surfaceAddress = memory.pointer(BigInt(data.getUint32(44, true)));
      let surfaceName = "";
      if (surfaceAddress !== null) for (const byte of memory.copy(surfaceAddress, 16)) { if (byte === 0) break; surfaceName += String.fromCharCode(byte); }
      const surface = surfaceAddress === null ? null : { name: surfaceName, flags: memory.readInt32(memory.offset(surfaceAddress, 16n)), value: memory.readInt32(memory.offset(surfaceAddress, 20n)), material: "" };
      const fraction = data.getFloat32(8, true), allSolid = data.getInt32(0, true) !== 0;
      const source: TraceResult = { kind: "q2", fraction, startSolid: data.getInt32(4, true) !== 0, allSolid, end: { x: data.getFloat32(12, true), y: data.getFloat32(16, true), z: data.getFloat32(20, true) },
        sourcePlane, contact: fraction < 1 && !allSolid ? { kind: "plane", plane: sourcePlane } : { kind: "none" }, hit: hit ?? { kind: "none" }, contents: data.getInt32(48, true), surface, secondary: null };
      const trace: TraceT = { allsolid: source.allSolid, startsolid: source.startSolid, fraction, endpos: [source.end.x, source.end.y, source.end.z],
        plane: { normal: [sourcePlane.normal.x, sourcePlane.normal.y, sourcePlane.normal.z], dist: sourcePlane.distance, type: sourcePlane.type, signbits: sourcePlane.signbits }, surface, contents: source.contents, ent: hit,
        plane2: { normal: [0, 0, 0], dist: 0, type: 0, signbits: 0 }, surface2: null, source };
      return trace;
    },
    pointcontents: point => {
      commit();
      const target = memory.readPointer(memory.offset(address, 236n)); if (target === null) throw new Error("Source cleared Pmove contents callback");
      const result = host.invoke(target, classicSignature([q2Pointer], q2Int), [{ kind: "pointer", value: prepareVector(0, point) }]);
      reload();
      if (result.kind !== "int32") throw new Error("API 3 Pmove pointcontents did not return int");
      return result.value;
    },
  };
  try {
    pmoveClassic(pm, options.numeric, options.airAccelerate ?? 0);
    commit();
  } finally { memory.unmap(scratch, 48); }
  return undefined;
}
