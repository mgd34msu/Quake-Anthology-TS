import { readResponses } from "../../src/llm/responses.ts";
import { expect, test } from "bun:test";
import { requestOpenAiResponses } from "../../src/llm/api.ts";
import type { TransportRequest } from "../../src/llm/request.ts";

const input = (): TransportRequest => ({ model: "gpt-5.5-pro", reasoningEffort: "high", prompt: "hello", instructions: "Reply plainly.", signal: new AbortController().signal });
const event = (value: unknown): string => `data: ${JSON.stringify(value)}\n\n`;
const completed = (text: string): string => event({ type: "response.completed", response: { status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text, annotations: [] }] }] } });
const stream = (body: string): Response => new Response(body, { headers: { "content-type": "text/event-stream" } });

test("OpenAI Responses sends its real HTTP schema and returns completed Unicode output", async () => {
  const endpoint = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    expect(new URL(request.url).pathname).toBe("/v1/responses");
    expect(request.headers.get("authorization")).toBe("Bearer fixture-key");
    expect(request.headers.has("chatgpt-account-id")).toBe(false);
    const body: unknown = await request.json();
    expect(body).toEqual({ model: "gpt-5.5-pro", instructions: "Reply plainly.", input: [{ role: "user", content: [{ type: "input_text", text: "hello" }] }], store: false, stream: true, reasoning: { effort: "high" } });
    return stream(event({ type: "response.output_text.delta", delta: "café 🎮" }) + completed("café 🎮"));
  } });
  try {
    expect(await requestOpenAiResponses(input(), "fixture-key", (url, init) => {
      expect(url).toBe("https://api.openai.com/v1/responses");
      return fetch(`http://127.0.0.1:${endpoint.port}/v1/responses`, init);
    })).toBe("café 🎮");
  } finally { await endpoint.stop(true); }
});

test("completed Responses text is authoritative and cannot contradict streamed commands", async () => {
  expect(await requestOpenAiResponses(input(), "fixture", async () => stream(completed("echo complete")))).toBe("echo complete");
  await expect(requestOpenAiResponses(input(), "fixture", async () => stream(event({ type: "response.output_text.delta", delta: "quit" }) + completed("echo complete")))).rejects.toThrow("inconsistent");
});

test("Responses refuses tools, refusals, incomplete results and provider error text", async () => {
  for (const output of [
    event({ type: "response.output_item.added", item: { type: "function_call", name: "quit" } }),
    event({ type: "response.completed", response: { status: "completed", output: [{ type: "message", content: [{ type: "refusal", refusal: "provider-secret" }] }] } }),
    event({ type: "response.incomplete", response: { status: "incomplete", error: { message: "provider-secret" } } }),
  ]) {
    const error = await requestOpenAiResponses(input(), "fixture", async () => stream(output)).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(Error);
    if (!(error instanceof Error)) throw new Error("Expected fixture failure");
    expect(error.message).not.toContain("provider-secret");
  }
});


test("real subscription completion may omit output already delivered in the stream", async () => {
  const parsed: unknown = JSON.parse(await Bun.file(new URL("./fixtures/subscription-empty-completion.json", import.meta.url)).text());
  function isEvents(value: unknown): value is readonly unknown[] { return Array.isArray(value); }
  if (!isEvents(parsed)) throw new Error("Invalid captured event fixture");
  const capturedSubscription = parsed;
  const captured = capturedSubscription.map(event).join("");
  const answer = "The echo command prints specified text to the console.";
  expect(await readResponses(input(), stream(captured), "Subscription", false)).toBe(answer);
  const prefix = capturedSubscription.slice(0, -1).map(event).join("");
  await expect(readResponses(input(), stream(prefix), "Subscription", false)).rejects.toThrow("before completion");
  await expect(readResponses(input(), stream(prefix + completed("quit")), "Subscription", false)).rejects.toThrow("inconsistent");
  await expect(readResponses(input(), stream(event({ type: "response.completed", response: { status: "completed", output: [] } })), "Subscription", false)).rejects.toThrow("no text");
  const controller = new AbortController(); controller.abort();
  await expect(readResponses({ ...input(), signal: controller.signal }, stream(captured), "Subscription", false)).rejects.toThrow("cancelled");
});
