import { expect, test } from "bun:test";
import type { CommandContext, CommandDialect } from "../../src/contracts/common.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { CvarRegistry, CvarFlag } from "../../src/core/cvars/index.ts";
import { CommandBuffer } from "../../src/core/commands/index.ts";
import { SeatConsole } from "../../src/console/session.ts";
import { ApplicationConsoleRouting } from "../../src/app/bootstrap/console.ts";
import { FrameTimeCvarMirror, frameTimeCvarNames, registerFrameTimeCvars } from "../../src/app/bootstrap/frame-time.ts";
import { cvarTable } from "../../src/content/q3/presentation/config.ts";

for (const dialect of ["q1-netquake", "q1-quakeworld", "q2-classic", "q2-rerelease", "q3"] satisfies readonly CommandDialect[]) {
  test(`${dialect} real console discovery routes engine time to one source and updates both seat mirrors`, () => {
    const identity = createIdentityOwner(`time-owner-${dialect}`), seats = [identity.seat(0), identity.seat(1)];
    const sourceContext: CommandContext = { session: identity.session, origin: { kind: "server-console" } };
    const source = new CvarRegistry({ dialect, context: sourceContext, cheatsAllowed: () => true });
    const oldSave = source.captureSaveState(); source.restoreSaveState(oldSave);
    registerFrameTimeCvars(source);
    const declarations = source.snapshots().map(value => ({ name: value.name, flags: value.flags, resetValue: value.resetValue }));
    const clients = seats.map((seat, index) => {
      const context: CommandContext = { session: identity.session, origin: { kind: "local-seat", seat, client: identity.client(index, 0) } };
      const cvars = new CvarRegistry({ dialect, context, cheatsAllowed: () => true });
      if (dialect === "q3") for (const item of cvarTable("baseq3")) cvars.register(item.name, item.defaultValue, item.flags);
      const mirror = new FrameTimeCvarMirror(source, cvars, () => undefined);
      return { seat, context, cvars, mirror };
    });
    const first = clients[0], second = clients[1]; if (first === undefined || second === undefined) throw new Error("Missing test seat");
    const route = new ApplicationConsoleRouting({ fallback: first.cvars, sourceDialect: () => dialect,
      server: () => ({ cvars: source, sharedNames: frameTimeCvarNames(dialect) }), seat: seat => clients.find(client => client.seat.equals(seat))?.cvars ?? null });
    const commands = new CommandBuffer({ dialect, context: first.context, cvars: first.cvars, cvarRouting: route });
    const console = new SeatConsole({ seat: first.seat, context: first.context, dialect, commands, cvars: first.cvars,
      now: () => 0, connected: () => true, clipboard: () => null, focus: () => undefined, chat: () => { throw new Error("Time command became chat"); } });
    try {
      for (const name of frameTimeCvarNames(dialect)) {
        console.field.setText(`${name} 2`); console.submit(); commands.execute();
        expect(source.variableString(name)).toBe("2"); expect(first.cvars.variableString(name)).toBe("2"); expect(second.cvars.variableString(name)).toBe("2");
        expect(route.owner(name, first.context)).toBe(source);
        second.cvars.set(name, "0.5", true);
        expect(source.variableString(name)).toBe("0.5"); expect(first.cvars.variableString(name)).toBe("0.5");
      }
      expect(source.snapshots().map(value => ({ name: value.name, flags: value.flags, resetValue: value.resetValue }))).toEqual(declarations);
      const saved = source.captureSaveState(); source.set("timescale", "3", true); source.restoreSaveState(saved);
      expect(first.cvars.variableString("timescale")).toBe("0.5"); expect(second.cvars.variableString("timescale")).toBe("0.5");
      first.mirror.close(); source.set("timescale", "4", true);
      expect(first.cvars.variableString("timescale")).toBe("0.5"); expect(second.cvars.variableString("timescale")).toBe("4");
    } finally { for (const client of clients) client.mirror.close(); }
    for (const name of frameTimeCvarNames(dialect)) {
      const release = source.bindValue(name, { validate: () => null, changed: () => undefined }); release();
    }
  });
}

test("Q3 source cheat flags remain effective while authoritative updates reach cgame mirrors", () => {
  const identity = createIdentityOwner("protected-time"), context: CommandContext = { session: identity.session, origin: { kind: "server-console" } };
  const source = new CvarRegistry({ dialect: "q3", context, cheatsAllowed: () => false }); registerFrameTimeCvars(source);
  const seat = new CvarRegistry({ dialect: "q3", context, cheatsAllowed: () => false });
  const binding = new FrameTimeCvarMirror(source, seat, () => undefined);
  try {
    source.set("com_cameraMode", "1"); expect(source.variableString("com_cameraMode")).toBe("0");
    seat.set("com_cameraMode", "1"); expect(source.variableString("com_cameraMode")).toBe("0");
    source.set("timescale", "0.5", true); expect(seat.variableString("timescale")).toBe("0.5");
    expect(source.find("timescale")?.flags).toBe(CvarFlag.Cheat | CvarFlag.SystemInfo);
    expect(source.find("com_cameraMode")?.flags).toBe(CvarFlag.Cheat);
  } finally { binding.close(); }
});
