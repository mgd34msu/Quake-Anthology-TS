import { expect, test } from "bun:test";
import type { CommandContext } from "../../src/contracts/common.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { CommandBuffer } from "../../src/core/commands/index.ts";

test("scoped command output includes awaited script diagnostics and restores in finally", async () => {
  const owner = createIdentityOwner("command-output");
  const context: CommandContext = { session: owner.session, origin: { kind: "local-console" } };
  const original: string[] = [], redirected: string[] = [], sources: (CommandContext | undefined)[] = [];
  const commands = new CommandBuffer({ dialect: "q3", context, print: text => { original.push(text); },
    readScript: async name => { if (name === "bad.cfg") throw new Error("read failed"); return "echo script\n"; } });
  const release = commands.bindOutput((text, source) => { redirected.push(text); sources.push(source); });
  try {
    commands.append("echo before\nexec good\nexec bad\n");
    await commands.executeScriptsAsync(async () => {});
    commands.register("fail", () => { throw new Error("handler failed"); });
    expect(() => commands.executeNow("fail")).toThrow("handler failed");
  } finally { release(); }
  commands.executeNow("echo restored");
  expect(original).toEqual(["restored \n"]);
  expect(redirected.join("")).toContain("execing good.cfg");
  expect(redirected.join("")).toContain("script \n");
  expect(redirected.join("")).toContain("couldn't exec bad.cfg: read failed");
  expect(sources.every(source => source?.session === owner.session)).toBe(true);
});

test("output bindings can be released out of order without restoring retired receivers", () => {
  const owner = createIdentityOwner("command-output-nesting");
  const original: string[] = [], first: string[] = [], second: string[] = [];
  const commands = new CommandBuffer({ dialect: "q3", context: { session: owner.session, origin: { kind: "local-console" } }, print: text => { original.push(text); } });
  const releaseFirst = commands.bindOutput(text => { first.push(text); });
  const releaseSecond = commands.bindOutput(text => { second.push(text); });
  releaseFirst(); commands.executeNow("echo second"); releaseSecond(); releaseSecond();
  commands.executeNow("echo original");
  expect(first).toEqual([]); expect(second).toEqual(["second \n"]); expect(original).toEqual(["original \n"]);
});
