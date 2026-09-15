import { expect, test } from "bun:test";
import type { CommandContext } from "../../src/contracts/common.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { CommandBuffer } from "../../src/core/commands/index.ts";
import { CvarRegistry } from "../../src/core/cvars/index.ts";
import { SeatConsole } from "../../src/console/session.ts";
import { findConsoleEntries } from "../../src/console/discovery.ts";
import { registerQ1ClientCommands } from "../../src/app/bootstrap/q1-client-commands.ts";

test("Q1 local and remote consoles forward real host cheat names with the invoking seat", () => {
  for (const dialect of ["q1-netquake", "q1-quakeworld"] satisfies readonly ("q1-netquake" | "q1-quakeworld")[]) {
    const identity = createIdentityOwner(`host-commands-${dialect}`), seat = identity.seat(0);
    const context: CommandContext = { session: identity.session, origin: { kind: "local-seat", seat, client: identity.client(0, 0) } };
    const cvars = new CvarRegistry({ dialect, context }), commands = new CommandBuffer({ dialect, context, cvars });
    const forwarded: string[] = [];
    const remove = registerQ1ClientCommands(commands, dialect, (name, args, selected) => {
      expect(selected?.equals(seat)).toBe(true); expect(args).toEqual([]); forwarded.push(name); return undefined;
    });
    const console = new SeatConsole({ seat, context, dialect, commands, cvars, now: () => 0, connected: () => true,
      clipboard: () => null, focus: () => undefined, chat: () => { throw new Error("Host command entered chat"); } });
    for (const command of ["god", "/god", "notarget", "/noclip", "fly"]) { console.field.setText(command); console.submit(); commands.execute(); }
    expect(forwarded).toEqual(["god", "god", "notarget", "noclip", "fly"]);
    expect(findConsoleEntries(commands, "god").map(entry => entry.name)).toEqual(["god"]);
    remove(); expect(commands.exists("god")).toBe(false);
  }
});
