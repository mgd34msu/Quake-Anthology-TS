import { expect, test } from "bun:test";
import { BotLog } from "../../../src/bots/behavior/library/log.ts";
import type { BotLogStream } from "../../../src/bots/behavior/library/log.ts";
import { BotLibVars } from "../../../src/bots/behavior/library/libvars.ts";
import { encodeCheckpointValue, decodeCheckpointValue } from "../../../src/persistence/value.ts";

test("log restore resumes saved byte position and timestamp count without writing during preparation", () => {
  const variables = new BotLibVars(); variables.set("log", "1");
  const bytes: number[] = []; let writes = 0, opens = 0, resumes = 0;
  const stream = (offset: number): BotLogStream => { let position = offset; return {
    checkpoint: () => ({ position }),
    write: value => { writes++; for (const byte of value) bytes[position++] = byte; return { kind: "ok" }; },
    flush: () => ({ kind: "ok" }), close: () => ({ kind: "ok" }),
  }; };
  const options = { variables, globals: { time: 1 }, print: () => undefined,
    openFile: (_filename: string) => { opens++; return { kind: "opened", stream: stream(0) } satisfies { kind: "opened"; stream: BotLogStream }; },
    resumeFile: (filename: string, position: number) => { resumes++; expect(filename).toBe("bot.log"); expect(position).toBe(bytes.length); return { kind: "opened", stream: stream(position) } satisfies { kind: "opened"; stream: BotLogStream }; },
  };
  const original = new BotLog(options); original.open("bot.log"); original.writeTimeStamped("before");
  const saved = decodeCheckpointValue(encodeCheckpointValue(original.captureSaveState())); original.disposeResources();
  const before = writes, restored = new BotLog(options); restored.restoreSaveState(saved);
  expect(writes).toBe(before); expect(opens).toBe(1); expect(resumes).toBe(1);
  restored.writeTimeStamped("after");
  expect(new TextDecoder().decode(new Uint8Array(bytes))).toBe("0   00:00:01:00   before\r\n1   00:00:01:00   after\r\n");
});

test("active non-resumable logger rejects checkpoint without closing stream", () => {
  const variables = new BotLibVars(); variables.set("log", "1"); let closed = false;
  const log = new BotLog({ variables, globals: { time: 0 }, print: () => undefined,
    openFile: () => ({ kind: "opened", stream: { write: () => ({ kind: "ok" }), flush: () => ({ kind: "ok" }), close: () => { closed = true; return { kind: "ok" }; } } }) });
  log.open("bot.log"); expect(() => log.captureSaveState()).toThrow("continuation checkpoints"); expect(closed).toBe(false);
  log.disposeResources();
});
