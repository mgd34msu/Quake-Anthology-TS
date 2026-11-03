import { expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { CommandBuffer } from "../../src/core/commands/index.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { DedicatedConsole } from "../../src/console/dedicated.ts";

test("PLATFORM-019 a stdin burst past the ring drops lines instead of throwing, and an unterminated flood is capped", () => {
  const input = new PassThrough(), console = new DedicatedConsole(input), appended: string[] = [];
  class RecordingBuffer extends CommandBuffer { override append(text: string): void { appended.push(text); } }
  const commands = new RecordingBuffer({ dialect: "q3", context: { session: createIdentityOwner("dedicated-console").session, origin: { kind: "server-console" } } });
  expect(() => input.emit("data", Buffer.from("x\n".repeat(20000)))).not.toThrow();
  expect(() => input.emit("data", Buffer.from("y".repeat(200000)))).not.toThrow();
  expect(console.drain(commands)).toBe(16384);
  expect(appended[0]).toContain("dropped");
  console.close();
});
