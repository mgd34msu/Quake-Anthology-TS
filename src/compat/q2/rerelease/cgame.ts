// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestAddress, GuestCallResult } from "../../../contracts/execution.ts";
import type { SeatId } from "../../../contracts/identity.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { Q2RereleasePlayerState } from "../../../contracts/protocol.ts";
import type { Q2CgameExports, Q2HudDraw } from "../../../contracts/ui.ts";
import type { CgameExportName } from "./api.ts";
import { cgameServerDataLayout, playerStateLayout } from "./layouts.ts";
import { guestBool, guestInt, guestPointer } from "./module.ts";
import type { RereleaseGuestModule } from "./module.ts";
import { writeRereleasePlayerState } from "./player-state.ts";

function integerResult(value: GuestCallResult): number {
  if (value.kind !== "int32" && value.kind !== "uint32") throw new TypeError("Cgame source integer return required");
  return value.value;
}
export interface RereleaseCgameOptions {
  readonly module: RereleaseGuestModule;
  /** Mapping comes from the session seats, independently of network player numbers. */
  splitIndex(seat: SeatId): number;
  /** Renderer/input imports bind this seat for the entire synchronous native entry. */
  withSeat(seat: SeatId, callback: () => undefined): undefined;
  refreshCvars(): void;
}
/** Native cgame UI entry points. Raw Pmove retains all caller-supplied trace callbacks. */
export class RereleaseCgame implements Omit<Q2CgameExports, "pmove"> {
  readonly api = { kind: "q2-rerelease-cgame", version: 2022 } satisfies Q2CgameExports["api"];
  constructor(readonly options: RereleaseCgameOptions) {}
  #temporary<T>(size: number, callback: (address: GuestAddress) => T): T {
    const memory = this.options.module.memory, address = memory.allocate({ byteLength: size, alignment: 8n, label: "cgame call data" });
    try { return callback(address); } finally { memory.unmap(address, size); }
  }
  #player<T>(state: Q2RereleasePlayerState, callback: (address: GuestAddress) => T): T {
    return this.#temporary(playerStateLayout.byteLength, address => { writeRereleasePlayerState(this.options.module.memory, address, state); return callback(address); });
  }
  #text<T>(text: string, callback: (address: GuestAddress) => T): T {
    const bytes = new TextEncoder().encode(text);
    return this.#temporary(bytes.length + 1, address => { this.options.module.memory.write(address, bytes); return callback(address); });
  }
  #split(seat: SeatId): number {
    const index = this.options.splitIndex(seat);
    if (!Number.isSafeInteger(index) || index < 0 || index >= 8) throw new RangeError("Cgame split index exceeds MAX_SPLIT_PLAYERS");
    return index;
  }
  init(): undefined { this.options.refreshCvars(); this.options.module.callCgame("Init"); return undefined; }
  shutdown(): undefined { this.options.module.callCgame("Shutdown"); return undefined; }
  touchPictures(): undefined { this.options.module.callCgame("TouchPics"); return undefined; }
  drawHud(frame: Q2HudDraw): undefined {
    this.options.refreshCvars();
    return this.options.withSeat(frame.seat, () => this.#player(frame.player, player => this.#temporary(cgameServerDataLayout.byteLength, data => {
      const layout = new TextEncoder().encode(frame.serverData.layout);
      if (layout.length >= 1024 || frame.serverData.inventory.length > 256) throw new RangeError("Cgame server data exceeds source arrays");
      const memory = this.options.module.memory;
      memory.write(data, layout);
      for (let index = 0; index < 256; index++) memory.writeInt16(memory.offset(data, BigInt(1024 + index * 2)), frame.serverData.inventory[index] ?? 0);
      const viewport = frame.viewport, safe = frame.safeArea;
      this.options.module.drawHud(this.#split(frame.seat), data, [viewport.x, viewport.y, viewport.width, viewport.height], [safe.x, safe.y, safe.width, safe.height], frame.scale, frame.playerNumber, player);
      return undefined;
    })));
  }
  #stat(name: CgameExportName, player: Q2RereleasePlayerState, index?: number): number {
    return this.#player(player, address => integerResult(this.options.module.callCgame(name, index === undefined ? [guestPointer(address)] : [guestPointer(address), guestInt(index)])));
  }
  layoutFlags(player: Q2RereleasePlayerState): number { return this.#stat("LayoutFlags", player); }
  activeWeaponWheelWeapon(player: Q2RereleasePlayerState): number { return this.#stat("GetActiveWeaponWheelWeapon", player); }
  ownedWeaponWheelWeapons(player: Q2RereleasePlayerState): number { return this.#stat("GetOwnedWeaponWheelWeapons", player); }
  weaponWheelAmmoCount(player: Q2RereleasePlayerState, ammoId: number): number { return this.#stat("GetWeaponWheelAmmoCount", player, ammoId); }
  powerupWheelCount(player: Q2RereleasePlayerState, powerupId: number): number { return this.#stat("GetPowerupWheelCount", player, powerupId); }
  hitMarkerDamage(player: Q2RereleasePlayerState): number { return this.#stat("GetHitMarkerDamage", player); }
  pmoveRaw(address: GuestAddress): undefined { this.options.module.callCgame("Pmove", [guestPointer(address)]); return undefined; }
  parseConfigString(index: number, value: string): undefined { return this.#text(value, address => { this.options.module.callCgame("ParseConfigString", [guestInt(index), guestPointer(address)]); return undefined; }); }
  parseCenterPrint(seat: SeatId, text: string, instant: boolean): undefined { return this.options.withSeat(seat, () => this.#text(text, address => { this.options.module.callCgame("ParseCenterPrint", [guestPointer(address), guestInt(this.#split(seat)), guestBool(instant)]); return undefined; })); }
  clearNotify(seat: SeatId): undefined { this.options.module.callCgame("ClearNotify", [guestInt(this.#split(seat))]); return undefined; }
  clearCenterPrint(seat: SeatId): undefined { this.options.module.callCgame("ClearCenterprint", [guestInt(this.#split(seat))]); return undefined; }
  notifyMessage(seat: SeatId, text: string, chat: boolean): undefined { return this.options.withSeat(seat, () => this.#text(text, address => { this.options.module.callCgame("NotifyMessage", [guestInt(this.#split(seat)), guestPointer(address), guestBool(chat)]); return undefined; })); }
  monsterFlashOffset(flashId: number): Vec3 {
    return this.#temporary(12, address => { this.options.module.callCgame("GetMonsterFlashOffset", [guestInt(flashId), guestPointer(address)]);
      const memory = this.options.module.memory; return { x: memory.readFloat32(address), y: memory.readFloat32(memory.offset(address, 4n)), z: memory.readFloat32(memory.offset(address, 8n)) }; });
  }
}
