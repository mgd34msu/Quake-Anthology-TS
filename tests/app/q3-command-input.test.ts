import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { CommandBuffer } from "../../src/core/commands/index.ts";
import { SeatInput, registerInputCommands } from "../../src/input/seat.ts";
import { InputCommandBuilder } from "../../src/input/user-command.ts";
import { q3CommandForControls } from "../../src/app/bootstrap/simulation/q3-commands.ts";

for (const dialect of ["q1-netquake", "q1-quakeworld"] satisfies ("q1-netquake" | "q1-quakeworld")[]) test(`${dialect} original jump button becomes Q3 jump while explicit vertical movement survives`, () => {
  const ids = createIdentityOwner(dialect), seat = ids.seat(0), client = ids.client(0, 0), actor = ids.actor(1, 0);
  const context = { session: ids.session, origin: { kind: "local-seat", seat, client } } satisfies ConstructorParameters<typeof CommandBuffer>[0]["context"];
  for (const text of ["+jump", "+moveup", "+movedown"]) {
    const commands = new CommandBuffer({ dialect, context });
    const input = new SeatInput({ seat, dialect, context, commands, uiEvent: () => false });
    const dispose = registerInputCommands(commands, () => input);
    input.bind({ input: { kind: "key", code: 32 }, target: { kind: "command", text } });
    input.input({ seat, kind: "key", code: 32, down: true, repeat: false, timeMilliseconds: 100 }); commands.execute();
    const command = new InputCommandBuilder(dialect).build(input.sample(120, 20), dialect === "q1-netquake" ? { kind: dialect, acknowledgedServerTimeSeconds: 1 } : { kind: dialect });
    if (command.kind !== "q1-netquake" && command.kind !== "q1-quakeworld") throw new Error("Wrong command dialect");
    const converted = q3CommandForControls({ actor, source: { kind: "local-seat", seat, client }, sequence: 1, command }, 120, { requestedWeapon: 10, useHoldable: false });
    if (text === "+jump") { expect(command.buttons & 2).toBe(2); expect(command.upMove).toBe(0); expect(converted.upmove).toBe(127); }
    else { expect(command.buttons & 2).toBe(0); expect(Math.sign(converted.upmove)).toBe(text === "+moveup" ? 1 : -1); }
    expect(converted.buttons).toBe(0); dispose();
  }
});
