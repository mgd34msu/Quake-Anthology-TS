import { expect, test } from "bun:test";
import type { CommandContext, CommandDialect } from "../../src/contracts/common.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { CommandBuffer } from "../../src/core/commands/index.ts";
import { archivedBindings, registerBindingCommands } from "../../src/input/bindings.ts";
import { SeatInput } from "../../src/input/seat.ts";
import { queryConsoleEntries, registerDiscoveryCommands } from "../../src/console/discovery.ts";
import { llmConsoleCatalog } from "../../src/console/llm-batch.ts";

for (const dialect of ["q1-netquake", "q1-quakeworld", "q2-classic", "q2-rerelease", "q3"] satisfies readonly CommandDialect[]) {
  test(`${dialect} binding diagnostics preserve valid commands and the other seat`, () => {
    const identity = createIdentityOwner(`binding-family-${dialect}`), seat = identity.seat(0), otherSeat = identity.seat(1);
    const context: CommandContext = { session: identity.session, origin: { kind: "local-seat", seat, client: identity.client(0, 0) } };
    const otherContext: CommandContext = { session: identity.session, origin: { kind: "local-seat", seat: otherSeat, client: identity.client(1, 0) } };
    const output: string[] = [], calls: string[] = [];
    const commands = new CommandBuffer({ dialect, context, print: text => { output.push(text); } });
    commands.register("record", command => { calls.push(command.args.join(" ")); });
    let input = new SeatInput({ seat, dialect, context, commands, uiEvent: () => false });
    const other = new SeatInput({ seat: otherSeat, dialect, context: otherContext, commands, uiEvent: () => false });
    const removeBindings = registerBindingCommands(commands, id => id.equals(seat) ? input : id.equals(otherSeat) ? other : null, text => { output.push(text); });
    const removeDiscovery = registerDiscoveryCommands(commands, text => { output.push(text); });
    const run = (text: string, source = context): void => { commands.append(`${text}\n`, source); commands.execute(); };
    try {
      run('bind MOUSE2 "record  first; record   second"'); run('bind Q "record other"', otherContext);
      run("bind T record one two");
      expect(input.binding({ kind: "key", code: 116 })).toEqual({ kind: "command", text: "record one two" });
      const rightMouse = { kind: "mouse-button", button: 3 } satisfies import("../../src/contracts/ui.ts").PhysicalInput;
      expect(input.binding(rightMouse)).toEqual({ kind: "command", text: "record  first; record   second" });
      run("bind mouse2"); expect(output.at(-1)).toBe("MOUSE2 = record  first; record   second\n");
      for (const command of ["unbind", "unbind MOUSE2 extra"]) {
        run(command); expect(output.at(-1)).toBe("unbind <key> : remove commands from a key\n");
        expect(input.binding(rightMouse)?.kind).toBe("command");
      }
      run("unbind UNKNOWN_KEY"); expect(output.at(-1)).toBe("Unknown key UNKNOWN_KEY\n");
      run("unbind MOUSE2", { session: identity.session, origin: { kind: "server-console" } });
      expect(output.at(-1)).toBe("unbind requires a local seat.\n"); expect(input.binding(rightMouse)?.kind).toBe("command");
      const saved = archivedBindings(input); expect(saved).toContain('bind "MOUSE2" "record  first; record   second"');
      run("unbindall"); expect(input.bindings).toEqual([]); expect(other.binding({ kind: "key", code: 113 })).toEqual({ kind: "command", text: "record other" });
      input = new SeatInput({ seat, dialect, context, commands, uiEvent: () => false });
      run(saved.join("\n")); run("bindlist"); expect(output).toContain("MOUSE2 = record  first; record   second\n");
      input.input({ kind: "mouse-button", seat, button: 3, down: true, timeMilliseconds: 1 });
      input.input({ kind: "mouse-button", seat, button: 3, down: false, timeMilliseconds: 2 }); commands.execute();
      expect(calls).toEqual(["first", "second"]);
      run("unbind mouse2"); run("bind MOUSE2"); expect(output.at(-1)).toBe("MOUSE2 = Unbound\n");
      expect(archivedBindings(input).some(line => line.includes('"MOUSE2"'))).toBe(false);
      for (const name of ["bind", "unbind", "unbindall", "bindlist"]) {
        const entry = queryConsoleEntries(commands).find(entry => entry.name === name);
        expect(entry?.summary).toBeDefined(); expect(entry?.examples.length).toBeGreaterThan(0);
        run(`help ${name}`); expect(output.at(-1)).toContain(`Usage: ${name}`);
      }
      expect(llmConsoleCatalog(commands, context, "unbind")).toContain("Remove a key or mouse binding");
    } finally { removeDiscovery(); removeBindings(); }
  });
}
