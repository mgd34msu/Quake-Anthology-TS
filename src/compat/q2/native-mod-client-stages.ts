import type { NativeModSourceCall } from "../../contracts/native-mod-callbacks.ts";
import type { Q2UserCommand, Q2RereleaseUserCommand } from "../../contracts/protocol.ts";
import type { ModClientApplication } from "../../world/session/mod-clients.ts";
import { modClientInputValues } from "../../world/session/mod-client-input-values.ts";
import type { NativeModHost } from "../../app/bootstrap/simulation/native-mod-host.ts";
import { writeRereleaseUserCommand } from "./rerelease/player-state.ts";

/** Exclusions apply only while their declaring original call is active. */
export class NativeModClientStages {
  private active: { readonly call: NativeModSourceCall; readonly removals: (() => void)[] } | null = null;
  constructor(private readonly host: Pick<NativeModHost, "memory" | "imageBase" | "bindInlineRegion">) {}
  private bind(scope: NonNullable<NativeModClientStages["active"]>): void {
    const { memory, imageBase } = this.host;
    for (const region of scope.call.skips ?? []) scope.removals.push(this.host.bindInlineRegion(
      memory.offset(imageBase, BigInt(region.entry)), memory.offset(imageBase, BigInt(region.join)), continuation => continuation.skip()));
  }
  private unbind(scope: NativeModClientStages["active"]): void {
    for (const remove of scope?.removals.splice(0).reverse() ?? []) remove();
  }
  run<T>(call: NativeModSourceCall, invoke: () => T): T {
    const previous = this.active, scope = { call, removals: [] } satisfies NonNullable<NativeModClientStages["active"]>;
    this.unbind(previous); this.active = scope;
    try {
      this.bind(scope);
      return invoke();
    } finally {
      this.unbind(scope); this.active = previous;
      if (previous !== null) this.bind(previous);
    }
  }
}

export function writeNativeUserCommand(view: DataView, command: Q2UserCommand | Q2RereleaseUserCommand): void {
  if (command.kind === "q2-rerelease") {
    if (![command.angles.x, command.angles.y, command.angles.z, command.forwardMove, command.sideMove].every(value => Number.isFinite(Math.fround(value))))
      throw new RangeError("Native input output exceeds the float32 command ABI");
    writeRereleaseUserCommand(view, command); return;
  }
  if (!command.angleShorts.every(value => Number.isSafeInteger(Math.trunc(value)))) throw new RangeError("Native input aim exceeds the integer command ABI");
  if (![command.forwardMove, command.sideMove, command.upMove].every(value => Number.isFinite(value) && value >= -32768 && value <= 32767))
    throw new RangeError("Native input movement exceeds the int16 command ABI");
  view.setUint8(0, command.milliseconds); view.setUint8(1, command.buttons);
  command.angleShorts.forEach((value, axis) => view.setInt16(2 + axis * 2, value, true));
  view.setInt16(8, command.forwardMove, true); view.setInt16(10, command.sideMove, true); view.setInt16(12, command.upMove, true);
  view.setUint8(14, command.impulse); view.setUint8(15, command.lightLevel);
}

export function nativeModUserCommand(application: ModClientApplication, rerelease: boolean, frame: number, values = modClientInputValues(application)): Uint8Array {
  const input = (name: "attack" | "jump" | "impulse" | "forward-move" | "side-move" | "up-move"): number => {
    const value = values.get(name);
    if (value?.kind !== "float" || !Number.isFinite(value.value)) throw new Error(`Missing native command input ${name}`);
    return value.value;
  };
  const elapsed = application.frame.elapsed, milliseconds = Math.round(elapsed.value * (elapsed.kind === "seconds" ? 1000 : 1));
  if (milliseconds < 0 || milliseconds > 255) throw new Error("Native command interval exceeds its original byte ABI");
  const bytes = new Uint8Array(rerelease ? 28 : 16), view = new DataView(bytes.buffer), aim = application.absoluteAim;
  const forwardMove = input("forward-move") * 200, sideMove = input("side-move") * 200, upMove = input("up-move") * 200;
  if (rerelease) writeNativeUserCommand(view, { kind: "q2-rerelease", milliseconds, angles: aim,
    buttons: (input("attack") !== 0 ? 1 : 0) | (input("jump") !== 0 ? 8 : 0) | (upMove < 0 ? 16 : 0), forwardMove, sideMove, serverFrame: frame });
  else writeNativeUserCommand(view, { kind: "q2-classic", milliseconds, buttons: input("attack") !== 0 ? 1 : 0,
    angleShorts: [aim.x * 65536 / 360, aim.y * 65536 / 360, aim.z * 65536 / 360], forwardMove, sideMove,
    upMove: input("jump") !== 0 ? Math.max(200, upMove) : upMove, impulse: input("impulse"), lightLevel: 0 });
  return bytes;
}
