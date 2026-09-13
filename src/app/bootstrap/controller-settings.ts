import type { GyroSettingsUi } from "../../ui/settings/gyro.ts";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { homedir } from "node:os";
import type { SeatId } from "../../contracts/identity.ts";
import { defaultGamepadTuning } from "../../input/gamepad.ts";
import type { GamepadTuning } from "../../input/gamepad.ts";
import type { InputRouter } from "../../input/router.ts";
import type { ControllerDevice } from "../../platform/controller.ts";
import { ConfigStore } from "../../settings/config.ts";
import type { GyroProfileIdentity } from "../../settings/config.ts";

type Profile = { readonly instance: number; readonly identity: GyroProfileIdentity; readonly path: string; busy: boolean; message: string };
/** Owns disk I/O only; active gyro tuning and calibration remain in the input router. */
export class ControllerSettings {
  private readonly profiles = new Map<SeatId, Profile>();
  private closed = false;
  constructor(readonly router: InputRouter, private readonly seats: readonly SeatId[], private readonly devices: () => readonly ControllerDevice[],
    private readonly store = new ConfigStore(join(homedir(), ".local", "share", "quake-typescript", "settings")),
    private readonly report: (message: string) => void = () => undefined) {}
  update(): void {
    if (this.closed) return;
    for (const [index, seat] of this.seats.entries()) {
      const instance = this.router.controllerFor(seat), current = this.profiles.get(seat);
      if (instance === null) { this.profiles.delete(seat); continue; }
      if (current?.instance === instance) continue;
      const device = this.devices().find(value => value.instance === instance);
      if (device === undefined) continue;
      const identity: GyroProfileIdentity = device.guid !== null && device.serial !== null && device.serial.length > 0
        ? { kind: "device", guid: device.guid, serial: device.serial } : { kind: "seat" };
      const name = identity.kind === "seat" ? "seat" : `${identity.guid}-${createHash("sha256").update(identity.serial).digest("hex")}`;
      const profile: Profile = { instance, identity, path: `controllers/seat-${index + 1}/${name}.json`, busy: true, message: "Loading settings..." };
      this.profiles.set(seat, profile);
      const input = this.router.seat(seat);
      if (input !== null) input.gamepad.tuning = { ...input.gamepad.tuning, gyro: { ...defaultGamepadTuning.gyro } };
      this.router.setGyroEnabled(seat, false);
      void this.load(seat, profile);
    }
  }
  private current(seat: SeatId, profile: Profile): boolean {
    return !this.closed && this.profiles.get(seat) === profile && this.router.controllerFor(seat) === profile.instance;
  }
  private async load(seat: SeatId, profile: Profile): Promise<void> {
    try {
      const saved = await this.store.loadGyro(profile.path);
      if (!this.current(seat, profile)) return;
      const input = this.router.seat(seat);
      if (saved !== null && input !== null) {
        if (saved.identity.kind !== profile.identity.kind || saved.identity.kind === "device" && (profile.identity.kind !== "device" || saved.identity.guid !== profile.identity.guid || saved.identity.serial !== profile.identity.serial)) throw new Error("Gyro settings belong to another controller");
        input.gamepad.tuning = { ...input.gamepad.tuning, gyro: { ...saved.tuning, enabled: false } };
        const result = this.router.setGyroEnabled(seat, saved.tuning.enabled);
        if (result.kind !== "accepted") throw new Error(result.reason);
      }
      profile.message = profile.identity.kind === "seat" ? "Saved for this seat." : "Saved for this controller and seat.";
    } catch (cause: unknown) { if (this.current(seat, profile)) this.failed(profile, cause); }
    finally { if (this.current(seat, profile)) profile.busy = false; }
  }
  private failed(profile: Profile, cause: unknown): void {
    profile.message = cause instanceof Error ? cause.message : String(cause); this.report(`${profile.message}\n`);
  }
  busy(seat: SeatId): boolean { return this.profiles.get(seat)?.busy ?? false; }
  message(seat: SeatId): string { return this.profiles.get(seat)?.message ?? "Connect a controller with a gyroscope."; }
  async save(seat: SeatId): Promise<void> {
    const profile = this.profiles.get(seat), input = this.router.seat(seat);
    if (profile === undefined || input === null || !this.current(seat, profile) || profile.busy) return;
    const tuning: GamepadTuning["gyro"] = { ...input.gamepad.tuning.gyro };
    profile.busy = true;
    try { await this.store.saveGyro(profile.path, { version: 1, identity: profile.identity, tuning }); }
    catch (cause: unknown) { if (this.current(seat, profile)) this.failed(profile, cause); }
    finally { if (this.current(seat, profile)) profile.busy = false; }
  }
  ui(seat: SeatId): GyroSettingsUi {
    return { router: this.router, device: () => this.closed ? null : this.devices().find(device => device.instance === this.router.controllerFor(seat)) ?? null,
      busy: () => this.busy(seat), message: () => this.message(seat), save: () => this.save(seat) };
  }
  close(): void { this.closed = true; this.profiles.clear(); }
}
