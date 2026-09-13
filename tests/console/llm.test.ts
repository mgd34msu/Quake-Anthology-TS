import { expect, test } from "bun:test";
import type { CommandContext } from "../../src/contracts/common.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { CommandBuffer } from "../../src/core/commands/index.ts";
import { CvarFlag, CvarRegistry } from "../../src/core/cvars/index.ts";
import { registerLlmCommands, type LlmCommandRequester } from "../../src/console/llm.ts";
import { llmExecInstructions } from "../../src/console/llm-batch.ts";
import { SeatInput } from "../../src/input/seat.ts";
import type { LlmRequestInput } from "../../src/llm/request.ts";

function fixture(dialect: "q3" | "q1-netquake" | "q2-classic" = "q3") {
  const identity = createIdentityOwner("llm-test");
  const source: CommandContext = { session: identity.session, origin: { kind: "local-seat", seat: identity.seat(0), client: identity.client(0, 0) } };
  const second: CommandContext = { session: identity.session, origin: { kind: "local-seat", seat: identity.seat(1), client: identity.client(1, 0) } };
  const output: { text: string; source: CommandContext }[] = [], effects: CommandContext[] = [];
  const cvars = new CvarRegistry({ dialect, context: source });
  cvars.register("sensitivity", "3", 0); cvars.register("password", "SECRET-MUST-STAY-LOCAL", 0);
  const commands = new CommandBuffer({ dialect, context: source, cvars });
  commands.register("game_action", invocation => { effects.push(invocation.source); return undefined; }, { summary: "Perform the game action.", usage: "game_action", examples: ["game_action"] });
  const requests: { input: LlmRequestInput; resolve: (answer: string) => void }[] = [];
  const requester: LlmCommandRequester = { request: input => new Promise<string>(resolve => requests.push({ input, resolve })) };
  const remove = registerLlmCommands(commands, (text, context) => output.push({ text, source: context }), requester);
  const send = (text: string, context = source): void => { commands.append(text + "\n", context); commands.execute(); };
  return { identity, source, second, output, effects, cvars, commands, requests, remove, send };
}
async function settle(): Promise<void> { await Promise.resolve(); await Promise.resolve(); }

test("LLM asks route answers independently to the invoking seats and reject duplicate requests", async () => {
  const f = fixture();
  f.send('llm_ask "first question"'); f.send('llm_ask "second question"', f.second); f.send('llm_ask "duplicate"');
  expect(f.requests).toHaveLength(2);
  f.requests[1]?.resolve("second answer"); f.requests[0]?.resolve("first answer"); await settle();
  expect(f.output.map(entry => [entry.text, entry.source])).toEqual([
    ["LLM request started.\n", f.source], ["LLM request started.\n", f.second], ["An LLM request is already running in this console.\n", f.source], ["second answer\n", f.second], ["first answer\n", f.source],
  ]);
  expect(f.requests[0]?.input.prompt).toBe("first question"); expect(f.requests[0]?.input.instructions).toContain("Examples: game_action"); f.remove();
});

test("LLM validates the entire batch before performing its first action", async () => {
  const f = fixture(); f.send('llm_exec "do a thing"');
  f.requests[0]?.resolve("game_action; imaginary_command"); await settle();
  expect(f.effects).toHaveLength(0); expect(f.output[1]?.text).toContain("Unknown command"); f.remove();
});

test("LLM executes registered game commands and cvars in the original context, preserving quoted semicolons", async () => {
  const f = fixture(); let literal = "";
  f.commands.register("record", invocation => { literal = invocation.args[0] ?? ""; return undefined; });
  f.send('llm_exec "make changes"', f.second);
  f.requests[0]?.resolve('sensitivity 5; record "a;b"; game_action'); await settle();
  expect(f.cvars.variableString("sensitivity")).toBe("5"); expect(literal).toBe("a;b"); expect(f.effects).toEqual([f.second]);
  expect(f.output[1]).toEqual({ text: 'sensitivity 5; record "a;b"; game_action\n', source: f.second }); f.remove();
});

test("LLM rejects server, remote client, script, and alias request origins without a provider call", () => {
  const f = fixture("q1-netquake");
  for (const origin of [
    { kind: "server-console" }, { kind: "remote-client", client: f.identity.client(5, 0) },
    { kind: "script", name: "server-stufftext", caller: f.source.origin },
  ] satisfies readonly CommandContext["origin"][]) f.send('llm_exec "game_action"', { session: f.identity.session, origin });
  f.commands.executeNow('llm_ask "UI syscall"', { session: f.identity.session, origin: { kind: "script", name: "q3-ui", caller: f.source.origin } });
  f.commands.defineAlias("paid", 'llm_ask "question"\n'); f.send("paid");
  expect(f.requests).toHaveLength(0); expect(f.effects).toHaveLength(0); f.remove();
});

test("LLM disposal aborts transport and ignores late commands and answers", async () => {
  const f = fixture(); f.send('llm_exec "do it"'); f.send('llm_ask "question"', f.second); f.remove();
  expect(f.requests.every(request => request.input.signal?.aborted)).toBe(true);
  f.requests[0]?.resolve("game_action"); f.requests[1]?.resolve("late answer"); await settle();
  expect(f.effects).toHaveLength(0); expect(f.output.map(entry => entry.text)).toEqual(["LLM request started.\n", "LLM request started.\n"]);
});

test("LLM rejects malformed, recursive, script, oversized, and macro batches wholesale", async () => {
  for (const answer of ['game_action; echo "unterminated', "game_action; llm_ask hello", "game_action; exec file.cfg", "game_action; loop", "game_action; paid", "game_action; wait", "game_action; $password", "game_action\n".repeat(33)]) {
    const f = fixture("q2-classic"); f.commands.defineAlias("loop", "loop\n"); f.commands.defineAlias("paid", 'llm_exec "recurse"\n');
    f.send('llm_exec "do it"'); f.requests[0]?.resolve(answer); await settle();
    expect(f.effects).toHaveLength(0); expect(f.output[1]?.text).toContain("LLM request failed:"); f.remove();
  }
});

test("LLM expands and validates existing aliases before execution", async () => {
  const f = fixture("q1-netquake"); f.commands.defineAlias("safe", "game_action; sensitivity 8\n");
  f.send('llm_exec "use safe"'); f.requests[0]?.resolve("safe"); await settle();
  expect(f.effects).toEqual([f.source]); expect(f.cvars.variableString("sensitivity")).toBe("8");
  expect(f.output[1]?.text).toBe("game_action; sensitivity 8\n"); f.remove();
});

test("LLM exec catalog includes actual registry usage and all names without variable values or alias bodies", () => {
  const f = fixture("q1-netquake"); f.commands.defineAlias("custom_alias", "echo SECRET-ALIAS-BODY\n");
  const instructions = llmExecInstructions(f.commands, f.source, "perform game action");
  expect(instructions).toContain("game_action: game_action. Perform the game action."); expect(instructions).toContain("alias:custom_alias");
  expect(instructions).toContain("cvar:password"); expect(instructions).not.toContain("SECRET-MUST-STAY-LOCAL"); expect(instructions).not.toContain("SECRET-ALIAS-BODY"); f.remove();
});

test("LLM execution leaves preexisting buffered commands for their normal frame", async () => {
  const f = fixture(); f.send('llm_exec "adjust sensitivity"');
  f.commands.append("game_action\n", f.second);
  f.requests[0]?.resolve("sensitivity 9"); await settle();
  expect(f.cvars.variableString("sensitivity")).toBe("9"); expect(f.effects).toHaveLength(0);
  expect(f.commands.pendingText).toBe("game_action\n"); f.commands.execute(); expect(f.effects).toEqual([f.second]); f.remove();
});

test("LLM-generated game commands cannot indirectly trigger another paid request", async () => {
  const f = fixture();
  f.commands.register("indirect", invocation => { invocation.executeNow('llm_ask "nested question"'); invocation.insert('llm_exec "another question"\n'); return undefined; });
  f.send('llm_exec "perform indirect"'); f.requests[0]?.resolve("indirect"); await settle();
  expect(f.requests).toHaveLength(1); expect(f.output.some(entry => entry.text.includes("require direct input"))).toBe(true); f.remove();
});

test("LLM execution preserves normal cvar cheat restrictions", async () => {
  const f = fixture(); f.cvars.register("cheat_setting", "0", CvarFlag.Cheat); f.cvars.setCheatsEnabled(false);
  f.send('llm_exec "enable cheat setting"'); f.requests[0]?.resolve("cheat_setting 1"); await settle();
  expect(f.cvars.variableString("cheat_setting")).toBe("0"); f.remove();
});

test("LLM disposal during a command prevents the next generated action", async () => {
  const f = fixture(); f.commands.register("travel", () => { f.remove(); return undefined; });
  f.send('llm_exec "travel then do it"'); f.requests[0]?.resolve("travel; game_action"); await settle();
  expect(f.effects).toEqual([]); expect(f.commands.pendingText).toBe("");
});

test("saved key bindings cannot start LLM requests", () => {
  const f = fixture();
  if (f.source.origin.kind !== "local-seat") throw new Error("Expected seat fixture");
  const seat = f.source.origin.seat;
  const input = new SeatInput({ seat, dialect: "q3", context: f.source, commands: f.commands, uiEvent: () => false });
  input.bind({ input: { kind: "key", code: 119 }, target: { kind: "command", text: 'llm_ask "saved request"' } });
  input.input({ kind: "key", seat, timeMilliseconds: 10, code: 119, down: true, repeat: false }); f.commands.execute();
  input.input({ kind: "key", seat, timeMilliseconds: 20, code: 119, down: false, repeat: false }); f.commands.execute();
  expect(f.requests).toHaveLength(0); expect(f.output[0]?.text).toContain("require direct input"); f.remove();
});
