import { expect, test } from "bun:test";
import { createContentDigest } from "../../src/contracts/content.ts";
import type { CommandContext, CommandDialect } from "../../src/contracts/common.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { modInstanceProvider } from "../../src/contracts/mods.ts";
import { CommandBuffer } from "../../src/core/commands/index.ts";
import { CvarRegistry } from "../../src/core/cvars/index.ts";
import { ModCommands, readModCommand } from "../../src/world/session/mod-commands.ts";
import { ResourceScope } from "../../src/world/session/resources.ts";

const ids = createIdentityOwner("mod-commands");
const context: CommandContext = { session: ids.session, origin: { kind: "server-console" } };
const module = (id: string) => ({ id: modInstanceProvider({ product: "source", id }), artifactPath: "game.dll",
  digest: createContentDigest("a".repeat(64)), revision: "original" });

function fixture(dialect: CommandDialect = "q1-netquake") {
  const primary = new CvarRegistry({ dialect, context }); primary.register("value", "primary");
  const seen: string[] = [];
  let routing: ModCommands | null = null;
  const commands = new CommandBuffer({ dialect, context, cvars: primary,
    cvarRouting: { owner: (_name, source) => routing?.cvars(source) ?? primary,
      visible: source => [routing?.cvars(source) ?? primary] },
    serverGame: command => routing?.invoke(command) ?? false,
    readScript: (name, source) => routing?.readScript(name, source),
  });
  const mods = new ModCommands({ context, commands: () => commands }); routing = mods;
  commands.register("record", command => { seen.push(`${command.argsText}:${command.dialect}:${(mods.cvars(command.source) ?? primary).variableString("value")}`); });
  return { commands, mods, primary, seen, route: (next: ModCommands): void => { routing = next; } };
}

function bind(mods: ModCommands, id: string, dialect: CommandDialect, resources: ResourceScope,
  readScript?: (name: string) => string | undefined | Promise<string | undefined>) {
  const cvars = new CvarRegistry({ dialect, context }); cvars.register("value", id);
  const port = mods.bind({ selection: { product: "source", id }, module: module(id), cvars,
    invoke: command => command.argv[0] === "original", ...(readScript === undefined ? {} : { readScript }) }, resources);
  return { port, cvars };
}

test("component append, insert, immediate commands and aliases retain producer dialect and cvars", () => {
  const { commands, mods, primary, seen } = fixture();
  const first = new ResourceScope("first"), second = new ResourceScope("second");
  const a = bind(mods, "a", "q2-classic", first), b = bind(mods, "b", "q2-classic", second);
  a.port.executeNow('alias shared "record $value"'); b.port.executeNow('alias shared "record $value"');
  a.port.append("shared\n"); b.port.append("shared\n");
  a.port.insert("record inserted\n"); b.port.executeNow("record immediate");
  commands.append("record primary\n"); commands.execute();
  expect(seen).toEqual(["immediate:q2-classic:b", "inserted:q2-classic:a", "a:q2-classic:a", "b:q2-classic:b", "primary:q1-netquake:primary"]);
  expect(primary.variableString("value")).toBe("primary");
  a.port.executeNow("set value changed"); expect(a.cvars.variableString("value")).toBe("changed"); expect(b.cvars.variableString("value")).toBe("b");
  expect(commands.aliasNames()).toEqual([]);
  first.close(); b.port.append("shared\n"); commands.execute();
  expect(seen.at(-1)).toBe("b:q2-classic:b");
  second.close();
});

test("disable removes only that instance's deferred text and waits, including same-module replacements", async () => {
  const { commands, mods, seen, route } = fixture("q2-classic");
  const oldScope = new ResourceScope("old"), old = bind(mods, "same", "q3", oldScope);
  old.port.append("record old-deferred\n"); commands.copyToDefer();
  old.port.executeNow("wait 100");
  const candidate = commands.prepareProgram({ dialect: "q2-classic", context });
  let current = candidate.commands;
  const nextMods = new ModCommands({ context, commands: () => current }), nextScope = new ResourceScope("candidate");
  const next = bind(nextMods, "same", "q3", nextScope);
  next.port.append("record candidate\n");
  candidate.publish(); current = commands;
  oldScope.close();
  expect(mods.active({ ...context, producer: old.port.producer })).toBe(false);
  expect(nextMods.active({ ...context, producer: next.port.producer })).toBe(true);
  route(nextMods);
  commands.insertFromDefer();
  commands.unregister("record");
  commands.register("record", command => { seen.push(`${command.argsText}:${nextMods.cvars(command.source)?.variableString("value")}`); });
  await commands.advanceProgramFrame();
  expect(seen).toEqual(["candidate:same"]);
  expect(commands.pendingText).toBe(""); expect(commands.deferredText).toBe("");
  expect(() => old.port.append("record stale\n")).toThrow("closed");
  expect(next.cvars.variableString("value")).toBe("same");
  nextScope.close();
});

test("closing a component cancels its pending exec without replay and preserves another component", async () => {
  const { commands, mods, seen } = fixture("q3");
  let finish = (_text: string): void => {};
  const pending = new Promise<string>(resolve => { finish = resolve; });
  const first = new ResourceScope("reading"), second = new ResourceScope("retained");
  const a = bind(mods, "a", "q3", first, () => pending), b = bind(mods, "b", "q3", second);
  a.port.append("exec pending.cfg\nrecord retired\n"); b.port.append("record retained\n");
  const drain = commands.executeScriptsAsync(async () => {});
  await Promise.resolve(); await Promise.resolve(); first.close();
  await drain;
  expect(seen).toEqual(["retained:q3:b"]);
  finish("record late\n"); await pending;
  commands.execute(); expect(seen).toEqual(["retained:q3:b"]);
  second.close();
});

test("adjacent component chunks cannot combine text and explicit dispatch retains caller authority", () => {
  const { commands, mods, seen } = fixture("q3");
  const first = new ResourceScope("first"), second = new ResourceScope("second");
  const a = bind(mods, "a", "q3", first), b = bind(mods, "b", "q3", second);
  a.port.append("record a"); b.port.append("record b\n"); commands.execute();
  expect(seen).toEqual(["a:q3:a", "b:q3:b"]);
  const caller: CommandContext = { session: ids.session, origin: { kind: "remote-client", client: ids.client(1, 0) } };
  const observed: CommandContext[] = [];
  commands.register("caller", command => { observed.push(command.source); });
  mods.execute({ product: "source", id: "a" }, "caller", caller);
  expect(observed).toEqual([{ ...caller, producer: a.port.producer }]);
  first.close(); second.close();
});

test("retirement removes deferred work inside a suspended preparation without clearing its prefix", async () => {
  const { commands, mods, seen } = fixture("q2-classic");
  const scope = new ResourceScope("retired"), component = bind(mods, "a", "q2-classic", scope);
  component.port.append("record retired\n"); commands.append("record primary\n"); commands.copyToDefer();
  const candidate = commands.prepareProgram({ dialect: "q2-classic", context });
  await candidate.preparePrefix(async () => { candidate.commands.appendPreparation("record prefix\n"); return false; });
  candidate.publish(); scope.close();
  await commands.advanceProgramFrame();
  expect(seen).toEqual(["prefix:q2-classic:primary"]);
  commands.finishPreparation(); await commands.advanceProgramFrame();
  expect(seen).toEqual(["prefix:q2-classic:primary", "primary:q2-classic:primary"]);
});

test("initialization stages component text in the shared program and disable removes only its work", () => {
  let current: CommandBuffer | null = null;
  const seen: string[] = [];
  const mods = new ModCommands({ context, commands: () => current });
  const first = new ResourceScope("retired candidate"), second = new ResourceScope("retained candidate");
  const a = bind(mods, "a", "q1-netquake", first), b = bind(mods, "b", "q2-classic", second);
  a.port.append("record retired\n"); b.port.append("record last\n"); b.port.insert("record first\n");
  expect(() => b.port.executeNow("record premature")).toThrow("prepared command buffer");
  first.close();
  current = new CommandBuffer({ dialect: "q3", context });
  current.register("record", command => { seen.push(`${command.argsText}:${command.dialect}`); });
  mods.flush(); expect(seen).toEqual([]);
  current.execute(); expect(seen).toEqual(["first:q2-classic", "last:q2-classic"]);
  second.close();
});

test("explicit mod selectors preserve colons and quoted payload across console dialects", () => {
  for (const dialect of ["q1-netquake", "q1-quakeworld", "q2-classic", "q2-rerelease", "q3"] satisfies readonly CommandDialect[]) {
    const commands = new CommandBuffer({ dialect, context }), seen: ReturnType<typeof readModCommand>[] = [];
    commands.register("modcmd", command => { seen.push(readModCommand(command.raw)); });
    commands.executeNow('modcmd copper/copper:heal-0 original "one two" value:three');
    expect(seen).toEqual([{ selection: { product: "copper", id: "copper:heal-0" }, text: 'original "one two" value:three' }]);
  }
});

test("selected builtins execute before a component collision guard, while overridden handlers do not", async () => {
  const cvars = new CvarRegistry({ dialect: "q3", context }), lines: string[] = [];
  const commands = new CommandBuffer({ dialect: "q3", context, cvars, print: text => lines.push(text),
    sourceCommand: command => { throw new Error(`Primary collision: ${command.argv[0]}`); } });
  commands.append("set value private\necho ready\nwait 1\necho resumed\n");
  await commands.advanceProgramFrame();
  expect(cvars.variableString("value")).toBe("private");
  expect(lines).toEqual(["ready \n"]);
  await commands.advanceProgramFrame(); expect(lines).toEqual(["ready \n", "resumed \n"]);
  commands.unregister("echo"); commands.register("echo", () => { throw new Error("Primary handler executed"); });
  expect(() => commands.executeNow("echo blocked")).toThrow("Primary collision: echo");
});
