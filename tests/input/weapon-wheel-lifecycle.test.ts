import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import type { CommandContext } from "../../src/contracts/common.ts";
import { CommandBuffer } from "../../src/core/commands/index.ts";
import { registerWheelCommands } from "../../src/input/bindings.ts";
import { SeatInput } from "../../src/input/seat.ts";
import { SeatWeaponWheel } from "../../src/ui/hud/wheel.ts";

test("wheel release immediately retires input capture while its picture fades", () => {
  const owner = createIdentityOwner("wheel-lifecycle"), seat = owner.seat(0);
  const context: CommandContext = { session: owner.session, origin: { kind: "local-seat", seat, client: owner.client(0, 0) } };
  const commands = new CommandBuffer({ dialect: "q1-netquake", context });
  const wheel = new SeatWeaponWheel({ seat, now: () => 0, activeItem: () => "q3:weapon/gauntlet", changed: () => undefined, select: () => undefined,
    items: () => [{ id: "q3:weapon/gauntlet", sourceOrdinal: 1, sortOrder: 1, label: "Gauntlet", owned: true, hasAmmo: true, count: null, warningCount: 0, icon: null, selectedIcon: null }] });
  const input = new SeatInput({ seat, dialect: "q1-netquake", context, commands, uiEvent: event => wheel.input(event) });
  const release = registerWheelCommands(commands, (_seat, mode, down) => { if (down) wheel.open(mode); else wheel.close(true); });
  input.bind({ input: { kind: "key", code: 113 }, target: { kind: "command", text: "+weaponwheel" } });
  input.bind({ input: { kind: "key", code: 119 }, target: { kind: "action", action: "forward" } });
  const key = (code: number, down: boolean): void => { input.input({ kind: "key", seat, code, down, repeat: false, timeMilliseconds: 100 }); commands.execute(); };
  try {
    key(113, true); wheel.update(300); expect(wheel.isOpen).toBe(true);
    key(113, false);
    expect(wheel.holster).toBe(false);
    expect(wheel.drawState().wheel?.opacity).toBeGreaterThan(0);
    key(119, true); expect(input.button("forward").active).toBe(true); key(119, false);
    key(113, true); expect(wheel.isOpen).toBe(true); key(113, false); wheel.update(316);
    expect(wheel.holster).toBe(false);
  } finally { release(); }
});
