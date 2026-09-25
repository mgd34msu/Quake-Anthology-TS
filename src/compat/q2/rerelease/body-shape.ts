import type { GuestAddress, GuestValueLayout } from "../../../contracts/execution.ts";
import type { Bounds, Vec3 } from "../../../contracts/math.ts";
import { movementBounds, type MovementBodyShape } from "../../../movement/body-shape.ts";
import { bindNativeModEntry } from "../native-mod-entries.ts";
import { signature } from "./api.ts";
import { fieldOffset, pmoveLayout, traceLayout } from "./layouts.ts";
import type { RereleaseGuestModule } from "./module.ts";

interface BodyFrame { readonly address: GuestAddress; apply(): void; }
const active = new WeakMap<RereleaseGuestModule, BodyFrame[]>();

/** Keep original dimension decisions, trace policy and later specialized probes. */
export function withRereleaseBodyShape(module: RereleaseGuestModule, address: GuestAddress, body: MovementBodyShape | undefined,
  run: () => undefined): undefined {
  if (body === undefined) return run();
  const profile = module.requireWorldProfile().movement, boundary = profile.body;
  if (boundary === undefined) {
    if (body.requested !== undefined) throw new Error("Native body shape requires an admitted original dimensions and trace boundary");
    return run();
  }
  const memory = module.memory, image = memory.offset(module.options.getGameApi, -BigInt(profile.gameApi));
  const dimensions = memory.offset(image, BigInt(boundary.dimensions)), trace = memory.offset(image, BigInt(boundary.trace));
  const global = memory.offset(image, BigInt(boundary.movementGlobal)), view = memory.borrow(address, pmoveLayout.byteLength);
  const read = (name: string): Vec3 => { const at = fieldOffset(pmoveLayout, name); return { x: view.getFloat32(at, true), y: view.getFloat32(at + 4, true), z: view.getFloat32(at + 8, true) }; };
  const write = (name: string, value: Vec3): void => { const at = fieldOffset(pmoveLayout, name); view.setFloat32(at, value.x, true); view.setFloat32(at + 4, value.y, true); view.setFloat32(at + 8, value.z, true); };
  const pointer: GuestValueLayout = { kind: "scalar", storage: "pointer" };
  const traceCall = signature([pointer, pointer, pointer, pointer, { kind: "scalar", storage: "uint32" }], { kind: "aggregate", layout: traceLayout });
  let accepted = body.current;
  const flags = fieldOffset(pmoveLayout, "s.pm_flags"), height = fieldOffset(pmoveLayout, "s.viewheight");
  let previousDuck = view.getUint16(flags, true) & 1, previousHeight = view.getInt8(height);
  const frames = active.get(module) ?? [], outermost = frames.length === 0;
  if (outermost) active.set(module, frames);
  const frame: BodyFrame = { address, apply: () => {
      body.currentActor();
      const desired: Bounds = body.requested ?? { min: read("mins"), max: read("maxs") };
      const next = movementBounds(accepted, desired, bounds => {
        const scratch = memory.allocate({ byteLength: 36, alignment: 4n, label: "original Pmove body expansion" });
        const vector = (offset: number, value: Vec3): GuestAddress => {
          const target = memory.offset(scratch, BigInt(offset)), data = memory.borrow(target, 12);
          data.setFloat32(0, value.x, true); data.setFloat32(4, value.y, true); data.setFloat32(8, value.z, true); return target;
        };
        try {
          const origin = vector(0, read("s.origin")), min = vector(12, bounds.min), max = vector(24, bounds.max);
          const result = module.invoke(trace, traceCall, [{ kind: "pointer", value: origin }, { kind: "pointer", value: min },
            { kind: "pointer", value: max }, { kind: "pointer", value: origin }, { kind: "uint32", value: 0 }]);
          body.currentActor();
          if (result.kind !== "aggregate" || result.bytes.length !== traceLayout.byteLength) throw new Error("Original Pmove expansion returned an invalid trace");
          return result.bytes[0] === 0;
        } finally { memory.unmap(scratch, 36); }
      });
      if (next !== desired) { view.setUint16(flags, (view.getUint16(flags, true) & ~1) | previousDuck, true); view.setInt8(height, previousHeight); }
      accepted = next; write("mins", next.min); write("maxs", next.max);
      previousDuck = view.getUint16(flags, true) & 1; previousHeight = view.getInt8(height);
    } };
  frames.push(frame);
  let binding: ReturnType<typeof bindNativeModEntry> | undefined;
  try {
    if (outermost) binding = bindNativeModEntry({ memory, entries: module.options.runner.options, invoke: module.invoke.bind(module) }, dimensions,
      `${memory.module.id}:client-body-dimensions`, signature([]), (values, original) => {
        const result = original(values), current = frames.at(-1);
        if (current !== undefined && memory.readPointer(global)?.byteOffset === current.address.byteOffset) current.apply();
        return result;
      });
    body.currentActor(); return run();
  } finally {
    binding?.close(); frames.pop(); if (outermost) active.delete(module);
  }
}
