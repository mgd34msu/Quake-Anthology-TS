import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { CommandBuffer } from "../../../src/core/commands/index.ts";
import { SeatInput } from "../../../src/input/seat.ts";
import { InputCommandBuilder, type UserCommandFrame } from "../../../src/input/user-command.ts";
import { sourceFrameMilliseconds } from "../../../src/app/bootstrap/frame-time.ts";

for (const dialect of ["q2-classic", "q3"] satisfies readonly ("q2-classic" | "q3")[]) {
  for (const timescale of [0, 0.5, 2]) test(`${dialect} input measures wall holds while source command duration scales ${timescale}`, () => {
    const owner = createIdentityOwner(`time-${dialect}-${timescale}`), seat = owner.seat(0);
    const context = { session: owner.session, origin: { kind: "local-seat", seat, client: owner.client(0, 0) } } satisfies ConstructorParameters<typeof CommandBuffer>[0]["context"];
    const commands = new CommandBuffer({ dialect, context });
    const input = new SeatInput({ seat, dialect, context, commands, uiEvent: () => false });
    input.button("forward").down("w", 1000);
    const sample = input.sample(1100, 100);
    expect(sample.buttons.find(button => button.action === "forward")?.fraction).toBe(1);
    const duration = sourceFrameMilliseconds(dialect, 100, { timescale, cameraMode: 1, fixedtime: 0, hostFramerate: 0 }, { dedicated: false, localServer: true });
    const frame: UserCommandFrame = dialect === "q3" ? { kind: "q3", serverTimeMilliseconds: 1000 + duration, weapon: 2, sensitivity: 1 }
      : { kind: "q2-classic", deltaAngles: { x: 0, y: 0, z: 0 }, lightLevel: 128, attackAllowed: true };
    const builder = new InputCommandBuilder(dialect);
    const command = builder.build(sample, frame, duration);
    expect(command.forwardMove).toBe(dialect === "q3" ? 127 : 400);
    if (command.kind === "q2-classic") expect(command.milliseconds).toBe(duration);
    if (command.kind === "q3") expect(command.serverTimeMilliseconds).toBe(1000 + duration);
  });
}

test("Q3 fractional integer controls do not enable fixedtime or camera freeze", () => {
  const host = { dedicated: false, localServer: true };
  expect(sourceFrameMilliseconds("q3", 17, { timescale: 1, fixedtime: 0.5, cameraMode: 0, hostFramerate: 0 }, host)).toBe(17);
  expect(sourceFrameMilliseconds("q3", 17, { timescale: 0, fixedtime: 0, cameraMode: 0.5, hostFramerate: 0 }, host)).toBe(17);
});
