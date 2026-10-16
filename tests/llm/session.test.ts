import { expect, test } from "bun:test";
import type { LlmRequestInput } from "../../src/llm/request.ts";
import { LlmSession } from "../../src/llm/session.ts";

function fixture() {
  const calls: LlmRequestInput[] = [];
  let config = "provider:model-a";
  const session = new LlmSession(async input => {
    calls.push(input);
    if (input.prompt.includes("READY only")) return "READY";
    if (input.prompt === "bad") throw new Error("transport failed");
    return `answer:${input.prompt}`;
  }, () => config);
  return { calls, session, setConfig: (value: string) => { config = value; } };
}

test("one session primes once, keeps its ID and transcript across games, and updates its primer in place", async () => {
  const { calls, session } = fixture();
  const id = session.id;
  await session.prime("CATALOG ONE");
  await session.prime("CATALOG ONE");
  expect(calls).toHaveLength(1);
  expect(calls[0]?.instructions).toBe("CATALOG ONE");
  expect(calls[0]?.sessionId).toBe(id);

  expect(await session.request({ prompt: "first", instructions: "turn one", sessionInstructions: "CATALOG ONE" })).toBe("answer:first");
  expect(calls).toHaveLength(2);
  expect(calls[1]?.instructions).toContain("CATALOG ONE");
  expect(calls[1]?.instructions).toContain("turn one");

  await session.request({ prompt: "second", instructions: "turn two", sessionInstructions: "CATALOG ONE" });
  expect(calls[2]?.instructions).toContain("User: first");
  expect(calls[2]?.instructions).toContain("Assistant: answer:first");
  expect(session.id).toBe(id);

  await session.prime("CATALOG TWO");
  expect(session.id).toBe(id);
  expect(calls).toHaveLength(4);
  await session.request({ prompt: "third", instructions: "turn three", sessionInstructions: "CATALOG TWO" });
  expect(calls[4]?.instructions).toContain("CATALOG TWO");
  expect(calls[4]?.instructions).toContain("User: second");
  expect(calls.every(call => call.sessionId === id)).toBe(true);
});

test("provider or model fingerprint change starts fresh provider context without replaying the old transcript", async () => {
  const { calls, session, setConfig } = fixture();
  await session.request({ prompt: "first", instructions: "turn", sessionInstructions: "CATALOG" });
  const firstId = session.id;
  expect(calls).toHaveLength(2);

  setConfig("provider:model-b");
  await session.request({ prompt: "second", instructions: "turn", sessionInstructions: "CATALOG" });
  expect(session.id).not.toBe(firstId);
  expect(calls).toHaveLength(4);
  expect(calls[2]?.prompt).toContain("starts an ongoing session");
  expect(calls[3]?.instructions).not.toContain("User: first");
  expect(calls[3]?.sessionId).toBe(session.id);
});

test("explicit invalidation and failed turns do not poison the retained transcript", async () => {
  const { calls, session } = fixture();
  await session.request({ prompt: "kept", instructions: "turn", sessionInstructions: "CATALOG" });
  await expect(session.request({ prompt: "bad", instructions: "turn", sessionInstructions: "CATALOG" })).rejects.toThrow("transport failed");
  await session.request({ prompt: "next", instructions: "turn", sessionInstructions: "CATALOG" });
  const next = calls.at(-1);
  expect(next?.instructions).toContain("User: kept");
  expect(next?.instructions).not.toContain("User: bad");

  const oldId = session.id;
  session.invalidate();
  expect(session.id).not.toBe(oldId);
  expect(session.active).toBe(false);
  await session.request({ prompt: "fresh", instructions: "turn", sessionInstructions: "CATALOG" });
  expect(calls.at(-1)?.instructions).not.toContain("User: kept");
});

test("close rejects later session work", async () => {
  const { session } = fixture();
  session.close();
  await expect(session.prime("CATALOG")).rejects.toThrow("LLM session is closed");
  await expect(session.request({ prompt: "hello", instructions: "turn" })).rejects.toThrow("LLM session is closed");
});
