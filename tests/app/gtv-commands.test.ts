import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { test, expect } from "bun:test";
import { parseGtvConnect, matchesGtvDisconnect, registerGtvCvars } from "../../src/app/bootstrap/gtv-commands.ts";
import { CvarRegistry, Q2CvarFlag } from "../../src/core/cvars/index.ts";
import { tokenizeCommand } from "../../src/core/commands/index.ts";

test("native GTV options preserve quoted credentials and keep channel label separate", () => {
  const args = tokenizeCommand('mvdconnect -n "Match one" --user viewer -p "two words" 127.0.0.1:27911', "q2-classic").argv.slice(1);
  expect(parseGtvConnect(args, { username: "default", password: "default" })).toEqual({ address: "127.0.0.1:27911", username: "viewer", password: "two words", label: "Match one" });
  expect(parseGtvConnect(["localhost"], { username: "unnamed", password: "secret" })).toEqual({ address: "localhost", username: "unnamed", password: "secret", label: null });
  expect(() => parseGtvConnect(["-p"], { username: "", password: "" })).toThrow("Missing value");
  expect(() => parseGtvConnect(["a", "b"], { username: "", password: "" })).toThrow("Usage");
});
test("GTV disconnect resolves the actual retained channel identity", () => {
  const current = { id: 3, label: "Match one" };
  for (const args of [[], ["3"], ["Match one"], ["-a"], ["--all"]]) expect(matchesGtvDisconnect(args, current)).toBe(true);
  expect(() => matchesGtvDisconnect(["2"], current)).toThrow("No such connection");
  expect(() => matchesGtvDisconnect([], null)).toThrow("No GTV connections");
});
test("GTV source declarations preserve configured values and mark password private", () => {
  const cvars = new CvarRegistry({ dialect: "q2-classic", context: { session: createIdentityOwner("gtv-command-test").session, origin: { kind: "local-console" } } });
  registerGtvCvars(cvars); cvars.set("mvd_username", "viewer"); cvars.set("mvd_password", "fixture"); registerGtvCvars(cvars);
  expect(cvars.variableString("mvd_username")).toBe("viewer");
  expect(cvars.variableString("mvd_password")).toBe("fixture");
  expect((cvars.find("mvd_password")?.flags ?? 0) & Q2CvarFlag.Private).toBe(Q2CvarFlag.Private);
});
