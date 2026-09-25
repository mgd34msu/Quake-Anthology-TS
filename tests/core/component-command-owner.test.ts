import { registerBindingCommands } from "../../src/input/bindings.ts";
import { BindingStore } from "../../src/input/binding-store.ts";
import { SeatInput, registerInputCommands } from "../../src/input/seat.ts";
import { registerDiscoveryCommands } from "../../src/console/discovery.ts";
import { expect, test } from "bun:test";
import { CommandBuffer } from "../../src/core/commands/index.ts";
import { CvarRegistry } from "../../src/core/cvars/index.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import type { CommandContext } from "../../src/contracts/common.ts";

test("component console scripts use their original cvars and commands and cannot outlive the consumer", async () => {
  const ids = createIdentityOwner("component-command-owner"), context: CommandContext = { session: ids.session, origin: { kind: "local-console" } };
  const instance = Symbol("original cgame"), source: CommandContext = { ...context, producer: { kind: "client-module", instance,
    module: { id: "mod:client", artifactPath: "vm/cgame.qvm", digest: `sha256:${"0".repeat(64)}`, revision: "1" } } };
  const world = new CvarRegistry({ dialect: "q1-netquake", context }), local = new CvarRegistry({ dialect: "q3", context: source });
  world.register("cg_custom", "world", 0); local.register("cg_custom", "original", 0);
  const commands: string[] = [], buffer = new CommandBuffer({ dialect: "q1-netquake", context, cvars: world,
    readScript: () => { throw new Error("Component script escaped its mounted files"); },
    forwardToServer: () => { throw new Error("Component command escaped to the primary world"); } });
  let resolve: (value: string) => void = () => { throw new Error("Missing script request"); };
  const release = buffer.bindProducer(instance, { cvars: () => local, engineCommand: () => false,
    readScript: () => new Promise(done => { resolve = done; }), command: command => { commands.push(command.raw); } });
  buffer.append("set cg_custom local; original_command; exec client.cfg\n", source, "q3");
  buffer.execute(); expect(local.variableString("cg_custom")).toBe("local"); expect(world.variableString("cg_custom")).toBe("world");
  expect(commands).toEqual([" original_command"]); expect(buffer.producerPending(instance)).toBe(true);
  release(); resolve("set cg_custom stale; original_command\n"); await Promise.resolve(); buffer.execute();
  expect(buffer.producerPending(instance)).toBe(false); expect(local.variableString("cg_custom")).toBe("local"); expect(commands.length).toBe(1);
});

test("original component config owns its gameplay commands while engine commands change only its invoking seat", async () => {
  const ids = createIdentityOwner("component-config"), seat = ids.seat(1);
  const context: CommandContext = { session: ids.session, origin: { kind: "local-seat", seat, client: ids.client(1, 0) } };
  const instance = Symbol("source cgame"), source: CommandContext = { ...context, producer: { kind: "client-module", instance,
    module: { id: "mod:client", artifactPath: "vm/cgame.qvm", digest: `sha256:${"1".repeat(64)}`, revision: "1" } } };
  const cvars = new CvarRegistry({ dialect: "q3", context: source }), output: string[] = [], game: string[] = [];
  const buffer = new CommandBuffer({ dialect: "q1-netquake", context,
    sourceCommand: () => { throw new Error("Engine registration fell into world command routing"); } });
  const input = new SeatInput({ seat, dialect: "q1-netquake", context, commands: buffer, uiEvent: () => false });
  const other = new BindingStore(); other.bind({ input: { kind: "key", code: 113 }, target: { kind: "command", text: "other" } });
  registerBindingCommands(buffer, id => id.equals(seat) ? input : other, text => { output.push(text); });
  registerInputCommands(buffer, id => id.equals(seat) ? input : null);
  registerDiscoveryCommands(buffer, text => { output.push(text); });
  buffer.register("weapon", () => { throw new Error("Source gameplay command reached primary world"); });
  buffer.bindProducer(instance, { cvars: () => cvars, engineCommand: () => false, command: command => { game.push(command.argv.join(" ")); },
    readScript: async () => 'unbindall; bind MOUSE2 "+attack"; bind q "weapon 3"; bind mouse2; bindlist; unbind q; +forward; help bind; weapon 3\n' });
  buffer.append("exec client.cfg\n", source, "q3"); await buffer.executeScriptsAsync(async () => {});
  expect(input.binding({ kind: "mouse-button", button: 3 })).toEqual({ kind: "command", text: "+attack" });
  expect(input.binding({ kind: "key", code: 113 })).toBeNull();
  expect(other.binding({ kind: "key", code: 113 })).toEqual({ kind: "command", text: "other" });
  expect(input.sample(16, 16).buttons.some(button => button.action === "forward" && button.active)).toBe(true);
  expect(output.some(text => text.includes("MOUSE2 = +attack"))).toBe(true);
  expect(output.some(text => text.includes("bind (command)"))).toBe(true);
  expect(game).toEqual(["weapon 3"]);
  buffer.append("-forward\n", source, "q3"); buffer.execute();
  expect(input.sample(32, 16).buttons.some(button => button.action === "forward" && button.active)).toBe(false);
});
