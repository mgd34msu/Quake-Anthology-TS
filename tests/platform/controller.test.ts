import { describe, expect, test } from "bun:test";
import { SdlControllers, VirtualSdlController } from "../../src/platform/controller.ts";
import type { ControllerDevice, ControllerEvent, ControllerSelection } from "../../src/platform/controller.ts";

const runtime = SdlControllers.runtime;
// SDL2-compat's SDL2 int-success callback is forwarded to SDL3 bool without conversion.
// https://github.com/libsdl-org/sdl2-compat/blob/release-2.32.70/src/sdl2_compat.c
const virtualCallbackMismatch = runtime.version === "2.32.70";

function device(controllers: SdlControllers, instance: number): ControllerDevice {
  const result = controllers.devices.find(candidate => candidate.instance === instance);
  if (result === undefined) throw new Error(`Missing SDL controller ${instance}`);
  return result;
}
function selection(controller: ControllerDevice): ControllerSelection {
  if (controller.guid === null) throw new Error("SDL virtual controller has no mapping GUID");
  return { kind: "device", guid: controller.guid, ordinal: controller.ordinal };
}
function input(events: readonly ControllerEvent[]): readonly ControllerEvent[] {
  return events.filter(event => event.kind === "axis" || event.kind === "button");
}
function fixture(run: (controllers: SdlControllers, attach: (name?: string, rumble?: boolean) => VirtualSdlController) => void): void {
  const virtuals: VirtualSdlController[] = [], controllers = SdlControllers.open();
  try {
    run(controllers, (name = "Quake controller fixture", rumble = false) => {
      const virtual = VirtualSdlController.attach({ name, rumble }); virtuals.push(virtual); return virtual;
    });
  } finally {
    controllers.close();
    for (const virtual of virtuals.reverse()) virtual.close();
  }
}

describe("SDL controller resources", () => {
  test("enumerates native devices and opens hotplug controllers once with a single event owner", () => {
    fixture((controllers, attach) => {
      const hardware = controllers.devices.filter(candidate => !candidate.virtual);
      console.info(JSON.stringify({ kind: "controller-hardware-coverage", sdl: controllers.version, physicalDevices: hardware,
        status: hardware.length === 0 ? "physical-hardware-not-present" : "physical-device-enumeration-only",
        unexecuted: ["physical motor output", "physical gyro and accelerometer sampling", "physical touchpad sampling", "physical disconnect and reconnect"] }));
      expect(() => SdlControllers.open()).toThrow("already have an owner");
      const virtual = attach();
      const connected = controllers.pollEvents().filter(event => event.kind === "connected" && event.device.instance === virtual.instance);
      expect(connected).toHaveLength(1);
      expect(device(controllers, virtual.instance)).toMatchObject({ instance: virtual.instance, virtual: true, name: "Quake controller fixture", serial: null });
      expect(device(controllers, virtual.instance).guid).toMatch(/^[0-9a-f]{32}$/);
      expect(controllers.pollEvents().filter(event => event.kind === "connected")).toEqual([]);
      controllers.close(); controllers.close();
      expect(() => controllers.pollEvents()).toThrow("closed");
      expect(() => controllers.devices).toThrow("closed");
    });
  });

  test("retains both button edges and all signed axes separately for two real SDL virtual devices", () => {
    fixture((controllers, attach) => {
      const first = attach("Quake independent A"), second = attach("Quake independent B");
      controllers.pollEvents();
      controllers.setAssignments([selection(device(controllers, first.instance)), selection(device(controllers, second.instance))]);
      controllers.pollEvents();
      first.setButton(0, true); first.setButton(0, false); second.setButton(1, true);
      first.setAxis(0, -32768); second.setAxis(0, 32767); first.setAxis(5, 32767);
      const events = input(controllers.pollEvents());
      expect(events.filter(event => event.kind === "button").map(event => ({ instance: event.instance, slot: event.slot, button: event.button, down: event.down }))).toEqual([
        { instance: first.instance, slot: 0, button: 0, down: true }, { instance: first.instance, slot: 0, button: 0, down: false },
        { instance: second.instance, slot: 1, button: 1, down: true },
      ]);
      expect(events.find(event => event.kind === "axis" && event.instance === first.instance && event.axis === 0))
        .toMatchObject({ kind: "axis", instance: first.instance, slot: 0, axis: 0, value: -32768 });
      expect(events.find(event => event.kind === "axis" && event.instance === second.instance && event.axis === 0))
        .toMatchObject({ kind: "axis", instance: second.instance, slot: 1, axis: 0, value: 32767 });
      expect(events.find(event => event.kind === "axis" && event.instance === first.instance && event.axis === 5))
        .toMatchObject({ kind: "axis", instance: first.instance, slot: 0, axis: 5, value: 32767 });
      expect(controllers.snapshot(first.instance)?.buttons[0]).toBe(false);
      expect(controllers.snapshot(second.instance)?.buttons[1]).toBe(true);
      expect(controllers.snapshot(first.instance)?.axes[0]).toBe(-32768);
      expect(controllers.snapshot(second.instance)?.axes[0]).toBe(32767);
      expect(input(controllers.pollEvents())).toEqual([]);
    });
  });

  test("explicit assignments precede automatic slots and duplicate requests never share a device", () => {
    fixture((controllers, attach) => {
      const first = attach("Quake assignments A"), second = attach("Quake assignments B");
      controllers.pollEvents();
      const explicit = selection(device(controllers, first.instance));
      controllers.setAssignments([{ kind: "automatic" }, explicit, explicit, { kind: "none" }]);
      expect(controllers.assignments).toEqual([second.instance, first.instance, null, null]);
      controllers.setAssignments([explicit, { kind: "none" }]);
      expect(controllers.assignments).toEqual([first.instance, null]);
      second.setButton(2, true);
      expect(controllers.pollEvents().find(event => event.kind === "button" && event.instance === second.instance))
        .toMatchObject({ kind: "button", instance: second.instance, slot: null, down: true });
      const guid = device(controllers, first.instance).guid;
      if (guid === null) throw new Error("SDL controller mapping GUID missing");
      controllers.setAssignments([{ kind: "serial", guid, serial: "absent-unit" }]);
      expect(controllers.assignments).toEqual([null]);
    });
  });

  test("identical controller ordinals survive disconnect, SDL index compaction, and replug", () => {
    fixture((controllers, attach) => {
      const first = attach("Quake identical"), second = attach("Quake identical");
      controllers.pollEvents();
      const firstDevice = device(controllers, first.instance), secondDevice = device(controllers, second.instance);
      expect(firstDevice.guid).toBe(secondDevice.guid);
      expect(firstDevice.ordinal).toBe(0); expect(secondDevice.ordinal).toBe(1);
      controllers.setAssignments([selection(firstDevice), selection(secondDevice)]); controllers.pollEvents();
      first.setButton(0, true); controllers.pollEvents();
      first.close();
      const disconnected = controllers.pollEvents();
      expect(disconnected.find(event => event.kind === "disconnected" && event.instance === first.instance))
        .toMatchObject({ kind: "disconnected", instance: first.instance, slot: 0 });
      expect(disconnected.find(event => event.kind === "assignment" && event.slot === 0))
        .toMatchObject({ kind: "assignment", slot: 0, previous: first.instance, instance: null });
      expect(controllers.assignments).toEqual([null, second.instance]);
      expect(device(controllers, second.instance).ordinal).toBe(1);
      expect(controllers.snapshot(first.instance)).toBeNull();
      second.setButton(3, true);
      expect(controllers.pollEvents().find(event => event.kind === "button" && event.instance === second.instance))
        .toMatchObject({ kind: "button", instance: second.instance, slot: 1, button: 3 });
      const replugged = attach("Quake identical"); controllers.pollEvents();
      expect(replugged.instance).not.toBe(first.instance);
      expect(device(controllers, replugged.instance).ordinal).toBe(0);
      expect(controllers.assignments).toEqual([replugged.instance, second.instance]);
      expect(controllers.snapshot(replugged.instance)?.buttons.every(down => !down)).toBe(true);
    });
  });

  test("assignment changes preserve the old event route and notify both release and replacement", () => {
    fixture((controllers, attach) => {
      const first = attach("Quake route A"), second = attach("Quake route B"); controllers.pollEvents();
      controllers.setAssignments([selection(device(controllers, first.instance))]); controllers.pollEvents();
      first.setButton(0, true);
      controllers.setAssignments([selection(device(controllers, second.instance))]);
      second.setButton(1, true);
      const events = controllers.pollEvents();
      const oldEdge = events.findIndex(event => event.kind === "button" && event.instance === first.instance && event.slot === 0);
      const change = events.findIndex(event => event.kind === "assignment" && event.previous === first.instance && event.instance === second.instance);
      const newEdge = events.findIndex(event => event.kind === "button" && event.instance === second.instance && event.slot === 0);
      expect(oldEdge).toBeGreaterThanOrEqual(0); expect(change).toBeGreaterThan(oldEdge); expect(newEdge).toBeGreaterThan(change);
      controllers.setAssignments([]);
      expect(controllers.pollEvents().find(event => event.kind === "assignment" && event.slot === 0))
        .toMatchObject({ kind: "assignment", slot: 0, previous: second.instance, instance: null });
    });
  });

  test("an earlier queued add cannot consume an identical controller's replacement ordinal", () => {
    fixture((controllers, attach) => {
      const first = attach("Quake batched identical"), second = attach("Quake batched identical");
      controllers.pollEvents();
      controllers.setAssignments([selection(device(controllers, first.instance)), selection(device(controllers, second.instance))]);
      controllers.pollEvents();
      attach("Quake unrelated queued add");
      first.close();
      const replacement = attach("Quake batched identical");
      controllers.pollEvents();
      expect(device(controllers, replacement.instance).ordinal).toBe(0);
      expect(controllers.assignments).toEqual([replacement.instance, second.instance]);
    });
  });

  test("closing and reopening the provider preserves SDL attachment identity and held native state", () => {
    const virtual = VirtualSdlController.attach({ name: "Quake reopen" });
    let controllers = SdlControllers.open();
    try {
      controllers.pollEvents(); controllers.close();
      virtual.setButton(4, true); virtual.setAxis(2, -12345);
      controllers = SdlControllers.open();
      expect(device(controllers, virtual.instance).instance).toBe(virtual.instance);
      expect(controllers.snapshot(virtual.instance)?.buttons[4]).toBe(true);
      expect(controllers.snapshot(virtual.instance)?.axes[2]).toBe(-12345);
      controllers.pollEvents();
      virtual.setButton(4, false);
      expect(controllers.pollEvents().find(event => event.kind === "button" && event.instance === virtual.instance))
        .toMatchObject({ kind: "button", instance: virtual.instance, button: 4, down: false });
    } finally { controllers.close(); virtual.close(); }
  });

  test.skipIf(virtualCallbackMismatch)("native virtual rumble is accepted and stops on reassignment and close; blocked on SDL2-compat 2.32.70", () => {
    fixture((controllers, attach) => {
      const first = attach("Quake haptics A", true), second = attach("Quake haptics B", true); controllers.pollEvents();
      controllers.setAssignments([selection(device(controllers, first.instance))]); controllers.pollEvents();
      expect(device(controllers, first.instance).capabilities).toMatchObject({ rumble: true, triggerRumble: true });
      first.drainRumble(); second.drainRumble();
      expect(controllers.rumble(first.instance, 0.5, 1, 250)).toEqual({ kind: "accepted" });
      expect(controllers.rumbleTriggers(second.instance, 1, 0.25, 250)).toEqual({ kind: "accepted" });
      expect(first.drainRumble()).toEqual([{ kind: "rumble", low: 32768, high: 65535 }]);
      expect(second.drainRumble()).toEqual([{ kind: "trigger-rumble", low: 65535, high: 16384 }]);
      controllers.setAssignments([selection(device(controllers, second.instance))]);
      expect(first.drainRumble()).toContainEqual({ kind: "rumble", low: 0, high: 0 });
      controllers.close();
      expect(second.drainRumble()).toContainEqual({ kind: "trigger-rumble", low: 0, high: 0 });
    });
  });

  test.skipIf(!virtualCallbackMismatch)("SDL2-compat 2.32.70 virtual callback failure remains a failure with correct device routing", () => {
    fixture((controllers, attach) => {
      const first = attach("Quake compat haptics A", true), second = attach("Quake compat haptics B", true);
      controllers.pollEvents(); first.drainRumble(); second.drainRumble();
      expect(controllers.rumble(first.instance, 0.5, 1, 250)).toEqual({ kind: "failed", reason: "SDL controller rumble failed without an SDL error message" });
      expect(controllers.rumbleTriggers(second.instance, 1, 0.25, 250)).toEqual({ kind: "failed", reason: "SDL controller triggerRumble failed without an SDL error message" });
      expect(first.drainRumble()).toEqual([{ kind: "rumble", low: 32768, high: 65535 }]);
      expect(second.drainRumble()).toEqual([{ kind: "trigger-rumble", low: 65535, high: 16384 }]);
      console.info(JSON.stringify({ kind: "sdl2-compat-virtual-rumble", ...runtime, status: "native-api-failed",
        executed: ["native virtual callback delivery", "device isolation", "failure diagnosis"],
        unexecuted: ["accepted virtual rumble", "native timed stop", "native stop on reassignment and close"] }));
    });
  });

  test("unsupported motors, LED and gyro return device capability diagnostics, and disconnected handles stay unusable", () => {
    fixture((controllers, attach) => {
      const virtual = attach("Quake unsupported"); controllers.pollEvents();
      expect(device(controllers, virtual.instance).capabilities).toMatchObject({ rumble: false, triggerRumble: false, led: false, touchpads: 0, sensors: [] });
      for (const result of [controllers.rumble(virtual.instance, 1, 1, 20), controllers.rumbleTriggers(virtual.instance, 1, 1, 20),
        controllers.setLed(virtual.instance, 0, 1, 2), controllers.setSensorEnabled(virtual.instance, "gyro", true), controllers.readSensor(virtual.instance, "gyro")]) {
        expect(result.kind).toBe("unsupported");
        if (result.kind === "unsupported") expect(result.reason).toContain("Quake unsupported does not support");
      }
      virtual.close();
      expect(controllers.rumble(virtual.instance, 1, 1, 20).kind).toBe("disconnected");
      controllers.pollEvents();
      expect(controllers.setSensorEnabled(virtual.instance, "gyro", true).kind).toBe("disconnected");
    });
  });

  test("validates native numeric and identity boundaries before SDL calls", () => {
    fixture((controllers, attach) => {
      const virtual = attach("Quake boundaries"); controllers.pollEvents();
      for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, -0.1, 1.1]) expect(() => controllers.rumble(virtual.instance, invalid, 0, 10)).toThrow(RangeError);
      for (const invalid of [-1, 1.5, 0x100000000]) expect(() => controllers.rumble(virtual.instance, 0, 0, invalid)).toThrow(RangeError);
      expect(() => virtual.setAxis(6, 0)).toThrow(RangeError); expect(() => virtual.setAxis(0, -32769)).toThrow(RangeError);
      expect(() => virtual.setButton(21, true)).toThrow(RangeError);
      expect(() => controllers.setAssignments([{ kind: "device", guid: "invalid", ordinal: 0 }])).toThrow("GUID");
      expect(() => controllers.addMapping("invalid")).toThrow("mapping");
      virtual.close(); virtual.close(); expect(() => virtual.setButton(0, true)).toThrow("closed");
    });
  });

  test.skip("physical motor output and gyro/touchpad sampling require a connected physical controller and observation", () => {});
});
