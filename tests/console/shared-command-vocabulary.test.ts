import { expect, test } from "bun:test";
import type { CommandContext, CommandDialect } from "../../src/contracts/common.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { CommandBuffer } from "../../src/core/commands/index.ts";
import { CvarFlag, CvarRegistry } from "../../src/core/cvars/index.ts";
import { ApplicationConsoleRouting } from "../../src/app/bootstrap/console.ts";
import { queryConsoleEntries } from "../../src/console/discovery.ts";

for (const dialect of ["q1-netquake", "q1-quakeworld", "q2-classic", "q2-rerelease", "q3"] satisfies readonly CommandDialect[]) {
  test(`${dialect} shared set/list/vstr commands use canonical owners and retain script order`, () => {
    const identity = createIdentityOwner(`shared-vocabulary-${dialect}`);
    const context: CommandContext = { session: identity.session, origin: { kind: "local-seat", seat: identity.seat(0), client: identity.client(0, 0) } };
    const fallback = new CvarRegistry({ dialect, context });
    const shared = new CvarRegistry({ dialect: "q3", context });
    shared.register("gain", "1", CvarFlag.Archive);
    shared.registerAlias({ name: "foreign_gain", target: "gain", conversion: { kind: "identity" }, documentation: {
      summary: "Shared effects gain.", usage: "foreign_gain <value>", examples: ["foreign_gain 0.5"] } });
    shared.register("locked", "original", CvarFlag.ReadOnly);
    shared.register("sequence", "set foreign_gain 0.25; wait; set foreign_gain 0.5");
    const effects: string[] = [], output: string[] = [];
    shared.bindValue("gain", { validate: () => null, changed: value => { effects.push(value); } });
    const routing = new ApplicationConsoleRouting({ fallback, sourceDialect: () => dialect, server: () => null, seat: () => fallback, shared: () => shared });
    const commands = new CommandBuffer({ dialect, context, cvars: fallback, cvarRouting: routing, print: text => { output.push(text); } });
    commands.append("set foreign_gain 0.75\nset locked changed\nvstr sequence\nset foreign_gain 0.875\ncmdlist\ncvarlist\n");
    commands.execute();
    expect(shared.variableString("gain")).toBe("0.25");
    expect(shared.variableString("locked")).toBe("original");
    expect(fallback.find("foreign_gain")).toBeUndefined();
    commands.execute();
    expect(effects).toEqual(["0.75", "0.25", "0.5", "0.875"]);
    expect(shared.variableString("gain")).toBe("0.875");
    expect(commands.hasPendingCommands).toBe(false);
    expect(output.join("")).toContain('gain "0.875"');
    for (const name of ["set", "cmdlist", "cvarlist", "vstr"]) {
      expect(queryConsoleEntries(commands).find(entry => entry.name === name)?.kind).toBe("command");
      expect(commands.commandDocumentation(name)?.usage).toBeDefined();
    }
  });
}
