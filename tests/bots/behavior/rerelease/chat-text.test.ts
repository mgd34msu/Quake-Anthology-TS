import { expect, test } from "bun:test";
import { q1BotChatText } from "../../../../src/bots/behavior/rerelease/chat-text.ts";
import { Xorshift32 } from "../../../../src/bots/behavior/rerelease/rng.ts";

test("Q1 chat variants consume the saved bot random stream and stop at the first missing key", () => {
  const table = new Map([["hello_0", "Hello"], ["hello_1", "Ready"], ["hello_3", "Not contiguous"], ["plain", "Plain text"]]);
  const lookup = (key: string): string | null => table.get(key) ?? null;
  const random = new Xorshift32(12), saved = random.peek();
  const lines = Array.from({ length: 8 }, () => q1BotChatText("$hello", lookup, random));
  expect(lines.every(line => line === "Hello" || line === "Ready")).toBe(true);
  expect(new Set(lines).size).toBe(2);
  const after = random.peek();
  random.restore(saved);
  expect(Array.from({ length: 8 }, () => q1BotChatText("hello", lookup, random))).toEqual(lines);
  expect(random.peek()).toBe(after);
  expect(q1BotChatText("$plain", lookup, random)).toBe("Plain text");
  expect(q1BotChatText("$missing", lookup, random)).toBe("missing");
  expect(random.peek()).toBe(after);
});
