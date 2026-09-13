import { expect, test } from "bun:test";
import type { CommandContext } from "../../src/contracts/common.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { CommandBuffer } from "../../src/core/commands/index.ts";
import { CvarRegistry } from "../../src/core/cvars/index.ts";
import { findConsoleEntries, queryConsoleEntries } from "../../src/console/discovery.ts";
import { registerLlmCommands } from "../../src/console/llm.ts";
import { SeatConsole } from "../../src/console/session.ts";

test("LLM placeholders preserve the invoking seat, expose usage, and never execute requests or chat", () => {
  const identity = createIdentityOwner("llm-console"), seat = identity.seat(1);
  const source: CommandContext = { session: identity.session, origin: { kind: "local-seat", seat, client: identity.client(1, 0) } };
  const output: { readonly text: string; readonly source: CommandContext }[] = [];
  let effects = 0, chats = 0;
  const commands = new CommandBuffer({ dialect: "q3", context: { session: identity.session, origin: { kind: "local-console" } },
    forwardToServer: () => { effects++; }, clientGame: () => { effects++; return true; } });
  commands.register("sentinel", () => { effects++; return undefined; });
  const remove = registerLlmCommands(commands, (text, context) => { output.push({ text, source: context }); });
  const console = new SeatConsole({ seat, context: source, dialect: "q3", commands, cvars: new CvarRegistry({ dialect: "q3", context: source }), now: () => 0,
    connected: () => true, clipboard: () => null, focus: () => undefined, chat: () => { chats++; } });
  for (const text of ["llm_ask", 'llm_exec "   "', 'llm_ask "sentinel; sentinel"', 'llm_exec "sentinel; sentinel"']) {
    console.field.setText(text);
    console.input({ kind: "key", seat, code: 13, down: true, repeat: false, timeMilliseconds: 0 }, { kind: "console" });
    commands.execute();
  }
  expect(output.map(entry => entry.text)).toEqual([
    "Usage: llm_ask <question>\nQuote text containing semicolons.\n",
    "Usage: llm_exec <request>\nQuote text containing semicolons.\n",
    "LLM integration is not configured.\n", "LLM integration is not configured.\n",
  ]);
  for (const entry of output) expect(entry.source).toEqual(source);
  expect(effects).toBe(0); expect(chats).toBe(0);
  expect(commands.pendingText).toBe(""); expect(commands.deferredText).toBe("");
  expect(findConsoleEntries(commands, "llm_").map(entry => entry.name)).toEqual(["llm_ask", "llm_exec"]);
  expect(queryConsoleEntries(commands).find(entry => entry.name === "llm_exec")?.summary).toContain("Placeholder");
  remove();
  expect(commands.exists("llm_ask")).toBe(false); expect(commands.exists("llm_exec")).toBe(false);
});
