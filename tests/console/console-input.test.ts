import { expect, test } from "bun:test";
import type { CommandContext, CommandDialect } from "../../src/contracts/common.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { CommandBuffer } from "../../src/core/commands/index.ts";
import { CvarRegistry } from "../../src/core/cvars/index.ts";
import { SeatConsole } from "../../src/console/session.ts";
import { SeatInput } from "../../src/input/seat.ts";
import { InputRouter } from "../../src/input/router.ts";

const dialects: readonly CommandDialect[] = ["q1-netquake", "q1-quakeworld", "q2-classic", "q2-rerelease", "q3"];
for (const dialect of dialects) test(`${dialect} console toggles suppress only paired SDL text and plain commands execute`, () => {
  const identity = createIdentityOwner(`console-${dialect}`), seat = identity.seat(0), prints: string[] = [], chats: string[] = [], forwarded: string[] = [];
  const context: CommandContext = { session: identity.session, origin: { kind: "local-seat", seat, client: identity.client(0, 0) } };
  const cvars = new CvarRegistry({ dialect, context }), commands = new CommandBuffer({ dialect, context, cvars, print: text => { prints.push(text); }, forwardToServer: command => { forwarded.push(command.argv.join(" ")); } });
  let console: SeatConsole;
  const input = new SeatInput({ seat, dialect, context, commands, uiEvent: (event, focus) => {
    if (event.kind === "key" && (event.code === 96 || event.code === 126)) { if (event.down) console.toggleFromKey(event.repeat); return true; }
    return console.input(event, focus);
  } });
  console = new SeatConsole({ seat, dialect, context, commands, cvars, now: () => 100, connected: () => true, clipboard: () => null, focus: focus => input.setFocus(focus, 100), chat: text => { chats.push(text); } });
  const router = new InputRouter({ seats: [{ input, controller: { kind: "none" } }], keyboardSeat: seat, controllers: null, now: () => 100, ticks: () => 100, subframe: false, unhandled: () => undefined });
  const key = (code: number, down = true, repeat = false): void => router.handlePlatform({ kind: "key", timestamp: 100, scancode: code, keycode: code, modifiers: 0, down, repeat });
  const text = (value: string): void => router.handlePlatform({ kind: "text", timestamp: 100, text: value });
  try {
    key(96); key(96, false); text("`"); expect(input.focus.kind).toBe("console"); expect(console.field.text).toBe("");
    key(96, true, true); text("`"); expect(input.focus.kind).toBe("console"); expect(console.field.text).toBe("");
    text("echo plain"); key(13); key(13, false); commands.execute(); expect(prints.join("")).toContain("plain"); expect(chats).toEqual([]);
    text("/echo slash"); key(13); key(13, false); commands.execute(); expect(prints.join("")).toContain("slash");
    text("\\echo backslash"); key(13); key(13, false); commands.execute(); expect(prints.join("")).toContain("backslash");
    const history = console.history.lines.length; key(13); key(13, false); commands.execute(); expect(console.history.lines.length).toBe(history);
    text("unrecognized_console_command"); key(13); key(13, false); commands.execute(); expect(chats).toEqual(dialect === "q1-quakeworld" || dialect === "q3" ? ["unrecognized_console_command"] : []);
    const chatCount = chats.length;
    text("/explicit_unknown_console_command"); key(13); key(13, false); commands.execute(); expect(chats.length).toBe(chatCount);
    text("echo history_one"); key(13); key(13, false); commands.execute();
    text("echo history_two"); key(13); key(13, false); commands.execute();
    text("unfinished draft"); key(132); key(132, false); expect(console.field.text).toBe("echo history_two");
    key(132); key(132, false); expect(console.field.text).toBe("echo history_one");
    key(133); key(133, false); expect(console.field.text).toBe("echo history_two");
    key(133); key(133, false); expect(console.field.text).toBe("unfinished draft");
    for (let index = 0; index < 20; index++) console.print(`scroll row ${index}\n`);
    const lastRow = console.buffer.visible(1)[0]?.sequence, cursor = console.field.cursor;
    key(142); key(142, false); expect(console.buffer.visible(1)[0]?.sequence).toBeLessThan(lastRow ?? 0);
    expect(console.field.text).toBe("unfinished draft"); expect(console.field.cursor).toBe(cursor);
    key(141); key(141, false); expect(console.buffer.visible(1)[0]?.sequence).toBe(lastRow);
    console.field.clear();
    if (dialect === "q2-classic" || dialect === "q2-rerelease") expect(forwarded).toContain("unrecognized_console_command");
    key(96); key(96, false); text("`"); expect(input.focus.kind).toBe("game");
    key(126); key(126, false); text("~"); expect(input.focus.kind).toBe("console"); expect(console.field.text).toBe("");
    key(126); key(126, false); text("~"); expect(input.focus.kind).toBe("game");
    key(96); key(96, false); text("echo `pasted~ text"); expect(console.field.text).toBe("echo `pasted~ text");
    key(96); key(96, false); key(96); key(96, false);
    router.handlePlatform({ kind: "window", timestamp: 100, event: 13, data1: 0, data2: 0 });
    router.handlePlatform({ kind: "window", timestamp: 100, event: 12, data1: 0, data2: 0 });
    text("`"); expect(console.field.text).toBe("`");
    console.message(false); text("hello team"); key(13); expect(chats.at(-1)).toBe("hello team");
  } finally { router.close(); }
});

test("retained console adopts source callbacks and staged output without replacing history or fields", () => {
  const identity = createIdentityOwner("retained-console"), seat = identity.seat(0);
  const context: CommandContext = { session: identity.session, origin: { kind: "local-seat", seat, client: identity.client(2, 0) } };
  const cvars = new CvarRegistry({ dialect: "q3", context }), output: string[] = [];
  const commands = new CommandBuffer({ dialect: "q3", context, cvars, print: text => { output.push(text); } });
  const focus: string[] = [];
  const options = { seat, dialect: "q3", context, commands, cvars, now: () => 100, connected: () => false, clipboard: () => null,
    focus: (value: import("../../src/contracts/ui.ts").SeatInputFocus) => { focus.push(value.kind); }, chat: () => {} } satisfies ConstructorParameters<typeof SeatConsole>[0];
  const console = new SeatConsole(options), field = console.field, history = console.history, buffer = console.buffer;
  console.history.add("echo menu"); console.field.setText("unfinished draft");
  for (let i = 0; i < 20; i++) console.print(`old ${i}\n`);
  console.buffer.scroll(4);
  const before = console.buffer.dump(), rows = console.buffer.visible(2);
  const failed = new SeatConsole({ ...options, staged: true }); failed.print("failed init\n");
  expect(console.buffer.dump()).toBe(before); expect(console.buffer.visible(2)).toEqual(rows);
  const candidate = new SeatConsole({ ...options, staged: true, connected: () => true,
    focus: value => { focus.push(`source:${value.kind}`); } });
  candidate.print("new init\n"); console.adopt(candidate, { kind: "console" });
  expect(console.field).toBe(field); expect(console.history).toBe(history); expect(console.buffer).toBe(buffer);
  expect(console.field.text).toBe("unfinished draft"); expect(console.history.lines).toEqual(["echo menu"]);
  expect(console.buffer.dump()).toContain("new init"); expect(console.buffer.dump()).not.toContain("failed init");
  expect(() => console.adopt(candidate, { kind: "console" })).toThrow("already published");
  console.close(); expect(focus.at(-1)).toBe("source:game");
  const frontend = new SeatConsole({ ...options, staged: true, focus: value => { focus.push(value.kind === "game" ? "menu" : value.kind); } });
  console.adopt(frontend, { kind: "menu", menu: "menu:startup:main", control: null });
  console.toggleFromKey(false); expect(focus.at(-1)).toBe("console");
  console.input({ kind: "text", seat, timeMilliseconds: 100, text: "`" }, { kind: "console" });
  expect(console.field.text).toBe("");
  console.field.setText("echo retained"); console.submit(); commands.execute();
  expect(output.join("")).toContain("retained"); expect(console.history.lines).toEqual(["echo menu", "echo retained"]);
  console.input({ kind: "key", seat, timeMilliseconds: 100, code: 27, down: true, repeat: false }, { kind: "console" });
  expect(focus.at(-1)).toBe("menu");
});
