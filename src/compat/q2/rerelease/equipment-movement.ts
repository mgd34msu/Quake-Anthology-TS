import type { GuestAddress } from "../../../contracts/execution.ts";
import type { EquipmentMovement } from "../../../contracts/movement.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import { KexPmTypeT, PMF_DUCKED } from "../../../movement/q2/types.ts";
import { retailRereleaseClientProfile } from "./client-profile.ts";
import { fieldOffset, pmoveLayout } from "./layouts.ts";
import { gameExportLayout } from "./api.ts";
import type { RereleaseGuestModule } from "./module.ts";

const active = new WeakMap<RereleaseGuestModule, object>();
/** Retail LTCG folds pm_maxspeed/pm_duckspeed into shared constants; only these original variable reads are equipment inputs. */
const speedLoads = [
  { next: 0xe8293, register: 0 }, // PM_AddCurrents: swimming ladder maximum
  { next: 0xe889c, register: 1 }, { next: 0xe88ce, register: 0 }, // PM_WaterMove: maximum, duck maximum
  { next: 0xe8b15, register: 1 }, { next: 0xe8b1f, register: 1 }, // PM_AirMove: duck maximum, maximum
  { next: 0xe9e3e, register: 10 }, // PM_FlyMove: maximum
];

function vector(state: DataView, name: string, value: Vec3): void {
  const offset = fieldOffset(pmoveLayout, name); state.setFloat32(offset, value.x, true); state.setFloat32(offset + 4, value.y, true); state.setFloat32(offset + 8, value.z, true);
}
/** External equipment velocity enters before original component input callbacks. */
export function prepareRereleaseEquipmentMovement(module: RereleaseGuestModule, address: GuestAddress, equipment: EquipmentMovement): void {
  const state = module.memory.borrow(address, pmoveLayout.byteLength), flags = fieldOffset(pmoveLayout, "s.pm_flags"), gravity = fieldOffset(pmoveLayout, "s.gravity");
  if (equipment.velocity !== undefined) vector(state, "s.velocity", equipment.velocity);
  state.setInt16(gravity, Math.trunc(state.getInt16(gravity, true) * equipment.gravityScale), true);
  state.setUint16(flags, equipment.predictionSuppressed ? state.getUint16(flags, true) | 64 : state.getUint16(flags, true) & ~64, true);
}

/** The original Pmove still owns angles, collision, contacts and source state. */
export function withRereleaseEquipmentMovement(module: RereleaseGuestModule, address: GuestAddress, equipment: EquipmentMovement | undefined,
  execute: () => undefined): undefined {
  const memory = module.memory, state = memory.borrow(address, pmoveLayout.byteLength);
  const field = (name: string): number => fieldOffset(pmoveLayout, name);
  const flags = field("s.pm_flags"), type = field("s.pm_type"), originalType = state.getInt32(type, true), pose = equipment?.pose;
  const multiplier = equipment?.speedMultiplier ?? 1, scope = {}, previous = active.get(module), removals: (() => void)[] = [];
  active.set(module, scope);
  try {
    if (!Number.isFinite(multiplier) || multiplier <= 0) throw new RangeError("Equipment movement speed must be finite and positive");
    if (multiplier !== 1) {
      const authority = retailRereleaseClientProfile.authority;
      if (authority.kind !== "artifact" || memory.module.digest !== authority.digest) throw new Error("Native equipment speed requires its original movement profile");
      const image = memory.offset(module.options.getGameApi, -0x6bcd0n);
      const movement = memory.readPointer(memory.offset(module.bindGame(), BigInt(fieldOffset(gameExportLayout, "Pmove"))));
      if (movement?.byteOffset !== memory.offset(image, 0xea560n).byteOffset) throw new Error("Native movement entry differs from its equipment profile");
      const { cpu, callbacks } = module.options.runner.options;
      for (const load of speedLoads) removals.push(callbacks.observeEntry(memory.offset(image, BigInt(load.next)), () => {
        if (active.get(module) !== scope) return;
        const registers = new DataView(cpu.state.simd.xmm.buffer, cpu.state.simd.xmm.byteOffset, cpu.state.simd.xmm.byteLength), offset = load.register * 16;
        registers.setFloat32(offset, Math.fround(registers.getFloat32(offset, true) * multiplier), true);
      }));
    }
    if (pose !== undefined) { state.setInt32(type, KexPmTypeT.PM_FREEZE, true); vector(state, "s.velocity", { x: 0, y: 0, z: 0 }); }
    execute();
    if (pose !== undefined) {
      state.setInt8(field("s.viewheight"), pose.viewHeight); vector(state, "mins", pose.bounds.min); vector(state, "maxs", pose.bounds.max);
      state.setUint16(flags, pose.crouched ? state.getUint16(flags, true) | PMF_DUCKED : state.getUint16(flags, true) & ~PMF_DUCKED, true);
    }
    return undefined;
  } finally {
    if (pose !== undefined) state.setInt32(type, originalType, true);
    for (const remove of removals.reverse()) remove();
    if (previous === undefined) active.delete(module); else active.set(module, previous);
  }
}
