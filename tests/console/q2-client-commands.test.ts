import { expect, test } from "bun:test";
import type { CommandContext, CommandDialect } from "../../src/contracts/common.ts";
import type { SeatId } from "../../src/contracts/identity.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { CommandBuffer } from "../../src/core/commands/index.ts";
import { registerQ2ClientCommands } from "../../src/app/bootstrap/q2-client-commands.ts";
import { findConsoleEntries, queryConsoleEntries, registerDiscoveryCommands } from "../../src/console/discovery.ts";
import { q2ClientCommands } from "../../src/content/q2/base/player/commands.ts";

test("Q2 catalogue registers real forwarding commands and keeps console help local", () => {
  const owner = createIdentityOwner("q2-command-catalogue"), seat = owner.seat(1);
  const context: CommandContext = { session: owner.session, origin: { kind: "local-seat", seat, client: owner.client(1, 0) } };
  const printed: string[] = [], forwarded: { name: string; args: readonly string[]; seat: SeatId | null }[] = [];
  const commands = new CommandBuffer({ dialect: "q2-classic", context, print: text => { printed.push(text); } });
  registerDiscoveryCommands(commands, text => { printed.push(text); });
  let scores = 0;
  commands.register("score", () => { scores++; });
  const unregister = registerQ2ClientCommands(commands, "q2-classic", (name, args, source) => { forwarded.push({ name, args, seat: source }); });
  expect(findConsoleEntries(commands, "invulnerab").map(entry => entry.name)).toEqual(["god"]);
  for (const definition of q2ClientCommands) expect(queryConsoleEntries(commands).some(entry => entry.name === (definition.name === "help" ? "gamehelp" : definition.name))).toBe(true);
  commands.append('god\ngive "Body Armor"\ngamehelp\nhelp god\nhelp\nscore\n', context); commands.execute();
  expect(forwarded).toEqual([{ name: "god", args: [], seat }, { name: "give", args: ["Body Armor"], seat }, { name: "help", args: [], seat }]);
  expect(printed.join("")).toContain("Toggle invulnerability"); expect(printed.join("")).toContain("Usage: help <name>"); expect(scores).toBe(1);
  const script: CommandContext = { session: owner.session, origin: { kind: "script", name: "bindings.cfg", caller: context.origin } };
  commands.append("noclip\n", script); commands.execute();
  expect(forwarded.at(-1)).toEqual({ name: "noclip", args: [], seat });
  unregister(); expect(commands.exists("god")).toBe(false); expect(commands.exists("score")).toBe(true); expect(commands.exists("help")).toBe(true);
});

test("Q2 gameplay catalogue is selected by source dialect", () => {
  const owner = createIdentityOwner("q2-command-selection");
  const commands = new CommandBuffer({ dialect: "q3", context: { session: owner.session, origin: { kind: "local-console" } } });
  registerQ2ClientCommands(commands, "q3", () => undefined);
  expect(commands.exists("god")).toBe(false);
  registerQ2ClientCommands(commands, "q2-rerelease", () => undefined);
  expect(commands.commandDocumentation("noclip")?.usage).toBe("noclip");
});

test.each(["q2-classic", "q2-rerelease"] satisfies readonly CommandDialect[])("%s catalogue owns shared weapon and chat forwarding", dialect => {
  const owner = createIdentityOwner("shared-command-ownership"), seat = owner.seat(1);
  const context: CommandContext = { session: owner.session, origin: { kind: "local-seat", seat, client: owner.client(1, 0) } };
  const printed: string[] = [], forwarded: { name: string; args: readonly string[]; seat: SeatId | null }[] = [];
  const commands = new CommandBuffer({ dialect, context, print: text => { printed.push(text); } });
  registerQ2ClientCommands(commands, dialect, (name, args, source) => { forwarded.push({ name, args, seat: source }); });
  const names = ["weapnext", "weapprev", "use", "say", "say_team"];
  for (const name of names) {
    expect(commands.registeredNames().filter(registered => registered === name)).toHaveLength(1);
    expect(commands.commandDocumentation(name)).toEqual(q2ClientCommands.find(command => command.name === name)?.documentation);
    expect(queryConsoleEntries(commands).find(entry => entry.name === name)?.summary).toBeTruthy();
  }
  const script: CommandContext = { session: owner.session, origin: { kind: "script", name: "bindings.cfg", caller: context.origin } };
  commands.append('weapnext\nweapprev\nuse "Railgun"\nsay "hello world"\nsay_team "team message"\n', script);
  commands.execute();
  expect(forwarded).toEqual([
    { name: "weapnext", args: [], seat }, { name: "weapprev", args: [], seat },
    { name: "use", args: ["Railgun"], seat }, { name: "say", args: ["hello world"], seat },
    { name: "say_team", args: ["team message"], seat },
  ]);
  expect(printed).toEqual([]);
});
