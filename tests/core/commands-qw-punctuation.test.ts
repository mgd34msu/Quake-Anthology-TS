import { expect, test } from "bun:test";
import type { CommandContext, CommandDialect } from "../../src/contracts/common.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { CommandBuffer, tokenizeCommand } from "../../src/core/commands/index.ts";
import { registerInputCommands, SeatInput } from "../../src/input/seat.ts";

test("QuakeWorld command words retain punctuation while NetQuake splits it", () => {
  const text = "record 'a -'a q1:shotgun {word}(tail)";
  for (const mode of ["source", "console"] satisfies readonly ("source" | "console")[]) {
    expect(tokenizeCommand(text, "q1-quakeworld", mode).argv).toEqual(["record", "'a", "-'a", "q1:shotgun", "{word}(tail)"]);
    expect(tokenizeCommand(text, "q1-netquake", mode).argv).toEqual(["record", "'", "a", "-", "'", "a", "q1", ":", "shotgun", "{", "word", "}", "(", "tail", ")"]);
  }
});

for (const dialect of ["q1-netquake", "q1-quakeworld"] satisfies readonly CommandDialect[]) {
  test(`${dialect} public script and alias impulses keep source punctuation semantics`, () => {
    const owner = createIdentityOwner(`punctuation-${dialect}`), seat = owner.seat(0);
    const context: CommandContext = { session: owner.session, origin: { kind: "local-seat", seat, client: owner.client(0, 0) } };
    const commands = new CommandBuffer({ dialect, context });
    const input = new SeatInput({ seat, dialect, context, commands, uiEvent: () => false });
    registerInputCommands(commands, requested => requested === seat ? input : null);
    const calls: (readonly string[])[] = [];
    commands.register("record", invocation => { calls.push(invocation.argv); });
    const script: CommandContext = { ...context, origin: { kind: "script", name: "autoexec.cfg", caller: context.origin } };
    commands.append('alias character "impulse \'a;record q1:shotgun"\ncharacter\n', script);
    commands.execute();
    expect(input.sample(20, 20).impulse).toBe(dialect === "q1-quakeworld" ? 97 : 0);
    expect(calls).toEqual(dialect === "q1-quakeworld" ? [["record", "q1:shotgun"]] : [["record", "q1", ":", "shotgun"]]);
    commands.append("impulse -'a\n", context); commands.execute();
    expect(input.sample(40, 20).impulse).toBe(dialect === "q1-quakeworld" ? 159 : 0);
    commands.append('impulse "\'a"\n', context); commands.execute();
    expect(input.sample(60, 20).impulse).toBe(97);
  });
}
