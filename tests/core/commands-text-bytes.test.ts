import { expect, test } from "bun:test";
import type { CommandContext, CommandDialect } from "../../src/contracts/common.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { CommandBuffer, tokenizeCommand } from "../../src/core/commands/index.ts";
import { CvarRegistry } from "../../src/core/cvars/index.ts";

const dialects: readonly CommandDialect[] = ["q1-netquake", "q1-quakeworld", "q2-classic", "q2-rerelease", "q3"];
for (const dialect of dialects) test(`${dialect} console echo preserves unquoted high bytes and native byte limits`, () => {
  const owner = createIdentityOwner(`echo-bytes-${dialect}`);
  const context: CommandContext = { session: owner.session, origin: { kind: "local-seat", seat: owner.seat(0), client: owner.client(0, 0) } };
  const printed: string[] = [];
  const cvars = new CvarRegistry({ dialect, context });
  const commands = new CommandBuffer({ dialect, context, cvars, print: text => printed.push(text) });
  commands.append("echo ASCII ABC xyz é Ü ä ñ gyp\n", context);
  commands.execute();
  expect(printed.join("")).toContain("ASCII ABC xyz é Ü ä ñ gyp");
  expect(tokenizeCommand('echo café "déjà vu" \tmañana\r', dialect, "console").argv).toEqual(["echo", "café", "déjà vu", "mañana"]);
  expect(tokenizeCommand("echo \x80\xff\0ignored", dialect, "console").argv).toEqual(["echo", "\x80\xff"]);
  expect(tokenizeCommand("echo é Ü ä ñ gyp", dialect).argv).toEqual(["echo", "gyp"]);
  expect(tokenizeCommand('grant "q1:shotgun"', dialect, "console").argv).toEqual(["grant", "q1:shotgun"]);
  const script: CommandContext = { session: owner.session, origin: { kind: "script", name: "source.cfg", caller: context.origin } };
  printed.length = 0;
  commands.append("echo é Ü ä ñ gyp\n", script); commands.execute();
  expect(printed.join("")).toBe("gyp \n");
  printed.length = 0;
  if (dialect === "q3") {
    cvars.register("greeting", "echo café;echo déjà", 0);
    commands.append("vstr greeting\n", context);
  } else {
    commands.append('alias greeting "echo café;echo déjà"\ngreeting\n', context);
  }
  commands.execute();
  expect(printed.join("")).toContain("café");
  expect(printed.join("")).toContain("déjà");
  if (dialect !== "q3") {
    printed.length = 0;
    commands.append('alias source_greeting "echo café"\n', script); commands.execute();
    commands.append("source_greeting\n", context); commands.execute();
    expect(printed.join("")).toBe("caf \n");
  }
  if (dialect === "q2-classic" || dialect === "q2-rerelease") {
    cvars.register("café", "déjà", 0);
    printed.length = 0;
    commands.append("echo $café\n", context); commands.execute();
    expect(printed.join("")).toBe("déjà \n");
  }
  const remote: CommandContext = { session: owner.session, origin: { kind: "remote-client", client: owner.client(1, 0) } };
  printed.length = 0;
  commands.append("echo é Ü ä ñ gyp\n", remote); commands.execute();
  expect(printed.join("")).toBe("gyp \n");
  expect(() => commands.append("echo \u0100\n", context)).toThrow("source bytes");
});
