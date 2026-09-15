import { expect, test } from "bun:test";
import type { CommandDialect } from "../../src/contracts/common.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { CvarFlag, CvarRegistry, Q2CvarFlag } from "../../src/core/cvars/index.ts";
import { CommandBuffer } from "../../src/core/commands/index.ts";

function fixture(dialect: CommandDialect, flags: number = CvarFlag.Archive) {
  const output: string[] = [], effects: string[] = [];
  const cvars = new CvarRegistry({ dialect, context: { session: createIdentityOwner(`aliases-${dialect}`).session, origin: { kind: "local-console" } }, print: text => { output.push(text); }, cheatsAllowed: () => false });
  cvars.register("canonical", "2", flags);
  cvars.bindValue("canonical", { validate: value => Number.isFinite(Number(value)) && Number(value) > 0 ? null : "must be positive", changed: value => { effects.push(value); } });
  cvars.registerAlias({ name: "alternate", target: "canonical", conversion: { kind: "identity" }, documentation: { summary: "Same value as canonical.", usage: "alternate [value]", examples: [] } });
  cvars.registerAlias({ name: "inverse", target: "canonical", conversion: { kind: "converted", read: value => String(1 / Number(value)),
    write: value => Number.isFinite(Number(value)) && Number(value) > 0 ? { kind: "value", value: String(1 / Number(value)) } : { kind: "invalid", message: "must be positive" } },
    documentation: { summary: "Reciprocal of canonical.", usage: "inverse [value]", examples: [] } });
  return { cvars, output, effects };
}

for (const dialect of ["q1-netquake", "q1-quakeworld", "q2-classic", "q2-rerelease", "q3"] satisfies readonly CommandDialect[]) {
  test(`${dialect} aliases share policy, one state and canonical archives across every console mutation`, () => {
    const { cvars, output, effects } = fixture(dialect);
    const retained = cvars.find("inverse");
    const commands = new CommandBuffer({ dialect, context: cvars.context, cvars });
    commands.append("inverse 0.25\n"); commands.execute();
    expect(cvars.variableString("canonical")).toBe("4"); expect(cvars.variableString("alternate")).toBe("4");
    expect(cvars.find("inverse")?.resetValue).toBe("0.5"); expect(effects).toEqual(["4"]);
    expect(retained?.value).toBe("0.25");
    expect(cvars.indexCount).toBe(1); expect(cvars.canonicalSnapshots()).toHaveLength(1); expect(cvars.snapshots()).toHaveLength(3);
    expect(Object.keys(cvars.get("canonical") ?? {})).toEqual(Object.keys(cvars.get("alternate") ?? {}));
    expect(Object.keys(cvars.get("canonical") ?? {})).not.toContain("next");
    expect(cvars.find("ALTERNATE") !== undefined).toBe(dialect === "q3");
    cvars.setConsole("inverse", "0.5"); expect(cvars.variableString("canonical")).toBe("2");
    cvars.setCommandFlags("inverse", "0.125", "archive"); expect(cvars.variableString("canonical")).toBe("8");
    expect(cvars.archiveEntries()).toEqual([{ name: "canonical", value: "8" }]);
    cvars.stage("inverse", "0.25"); expect(cvars.find("inverse")?.latchedValue).toBe("0.25");
    expect(cvars.find("alternate")?.latchedValue).toBe("4"); cvars.applyLatched("inverse");
    expect(cvars.variableString("canonical")).toBe("4"); cvars.resetConsole("inverse"); expect(cvars.variableString("canonical")).toBe("2");
    cvars.setValue("inverse", 0.25); expect(cvars.variableString("canonical")).toBe("4");
    cvars.clearModified("inverse"); expect(cvars.find("canonical")?.modified).toBe(false);
    cvars.set("inverse", "0"); expect(cvars.variableString("canonical")).toBe("4"); expect(output.join("")).toContain("must be positive");
    cvars.register("inverse", "999", CvarFlag.Cheat); expect(cvars.find("canonical")?.flags).toBe(CvarFlag.Archive);
    const saved = cvars.captureSaveState(); expect(saved.order).toEqual(["canonical"]);
    expect(saved.variables).toHaveLength(1); cvars.set("alternate", "16"); cvars.restoreSaveState(saved);
    expect(cvars.variableString("inverse")).toBe("0.25");
    expect(retained?.value).toBe("0.25");
    const reopened = fixture(dialect).cvars; reopened.applyArchive([{ name: "inverse", value: "0.125" }]);
    expect(reopened.archiveEntries()).toEqual([{ name: "canonical", value: "8" }]);
    if (dialect.startsWith("q2")) { cvars.fullSet("inverse", "0.125", Q2CvarFlag.Archive); expect(cvars.variableString("canonical")).toBe("8"); }
    cvars.set("inverse", "0.25"); commands.append("toggle inverse 0.25 0.5\n"); commands.execute(); expect(cvars.variableString("canonical")).toBe("2");
    effects.length = 0; commands.append("resetall\n"); commands.execute(); expect(effects).toEqual(["2"]);
  });
}

for (const dialect of ["q2-classic", "q2-rerelease", "q3"] satisfies readonly CommandDialect[]) {
  test(`${dialect} alias writes retain canonical protection and latching`, () => {
    for (const flags of dialect === "q3" ? [CvarFlag.ReadOnly, CvarFlag.Cheat, CvarFlag.Init] : [Q2CvarFlag.ReadOnly, Q2CvarFlag.Cheat, Q2CvarFlag.NoSet]) {
      const { cvars } = fixture(dialect, flags); cvars.set("inverse", "0.25"); expect(cvars.variableString("canonical")).toBe("2");
      cvars.set("inverse", "0.25", true); expect(cvars.variableString("canonical")).toBe("4");
    }
    const { cvars } = fixture(dialect, dialect === "q3" ? CvarFlag.Latch : Q2CvarFlag.Latch); cvars.setServerActive(true);
    cvars.set("inverse", "0.25"); expect(cvars.variableString("canonical")).toBe("2"); expect(cvars.find("inverse")?.latchedValue).toBe("0.25");
    cvars.applyLatched("alternate"); expect(cvars.variableString("inverse")).toBe("0.25");
  });
}

test("Q3 VM aliases project converted values and persist handles without duplicate state", () => {
  const { cvars } = fixture("q3"), identity = cvars.registerVm("alternate", "99"), inverse = cvars.registerVm("inverse", "99");
  expect(identity.numericValue).toBe(2); expect(inverse.numericValue).toBe(0.5);
  cvars.set("canonical", "4"); identity.update(); inverse.update(); expect(identity.numericValue).toBe(4); expect(inverse.numericValue).toBe(0.25);
  const handle = cvars.bindVm("inverse", "99"), saved = cvars.captureSaveState();
  expect(saved.variables.filter(value => value !== null)).toHaveLength(1);
  const reopened = fixture("q3").cvars; reopened.restoreSaveState(saved);
  expect(reopened.readVm(handle)?.numericValue).toBe(0.25); expect(reopened.bindVm("inverse", "99")).toBe(handle);
  cvars.set("canonical", "8"); cvars.restoreSaveState(saved); inverse.update(); expect(inverse.numericValue).toBe(0.25);
});

test("alias declarations reject collisions, chains, independent bindings and unsupported protocol keys", () => {
  const { cvars, output } = fixture("q3"), declaration = { conversion: { kind: "identity" }, documentation: { summary: "Alias", usage: "alias", examples: [] } } satisfies Pick<Parameters<CvarRegistry["registerAlias"]>[0], "conversion" | "documentation">;
  for (const [name, target] of [["canonical", "canonical"], ["loop", "loop"], ["next", "inverse"], ["alternate", "canonical"], ["absent", "missing"]]) {
    if (name === undefined || target === undefined) throw new Error("Missing fixture");
    expect(() => cvars.registerAlias({ ...declaration, name, target })).toThrow();
  }
  expect(() => cvars.bindValue("alternate", { validate: () => null, changed: () => undefined })).toThrow("canonical");
  cvars.register("name", "player", CvarFlag.UserInfo);
  for (const flags of [CvarFlag.UserInfo, CvarFlag.ServerInfo, CvarFlag.SystemInfo]) {
    expect(() => cvars.register("alternate", "3", flags)).toThrow("protocol info-key");
    expect(() => cvars.bindVm("inverse", "3", flags)).toThrow("protocol info-key");
    expect(() => cvars.bindVm("alternate", "3", flags)).toThrow("protocol info-key");
  }
  expect(() => cvars.registerAlias({ ...declaration, name: "nickname", target: "name" })).toThrow("protocol info-key");
  cvars.setCommandFlags("alternate", "3", "userinfo"); expect(output.join("")).toContain("protocol info-key");
  expect(cvars.infoString(CvarFlag.UserInfo)).toBe("\\name\\player");
});
