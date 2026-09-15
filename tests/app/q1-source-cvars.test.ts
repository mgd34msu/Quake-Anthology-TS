import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { CvarFlag, CvarRegistry } from "../../src/core/cvars/index.ts";
import { cloneQ1SourceCvars, registerQ1BotControls } from "../../src/app/bootstrap/q1-source-cvars.ts";

function source(output: string[]): CvarRegistry {
  return new CvarRegistry({ dialect: "q1-netquake", context: { session: createIdentityOwner("q1-world-transfer").session, origin: { kind: "server-console" } },
    print: text => { output.push(text); } });
}

test("staged Q1 registry retains complete engine and custom declarations without sharing state", () => {
  const output: string[] = [], previous = source(output);
  for (const [name, value] of [["timescale", "1"], ["maxclients", "1"], ["g_gametype", "2"], ["registered", "1"], ["sv_aim", "0.93"], ["mod_native", "17"]] satisfies readonly (readonly [string, string])[])
    previous.register(name, value, CvarFlag.Archive);
  previous.set("timescale", "0.5"); previous.set("mod_native", "23");
  previous.applyArchive([{ name: "mod_console", value: "31" }]);
  registerQ1BotControls(previous); previous.set("bot_minplayers", "2");
  const before = previous.captureSaveState(), candidate = cloneQ1SourceCvars(previous, text => { output.push(text); });
  registerQ1BotControls(candidate);
  expect(candidate.captureSaveState()).toEqual(before);
  expect(candidate.context).toBe(previous.context);
  expect(candidate.snapshots().filter(variable => variable.name === "bot_minplayers")).toHaveLength(1);
  expect(candidate.find("mod_native")).toMatchObject({ value: "23", resetValue: "17", flags: CvarFlag.Archive });
  expect(candidate.isConsoleCreated("mod_console")).toBe(true);
  candidate.set("timescale", "2"); candidate.reset("mod_native"); candidate.register("candidate_only", "1");
  expect(candidate.variableString("mod_native")).toBe("17");
  expect(previous.captureSaveState()).toEqual(before);
  expect(previous.find("candidate_only")).toBeUndefined();
  expect(output).toEqual([]);
});

test("native bot declaration adopts an archived console variable once and retains its value", () => {
  const output: string[] = [], previous = source(output);
  previous.applyArchive([{ name: "bot_minplayers", value: "3" }]);
  registerQ1BotControls(previous); registerQ1BotControls(previous);
  expect(previous.find("bot_minplayers")).toMatchObject({ value: "3", resetValue: "0" });
  expect(previous.isConsoleCreated("bot_minplayers")).toBe(false); expect(output).toEqual([]);
});

test("world staging leaves pending effects on the old owner without replaying them on the candidate", () => {
  const previous = source([]);
  previous.register("notified", "0", CvarFlag.ServerInfo); previous.setServerActive(true); previous.set("notified", "1");
  expect(() => previous.captureSaveState()).toThrow("Cvar save requires drained effects");
  expect(() => previous.captureQuakeCState()).toThrow("Cvar save requires drained effects");
  const candidate = cloneQ1SourceCvars(previous, () => {});
  expect(candidate.takeEffects()).toEqual([]);
  expect(candidate.variableString("notified")).toBe("1");
  expect(() => previous.captureSaveState()).toThrow("Cvar save requires drained effects");
  const effects = previous.takeEffects();
  expect(effects.length).toBeGreaterThan(0);
  expect(previous.variableString("notified")).toBe("1");
  expect(candidate.captureSaveState()).toEqual(previous.captureSaveState());
});
