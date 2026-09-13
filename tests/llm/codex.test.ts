import { expect, test } from "bun:test";
import { requestCodex } from "../../src/llm/codex.ts";
import { LlmHttpError } from "../../src/llm/errors.ts";
import type { SubscriptionCredential } from "../../src/llm/auth.ts";
import type { TransportRequest } from "../../src/llm/request.ts";

const credential: SubscriptionCredential = {
  accessToken: `header.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "test-account" } })).toString("base64url")}.signature`,
  refreshToken: "test-refresh", expiresAt: 1234, scopes: [], tokenType: "Bearer",
};
function input(): TransportRequest { return { prompt: "hello", instructions: "Reply plainly.", model: "openai:test-model", signal: new AbortController().signal }; }
function event(value: unknown): string { return `data: ${JSON.stringify(value)}\n\n`; }
function response(text: string): Response {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream<Uint8Array>({ start(controller) {
    for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
    controller.close();
  } }), { headers: { "content-type": "text/event-stream" } });
}

test("subscription uses account-scoped Responses transport and decodes fragmented Unicode deltas", async () => {
  const deltas: string[] = [];
  const result = await requestCodex({ ...input(), onText: text => { deltas.push(text); } }, credential, async (url, init) => {
    expect(url).toBe("https://chatgpt.com/backend-api/codex/responses");
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${credential.accessToken}`);
    expect(headers.get("chatgpt-account-id")).toBe("test-account");
    expect(headers.get("OpenAI-Beta")).toBe("responses=experimental");
    expect(headers.get("originator")).toBe("pi");
    expect(headers.get("accept")).toBe("text/event-stream");
    expect(init.method).toBe("POST");
    const requestBody: unknown = init.body;
    if (typeof requestBody !== "string") throw new Error("Expected JSON request");
    const body: unknown = JSON.parse(requestBody);
    expect(body).toMatchObject({ model: "test-model", store: false, stream: true, instructions: "Reply plainly.",
      input: [{ role: "user", content: [{ type: "input_text", text: "hello" }] }], prompt_cache_key: headers.get("session_id") });
    return response(event({ type: "response.created" }) + event({ type: "response.output_text.delta", delta: "café " })
      + event({ type: "response.output_text.delta", delta: "🎮" }) + event({ type: "response.completed", response: { status: "completed" } }));
  });
  expect(result).toBe("café 🎮"); expect(deltas).toEqual(["café ", "🎮"]);
});

test("subscription rejects absent account ID before sending a request", async () => {
  let called = false;
  await expect(requestCodex(input(), { ...credential, accessToken: "secret.invalid.signature" }, async () => {
    called = true; return response("");
  })).rejects.toThrow("Sign in again");
  expect(called).toBe(false);
});

for (const type of ["response.failed", "response.incomplete", "error"]) test(`subscription rejects ${type} without reflecting provider text`, async () => {
  await expect(requestCodex(input(), credential, async () => response(event({ type, error: { message: "secret-provider-text" } })))).rejects.toThrow("Subscription response failed. Try again.");
});

test("subscription rejects truncated and malformed streams", async () => {
  await expect(requestCodex(input(), credential, async () => response(event({ type: "response.output_text.delta", delta: "quit" })))).rejects.toThrow("before completion");
  await expect(requestCodex(input(), credential, async () => response("data: secret-invalid-json\n\n"))).rejects.toThrow("Invalid subscription response.");
});

test("subscription rejects completion with no usable text", async () => {
  for (const delta of ["", " \n"]) await expect(requestCodex(input(), credential, async () => response(
    event({ type: "response.output_text.delta", delta }) + event({ type: "response.completed", response: { status: "completed" } }),
  ))).rejects.toThrow("Subscription returned no text.");
});

test("subscription preserves HTTP auth status for service refresh without provider body", async () => {
  for (const status of [401, 403]) {
    try { await requestCodex(input(), credential, async () => new Response("secret-server-body", { status })); throw new Error("Expected failure"); }
    catch (error) {
      expect(error).toBeInstanceOf(LlmHttpError);
      if (!(error instanceof LlmHttpError)) throw error;
      expect(error.status).toBe(status); expect(error.message).not.toContain("secret");
    }
  }
});

test("subscription completion closes a stream whose socket remains open", async () => {
  let cancelled = false;
  const result = await requestCodex(input(), credential, async () => new Response(new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode(event({ type: "response.output_text.delta", delta: "done" }) + event({ type: "response.completed", response: { status: "completed" } }))); },
    cancel() { cancelled = true; },
  }), { headers: { "content-type": "text/event-stream" } }));
  expect(result).toBe("done"); expect(cancelled).toBe(true);
});
