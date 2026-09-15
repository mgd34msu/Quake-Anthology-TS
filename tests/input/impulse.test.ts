import { expect, test } from "bun:test";
import type { CommandContext, CommandDialect } from "../../src/contracts/common.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { CommandBuffer } from "../../src/core/commands/index.ts";
import { registerInputCommands, SeatInput } from "../../src/input/seat.ts";
import { InputCommandBuilder, type UserCommandFrame } from "../../src/input/user-command.ts";

function fixture(dialect: CommandDialect, movement: CommandDialect = dialect) {
  const owner = createIdentityOwner(`impulse-${dialect}-${movement}`), seat = owner.seat(0);
  const context: CommandContext = { session: owner.session, origin: { kind: "local-seat", seat, client: owner.client(0, 0) } };
  const commands = new CommandBuffer({ dialect, context });
  const input = new SeatInput({ seat, dialect: movement, context, commands, uiEvent: () => false });
  registerInputCommands(commands, requested => requested === seat ? input : null);
  return { commands, input, context, owner };
}

const quakeCases: readonly (readonly [string, number])[] = [
  ["", 0], ["9suffix", 9], ["9.5", 9], ["-1", 255], ["255", 255], ["256", 0], ["257", 1],
  ["0x109tail", 9], ["-0X1", 255], ['"\'a"', 97], ['"-\'a"', 159], ["'", 0],
  ["+9", 0], ['" 9"', 0], ["garbage", 0], ["1e2", 1],
];
for (const dialect of ["q1-netquake", "q1-quakeworld"] satisfies readonly CommandDialect[]) {
  test(`${dialect} impulse uses Q_atoi and the transmitted byte`, () => {
    const { commands, input } = fixture(dialect);
    const builder = new InputCommandBuilder(dialect);
    const frame: UserCommandFrame = dialect === "q1-netquake" ? { kind: dialect, acknowledgedServerTimeSeconds: 0 } : { kind: dialect };
    for (const [text, expected] of quakeCases) {
      commands.append(`impulse ${text}\n`); commands.execute();
      const sample = input.sample(20, 20), command = builder.build(sample, frame);
      expect(sample.impulse).toBe(expected);
      expect("impulse" in command ? command.impulse : undefined).toBe(expected);
      expect(input.sample(40, 20).impulse).toBe(0);
    }
  });
}

test("Q2 classic uses decimal atoi and byte encoding", () => {
  const { commands, input } = fixture("q2-classic"), builder = new InputCommandBuilder("q2-classic");
  const cases: readonly (readonly [string, number])[] = [["+9", 9], ['" 9"', 9], ["9tail", 9], ["9.5", 9], ["-1", 255], ["256", 0], ["257", 1], ["0x9", 0], ["'a", 0], ["bad", 0], ["", 0]];
  for (const [text, expected] of cases) {
    commands.append(`impulse ${text}\n`); commands.execute();
    const command = builder.build(input.sample(20, 20), { kind: "q2-classic", deltaAngles: { x: 0, y: 0, z: 0 }, lightLevel: 0, attackAllowed: true });
    expect("impulse" in command ? command.impulse : undefined).toBe(expected);
  }
});

test("world dialect parses script impulses independently of selected movement and only for the caller seat", () => {
  const { commands, input, context, owner } = fixture("q1-netquake", "q3");
  commands.append("impulse 257;impulse 9tail\n", { ...context, origin: { kind: "script", name: "binding", caller: context.origin } });
  commands.execute();
  expect(input.sample(20, 20).impulse).toBe(9);
  for (const origin of [
    { kind: "server-console" },
    { kind: "remote-client", client: owner.client(0, 0) },
    { kind: "local-seat", seat: owner.seat(1), client: owner.client(0, 1) },
  ] satisfies readonly CommandContext["origin"][]) {
    commands.append("impulse 9\n", { ...context, origin }); commands.execute();
    expect(input.sample(40, 20).impulse).toBe(0);
  }
});

for (const dialect of ["q2-rerelease", "q3"] satisfies readonly CommandDialect[]) {
  test(`${dialect} retains the existing strict numeric extension`, () => {
    const { commands, input } = fixture(dialect, "q1-netquake");
    commands.append("impulse 0x9\n"); commands.execute();
    expect(input.sample(20, 20).impulse).toBe(9);
    for (const text of ["9tail", "9.5", "-1", "256"]) {
      commands.append(`impulse ${text}\n`);
      expect(() => commands.execute()).toThrow("Input impulse must fit a byte");
    }
    expect(() => input.setImpulse(256)).toThrow("Input impulse must fit a byte");
  });
}
