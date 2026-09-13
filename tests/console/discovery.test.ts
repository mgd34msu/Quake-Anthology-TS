import { expect, test } from "bun:test";
import type { CommandContext } from "../../src/contracts/common.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { CommandBuffer } from "../../src/core/commands/index.ts";
import { CvarRegistry } from "../../src/core/cvars/index.ts";
import { ApplicationConsoleRouting } from "../../src/app/bootstrap/console.ts";
import { consoleEntryHelp, findConsoleEntries, queryConsoleEntries, registerDiscoveryCommands } from "../../src/console/discovery.ts";
import { SeatConsole } from "../../src/console/session.ts";

test("discovery resolves live invoking seat values and owner documentation", () => {
  const identity = createIdentityOwner("discovery"), seat = identity.seat(0), other = identity.seat(1);
  const context: CommandContext = { session: identity.session, origin: { kind: "local-seat", seat, client: identity.client(0, 0) } };
  const otherContext: CommandContext = { session: identity.session, origin: { kind: "local-seat", seat: other, client: identity.client(1, 0) } };
  const fallback = new CvarRegistry({ dialect: "q2-classic", context }), first = new CvarRegistry({ dialect: "q2-classic", context }), second = new CvarRegistry({ dialect: "q2-classic", context: otherContext });
  first.register("sensitivity", "3"); second.register("sensitivity", "8"); second.register("other_seat_only", "1");
  first.document("sensitivity", { summary: "Mouse sensitivity.", usage: "sensitivity [value]", examples: ["sensitivity 4"] });
  const routing = new ApplicationConsoleRouting({ fallback, sourceDialect: () => "q2-classic", server: () => null, seat: id => id.equals(seat) ? first : second });
  const printed: string[] = [], commands = new CommandBuffer({ dialect: "q2-classic", context, cvars: fallback, cvarRouting: routing, print: text => { printed.push(text); } });
  const remove = registerDiscoveryCommands(commands, text => { printed.push(text); });
  commands.defineAlias("greet", "echo hello\n");
  expect(findConsoleEntries(commands, "mouse", context).map(entry => entry.name)).toEqual(["sensitivity"]);
  expect(queryConsoleEntries(commands, context).some(entry => entry.name === "other_seat_only")).toBe(false);
  const sensitivity = queryConsoleEntries(commands, otherContext).find(entry => entry.name === "sensitivity");
  expect(sensitivity === undefined ? [] : consoleEntryHelp(sensitivity)).toContain('Current: "8"');
  const console = new SeatConsole({ seat, context, dialect: "q2-classic", commands, cvars: first, now: () => 0, connected: () => true, clipboard: () => null, focus: () => undefined, chat: () => { throw new Error("help entered chat"); } });
  console.field.setText("help sensitivity");
  console.input({ kind: "key", seat, code: 13, down: true, repeat: false, timeMilliseconds: 0 }, { kind: "console" });
  commands.execute();
  expect(printed.join("")).toContain("Mouse sensitivity."); expect(printed.join("")).toContain('Default: "3"');
  first.set("sensitivity", "5"); printed.length = 0;
  commands.append("help sensitivity\nhelp greet\nfind absent\n", context); commands.execute();
  expect(printed.join("")).toContain('Current: "5"'); expect(printed.join("")).toContain("Expands to: echo hello"); expect(printed.join("")).toContain("0 match(es)");
  remove(); expect(commands.exists("find")).toBe(false);
});

test("find reports pages without losing matches and undocumented commands stay truthful", () => {
  const identity = createIdentityOwner("discovery-pages"), printed: string[] = [];
  const commands = new CommandBuffer({ dialect: "q3", context: { session: identity.session, origin: { kind: "local-console" } }, print: text => { printed.push(text); } });
  registerDiscoveryCommands(commands, text => { printed.push(text); });
  for (let index = 0; index < 31; index++) commands.register(`test_item_${index}`, () => undefined);
  commands.append("find test_item\nfind test_item 2\nhelp test_item_0\n"); commands.execute();
  const output = printed.join("");
  expect(output).toContain("31 match(es), page 1/2"); expect(output).toContain('Next page: find "test_item" 2'); expect(output).toContain("page 2/2"); expect(output).toContain("No description registered."); expect(output).toContain("Usage: not documented");
});
