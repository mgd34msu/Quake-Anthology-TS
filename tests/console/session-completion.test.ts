import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import type { CommandContext } from "../../src/contracts/common.ts";
import { CommandBuffer } from "../../src/core/commands/index.ts";
import { CvarRegistry } from "../../src/core/cvars/index.ts";
import { SeatConsole } from "../../src/console/session.ts";
import { KeyCode } from "../../src/input/key-codes.ts";

test("session completion keeps paging output-only, reverses with Shift, and resets on history", () => {
  const identity = createIdentityOwner("session-completion"), seat = identity.seat(0);
  const context: CommandContext = { session: identity.session, origin: { kind: "local-seat", seat, client: identity.client(0, 0) } };
  const cvars = new CvarRegistry({ dialect: "q3", context });
  const commands = new CommandBuffer({ dialect: "q3", context, cvars, print: () => undefined });
  commands.register("zz_first", () => undefined, { summary: "First command", usage: "zz_first <value>", examples: [] });
  commands.register("zz_second", () => undefined);
  const console = new SeatConsole({ seat, dialect: "q3", context, commands, cvars, now: () => 0, connected: () => false,
    clipboard: () => null, focus: () => undefined, chat: () => undefined });
  const key = (code: number, down = true): void => { console.input({ kind: "key", seat, timeMilliseconds: 0, code, down, repeat: false }, { kind: "console" }); };
  console.field.setText("zz_"); key(KeyCode.Tab); key(KeyCode.Tab, false);
  expect(console.field.text).toBe("/zz_first"); expect(console.selectedCompletionEntry?.usage).toBe("zz_first <value>");
  const draft = console.field.text, cursor = console.field.cursor;
  for (let index = 0; index < 10; index++) console.print(`line ${index}\n`);
  const bottom = console.buffer.visible(1)[0]?.sequence;
  key(KeyCode.PageUp); expect(console.buffer.visible(1)[0]?.sequence).toBeLessThan(bottom ?? 0);
  key(KeyCode.PageDown); expect(console.buffer.visible(1)[0]?.sequence).toBe(bottom);
  expect(console.field.text).toBe(draft); expect(console.field.cursor).toBe(cursor); expect(console.field.selectedCompletion).toBe("zz_first");
  key(KeyCode.Shift); key(KeyCode.Tab); key(KeyCode.Shift, false); expect(console.field.text).toBe("/zz_second");
  console.history.add("echo historical"); key(KeyCode.Up);
  expect(console.field.text).toBe("echo historical"); expect(console.selectedCompletionEntry).toBeUndefined();
  key(KeyCode.Down); expect(console.field.text).toBe("/zz_second"); expect(console.selectedCompletionEntry).toBeUndefined();
});
