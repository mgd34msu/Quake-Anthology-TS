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

test("local source identity commands preserve per-seat Q1 colors and Q2 userinfo", async () => {
  const { registerPlayerUserinfo, playerUserinfo } = await import("../../src/app/bootstrap/player-userinfo.ts");
  const { q2Userinfo } = await import("../../src/content/q2/base/player/index.ts");
  const identity = createIdentityOwner("local-identity");
  for (const dialect of ["q1-netquake", "q1-quakeworld", "q2-classic", "q2-rerelease"] satisfies readonly import("../../src/contracts/common.ts").CommandDialect[]) {
    const seats = [0, 1].map(index => {
      const seat = identity.seat(index), context: CommandContext = { session: identity.session, origin: { kind: "local-seat", seat, client: identity.client(index, 0) } };
      const cvars = new CvarRegistry({ dialect, context }); registerPlayerUserinfo(cvars, index);
      const commands = new CommandBuffer({ dialect, context, cvars });
      registerQ1ClientCommands(commands, dialect, () => undefined);
      return { cvars, commands };
    });
    const first = seats[0], second = seats[1]; if (first === undefined || second === undefined) throw new Error("Missing seats");
    first.commands.executeNow('name "First Person"'); second.commands.executeNow('name "Second Person"');
    expect(q2Userinfo(playerUserinfo(first.cvars)).get("name")).toBe("First Person");
    expect(q2Userinfo(playerUserinfo(second.cvars)).get("name")).toBe("Second Person");
    if (dialect === "q1-netquake" || dialect === "q1-quakeworld") {
      first.commands.executeNow("color 5 12"); second.commands.executeNow("color 15");
      expect(q2Userinfo(playerUserinfo(first.cvars)).get("topcolor")).toBe("5");
      expect(q2Userinfo(playerUserinfo(first.cvars)).get("bottomcolor")).toBe("12");
      expect(q2Userinfo(playerUserinfo(second.cvars)).get("topcolor")).toBe("13");
      expect(q2Userinfo(playerUserinfo(second.cvars)).get("bottomcolor")).toBe("13");
    } else {
      first.commands.executeNow('skin "female/athena"'); first.commands.executeNow("fov 115");
      expect(q2Userinfo(playerUserinfo(first.cvars)).get("skin")).toBe("female/athena");
      expect(q2Userinfo(playerUserinfo(first.cvars)).get("fov")).toBe("115");
      expect(q2Userinfo(playerUserinfo(second.cvars)).get("skin")).toBe("male/grunt");
    }
  }
});


test("legacy NetQuake name cvars without userinfo flags still emit one canonical identity", async () => {
  const { registerPlayerUserinfo, playerUserinfo } = await import("../../src/app/bootstrap/player-userinfo.ts");
  const { q2Userinfo } = await import("../../src/content/q2/base/player/index.ts");
  const identity = createIdentityOwner("legacy-local-identity"), context: CommandContext = { session: identity.session, origin: { kind: "local-seat", seat: identity.seat(0), client: identity.client(0, 0) } };
  const cvars = new CvarRegistry({ dialect: "q1-netquake", context });
  cvars.register("name", "Existing Player"); cvars.register("color", "92"); registerPlayerUserinfo(cvars, 0);
  const value = playerUserinfo(cvars);
  expect(q2Userinfo(value).get("name")).toBe("Existing Player");
  expect(value.match(/\\name\\/g)?.length).toBe(1);
  expect(q2Userinfo(value).get("topcolor")).toBe("5"); expect(q2Userinfo(value).get("bottomcolor")).toBe("12");
});
