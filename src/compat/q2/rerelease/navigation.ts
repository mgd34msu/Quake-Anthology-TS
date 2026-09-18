import type { ActorId } from "../../../contracts/identity.ts";
import type { GuestAddress, GuestCallResult, GuestCallValue } from "../../../contracts/execution.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { MappedGuestMemory } from "../../../guest/core/contracts.ts";
import type { NavigationRuntime } from "../../../bots/navigation/runtime.ts";
import { rereleasePathToGoal } from "../../../bots/navigation/rerelease-path.ts";
import { argument, requiredPointer } from "../../../guest/runtime/common/memory.ts";
import { guestBool } from "./module.ts";

export type RereleaseGoalStatus = 0 | 1 | 2 | 3;
export interface RereleaseNavigationServices {
  runtime(): NavigationRuntime | null;
  moveToPoint(actor: ActorId, point: Vec3, tolerance: number): RereleaseGoalStatus;
  followActor(actor: ActorId, target: ActorId): RereleaseGoalStatus;
}

/** game.h API 2023 Microsoft x64: PathRequest=80 bytes, PathInfo=40 bytes. */
export class RereleaseNavigationImports {
  constructor(readonly memory: MappedGuestMemory, readonly services: RereleaseNavigationServices,
    readonly actor: (address: GuestAddress) => ActorId | null) {}
  invoke(name: "GetPathToGoal" | "Bot_MoveToPoint" | "Bot_FollowActor", args: readonly GuestCallValue[]): GuestCallResult {
    const memory = this.memory;
    const vector = (address: GuestAddress): Vec3 => {
      const value = { x: memory.readFloat32(address), y: memory.readFloat32(memory.offset(address, 4n)), z: memory.readFloat32(memory.offset(address, 8n)) };
      if (![value.x, value.y, value.z].every(Number.isFinite)) throw new RangeError("Nonfinite Q2 navigation point");
      return value;
    };
    if (name !== "GetPathToGoal") {
      const actor = this.actor(requiredPointer(args, 0));
      if (name === "Bot_FollowActor") {
        const target = this.actor(requiredPointer(args, 1));
        return { kind: "int32", value: actor === null || target === null ? 0 : this.services.followActor(actor, target) };
      }
      const point = vector(requiredPointer(args, 1)), tolerance = argument(args, 2);
      if (tolerance.kind !== "float32" || !Number.isFinite(tolerance.value) || tolerance.value < 0) throw new RangeError("Invalid Q2 bot movement tolerance");
      return { kind: "int32", value: actor === null ? 0 : this.services.moveToPoint(actor, point, tolerance.value) };
    }
    const request = requiredPointer(args, 0), output = requiredPointer(args, 1);
    memory.check(request, 80, "read"); memory.check(output, 40, "write");
    const at = (offset: bigint) => memory.offset(request, offset);
    const float = (offset: bigint): number => {
      const value = memory.readFloat32(at(offset));
      if (!Number.isFinite(value)) throw new RangeError("Nonfinite Q2 navigation parameter");
      return value;
    };
    const buffer = memory.readPointer(at(64n)), count = memory.readInt64(at(72n));
    if (count < 0n || count > 0x7fffffffn || count > 0n && buffer === null) throw new RangeError("Invalid Q2 navigation point buffer");
    if (buffer !== null) memory.check(buffer, Number(count) * 12, "write");
    const result = rereleasePathToGoal(this.services.runtime(), { start: vector(request), goal: vector(at(12n)),
      flags: memory.readUint32(at(24n)), moveDistance: float(28n), ignoreNodeFlags: memory.readUint8(at(36n)) !== 0,
      minHeight: float(40n), maxHeight: float(44n), radius: float(48n), dropHeight: float(52n), jumpHeight: float(56n) });
    const writeVector = (address: GuestAddress, point: Vec3): void => {
      memory.writeFloat32(address, point.x); memory.writeFloat32(memory.offset(address, 4n), point.y); memory.writeFloat32(memory.offset(address, 8n), point.z);
    };
    const points = result.points.slice(0, Number(count));
    if (buffer !== null) for (const [index, point] of points.entries()) writeVector(memory.offset(buffer, BigInt(index * 12)), point);
    memory.writeInt32(output, points.length); memory.writeFloat32(memory.offset(output, 4n), result.distanceSquared);
    writeVector(memory.offset(output, 8n), result.first); writeVector(memory.offset(output, 20n), result.second);
    memory.writeInt32(memory.offset(output, 32n), result.linkType); memory.writeInt32(memory.offset(output, 36n), result.code);
    return guestBool(result.code < 5);
  }
}
