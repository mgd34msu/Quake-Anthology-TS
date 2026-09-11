import { expect, test } from "bun:test";
import type { CommandContext } from "../../src/contracts/common.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { CvarFlag, CvarRegistry, Q2CvarFlag } from "../../src/core/cvars/index.ts";

const context: CommandContext = { session: createIdentityOwner("cvars-smoke").session, origin: { kind: "server-console" } };

test("Q1 declaration defaults, exact identity, newest-first archive and numeric syntax", () => {
  const cvars = new CvarRegistry({ dialect: "q1-netquake", context });
  cvars.register("Name", "1", CvarFlag.Archive);
  cvars.register("name", "0x10", CvarFlag.Archive);
  cvars.register("name", "22");
  expect(cvars.get("name")?.resetValue).toBe("0x10");
  expect(cvars.variableValue("name")).toBe(16);
  cvars.set("name", "1e3"); expect(cvars.variableValue("name")).toBe(1);
  cvars.set("name", "'A"); expect(cvars.variableValue("name")).toBe(65);
  cvars.setValue("Name", 2); expect(cvars.variableString("Name")).toBe("2.000000");
  expect(cvars.set("unknown", "1")).toBeUndefined();
  expect(cvars.archiveCommands()).toEqual(['name "\'A"', 'Name "2.000000"']);
});

test("QW sends independent user/server info, including equal-string writes", () => {
  const cvars = new CvarRegistry({ dialect: "q1-quakeworld", context });
  cvars.register("team", "RED", CvarFlag.UserInfo | CvarFlag.ServerInfo);
  expect(cvars.propagatedInfo("client-userinfo")).toBe("\\team\\red");
  expect(cvars.propagatedInfo("server-info")).toBe("\\team\\RED");
  cvars.takeEffects(); cvars.setClientConnected(true); cvars.set("team", "RED");
  const effects = cvars.takeEffects();
  expect(effects.map(effect => effect.kind)).toEqual(["userinfo", "server-info"]);
  const user = effects[0];
  expect(user?.kind === "userinfo" ? user.command : null).toBe('setinfo "team" "RED"\n');
});

test("Q2 latches in a running server and reports ordered game directory transitions", () => {
  const cvars = new CvarRegistry({ dialect: "q2-classic", context });
  cvars.register("game", "baseq2", Q2CvarFlag.Latch | Q2CvarFlag.Archive);
  cvars.register("Game", "separate");
  cvars.register("name", "old", Q2CvarFlag.UserInfo);
  cvars.setServerActive(true); cvars.clearModified("game");
  cvars.set("game", "ctf");
  expect(cvars.get("game")?.latchedValue).toBe("ctf"); expect(cvars.get("game")?.modified).toBe(false);
  expect(cvars.archiveCommands()).toEqual(['set game "baseq2"']);
  cvars.applyLatched();
  expect(cvars.variableString("game")).toBe("ctf"); expect(cvars.variableString("Game")).toBe("separate");
  expect(cvars.takeEffects()).toEqual([{ kind: "game-directory", context, directory: "ctf", executeAutoexec: true }]);
  cvars.set("game", "rogue"); cvars.set("game", "ctf", true);
  expect(cvars.get("game")?.latchedValue).toBeUndefined();
  cvars.set("name", "new"); expect(cvars.userinfoModified).toBe(true);
  expect(cvars.register("bad;name", "x", Q2CvarFlag.UserInfo)).toBeUndefined();
});

test("Q3 folds ASCII names, preserves pending latches on equal writes, and refreshes VM words", () => {
  const cvars = new CvarRegistry({ dialect: "q3", context });
  const vm = cvars.registerVm("RATE", "1", CvarFlag.Latch | CvarFlag.Archive);
  cvars.set("rate", "2.5"); vm.update();
  expect(vm.value).toBe("1"); expect(vm.modificationCount).toBe(2);
  cvars.set("Rate", "1", true); expect(cvars.get("rate")?.latchedValue).toBe("2.5");
  expect(cvars.archiveCommands()).toEqual(['seta RATE "2.5"']);
  cvars.register("rate", "9", 0); vm.update();
  expect(vm.value).toBe("2.5"); expect(vm.integerValue).toBe(2); expect(vm.modificationCount).toBe(3);
  vm.writeInteger(7); vm.update(); expect(vm.integerValue).toBe(7);
  cvars.set("user", "3"); const handle = cvars.bindVm("user", "", CvarFlag.UserCreated);
  cvars.resetAll(); expect(cvars.readVm(handle)).toBeUndefined();
  expect(cvars.variableString("rate")).toBe("1");
});

test("Q3 protection, binary32 set formatting, and normal versus big info ordering", () => {
  const cvars = new CvarRegistry({ dialect: "q3", context });
  cvars.register("a", "1", CvarFlag.UserInfo | CvarFlag.ReadOnly);
  cvars.register("b", "2", CvarFlag.UserInfo);
  cvars.set("a", "3"); expect(cvars.variableString("a")).toBe("1");
  cvars.set("a", "3", true); expect(cvars.variableString("a")).toBe("3");
  expect(cvars.infoString(CvarFlag.UserInfo)).toBe("\\a\\3\\b\\2");
  expect(cvars.infoString(CvarFlag.UserInfo, 8192)).toBe("\\b\\2\\a\\3");
  cvars.setValue("fraction", 0.1); expect(cvars.variableString("fraction")).toBe("0.100000");
  expect(cvars.variableValue("fraction")).toBe(Math.fround(0.1));
});
