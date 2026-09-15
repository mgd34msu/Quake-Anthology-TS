import { expect, test } from "bun:test";
import type { CommandContext, CommandDialect } from "../../src/contracts/common.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { CommandBuffer } from "../../src/core/commands/index.ts";
import { CvarRegistry } from "../../src/core/cvars/index.ts";
import { ApplicationConsoleRouting } from "../../src/app/bootstrap/console.ts";
import { queryConsoleEntries, registerDiscoveryCommands } from "../../src/console/discovery.ts";
import { llmConsoleCatalog, validateLlmBatch } from "../../src/console/llm-batch.ts";
import { SeatConsole } from "../../src/console/session.ts";

for (const dialect of ["q1-netquake", "q1-quakeworld", "q2-classic", "q2-rerelease", "q3"] satisfies readonly CommandDialect[]) {
  test(`${dialect} world declaration owns writes, discovery and defaults despite selected-content collisions`, () => {
    const identity = createIdentityOwner(`world-owner-${dialect}`), seat = identity.seat(0);
    const context: CommandContext = { session: identity.session, origin: { kind: "local-seat", seat, client: identity.client(0, 0) } };
    const fallback = new CvarRegistry({ dialect, context }), client = new CvarRegistry({ dialect, context });
    const world = new CvarRegistry({ dialect, context: { session: identity.session, origin: { kind: "server-console" } } });
    const movement = new CvarRegistry({ dialect: "q3", context });
    for (const registry of [fallback, client, movement]) registry.register("sv_gravity", "300");
    world.register("sv_gravity", "800");
    world.document("sv_gravity", { summary: "Current world gravity.", usage: "sv_gravity [value]", examples: ["sv_gravity 800"] });
    const effects: string[] = [];
    world.bindValue("sv_gravity", { validate: () => null, changed: value => { effects.push(value); } });
    const routing = new ApplicationConsoleRouting({ fallback, sourceDialect: () => dialect,
      server: () => ({ cvars: world, sharedNames: [] }), seat: () => client, movement: () => movement });
    const output: string[] = [], commands = new CommandBuffer({ dialect, context, cvars: fallback, cvarRouting: routing, print: text => { output.push(text); } });
    registerDiscoveryCommands(commands, text => { output.push(text); });
    commands.append("sv_gravity 640\nhelp sv_gravity\nfind gravity\n"); commands.execute();
    expect(world.variableString("sv_gravity")).toBe("640");
    expect(effects).toContain("640");
    for (const registry of [fallback, client, movement]) expect(registry.variableString("sv_gravity")).toBe("300");
    expect(commands.findCvar("sv_gravity")?.value).toBe("640");
    expect(queryConsoleEntries(commands).filter(entry => entry.name === "sv_gravity")).toHaveLength(1);
    expect(output.join("")).toContain("Current world gravity.");
    expect(output.join("")).toContain('Default: "800"');
    expect(output.join("")).toContain('Current: "640"');
    expect(output.join("")).toContain("1 match(es)");
    expect(llmConsoleCatalog(commands, context, "gravity")).toContain("Current world gravity.");
    const console = new SeatConsole({ seat, context, dialect, commands, cvars: client, now: () => 0,
      connected: () => true, clipboard: () => null, focus: () => undefined, chat: () => { throw new Error("Cvar became chat"); } });
    console.field.setText("sv_grav");
    console.input({ kind: "key", seat, code: 9, down: true, repeat: false, timeMilliseconds: 0 }, { kind: "console" });
    expect(console.field.text).toContain("sv_gravity");
    commands.append(`${validateLlmBatch("sv_gravity 720", commands, context).join("\n")}\n`); commands.execute();
    expect(world.variableString("sv_gravity")).toBe("720");
    client.register("unresolved", "1"); movement.register("unresolved", "2");
    expect(() => routing.owner("unresolved", context)).toThrow("conflicting seat and movement");
  });
}
