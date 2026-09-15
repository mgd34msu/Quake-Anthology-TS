import { expect, test } from "bun:test";
import type { CommandDialect } from "../../src/contracts/common.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { CommandBuffer } from "../../src/core/commands/index.ts";
import { registerQ1ClientCommands } from "../../src/app/bootstrap/q1-client-commands.ts";

for (const dialect of ["q1-netquake", "q1-quakeworld", "q2-classic", "q2-rerelease", "q3"] satisfies readonly CommandDialect[])
  test(`${dialect} discovers and dispatches the cheat family without chat fallback`, () => {
    const identity = createIdentityOwner(`cheat-catalog-${dialect}`), calls: string[] = [];
    const commands = new CommandBuffer({ dialect, context: { session: identity.session, origin: { kind: "local-console" } } });
    registerQ1ClientCommands(commands, dialect, (name, args) => { calls.push([name, ...args].join(" ")); return undefined; });
    for (const name of ["god", "notarget", "noclip", "give", "giveall", "kill", "suicide"]) expect(commands.exists(name)).toBe(true);
    commands.append("give all; giveall; suicide\n"); commands.execute(); expect(calls).toEqual(["give all", "give all", "kill"]);
    expect(commands.exists("fly")).toBe(dialect === "q1-netquake");
  });
