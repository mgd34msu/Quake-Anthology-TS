import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LlmSettingsError, LlmSettingsService, type LlmSettingsOptions } from "../../src/llm/settings.ts";
import { requestChatCompletions } from "../../src/llm/api.ts";
import type { TransportRequest } from "../../src/llm/request.ts";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const finish of cleanup.splice(0).reverse()) await finish(); });
async function fixture(options: Omit<LlmSettingsOptions, "baseDirectory"> = {}): Promise<{ service: LlmSettingsService; directory: string }> {
  const directory = await mkdtemp(join(tmpdir(), "quake-llm-request-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const service = await LlmSettingsService.open({ baseDirectory: directory, ...options });
  cleanup.push(() => service.close());
  return { service, directory };
}
function data(value: unknown): string { return `data: ${JSON.stringify(value)}\r\n\r\n`; }
function completion(text = "café 🎮"): string {
  return data({ choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })
    + data({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }) + "data: [DONE]\r\n\r\n";
}
function stream(text: string): Response {
  return new Response(new ReadableStream<Uint8Array>({ start(controller) {
    for (const byte of new TextEncoder().encode(text)) controller.enqueue(Uint8Array.of(byte));
    controller.close();
  } }), { headers: { "content-type": "text/event-stream; charset=utf-8" } });
}
function input(): TransportRequest { return { prompt: "hello", instructions: "answer", model: "test-model", signal: new AbortController().signal }; }
function subscriptionToken(label: string): string { return `${label}.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "test-account" } })).toString("base64url")}.signature`; }
async function seedSubscription(directory: string, expiresAt = Date.now() + 3600_000): Promise<void> {
  await writeFile(join(directory, "chatgpt.key"), JSON.stringify({ version: 1, apiKey: "preserved-api", subscription: {
    accessToken: subscriptionToken("old"), refreshToken: "old-refresh", tokenType: "Bearer", expiresAt, scopes: ["openid"],
  } }));
}
function codex(): Response { return stream(data({ type: "response.output_text.delta", delta: "answer" }) + data({ type: "response.completed", response: { status: "completed" } })); }
function refreshed(): Response { return Response.json({ access_token: subscriptionToken("new"), refresh_token: "new-refresh", token_type: "Bearer", expires_in: 3600 }); }

test("OpenAI API uses Responses and streams complete Unicode text", async () => {
  const deltas: string[] = [];
  const { service } = await fixture({ request: { fetch: async (url, init) => {
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(init.redirect).toBe("error");
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("Bearer api-secret");
    expect(headers.has("chatgpt-account-id")).toBe(false);
    const body: unknown = init.body;
    if (typeof body !== "string") throw new Error("Expected request body");
    const parsed: unknown = JSON.parse(body);
    expect(parsed).toEqual({ model: "test-model", instructions: "answer", input: [{ role: "user", content: [{ type: "input_text", text: "hello" }] }], store: false, stream: true });
    return stream(data({ type: "response.output_text.delta", delta: "café 🎮" }) + data({ type: "response.completed", response: { status: "completed" } }));
  } } });
  await service.saveApiKey("chatgpt-api", "api-secret");
  await service.setModel("chatgpt-api", "test-model");
  await service.selectProvider("chatgpt-api");
  expect(await service.request({ prompt: "hello", instructions: "answer", onText: text => { deltas.push(text); } })).toBe("café 🎮");
  expect(deltas).toEqual(["café 🎮"]);
});

test("Other API posts to real local HTTP endpoint preserving configured v1 prefix", async () => {
  const endpoint = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    expect(new URL(request.url).pathname).toBe("/v1/chat/completions");
    expect(request.headers.get("authorization")).toBe("Bearer other-secret");
    const body: unknown = await request.json();
    expect(body).toMatchObject({ model: "local-model", stream: true });
    return stream(completion("local answer"));
  } });
  cleanup.push(async () => { await endpoint.stop(true); });
  const { service } = await fixture();
  await service.saveOtherService({ baseUrl: `http://127.0.0.1:${endpoint.port}/v1/`, model: "local-model", transport: "openai-chat-completions" });
  await service.saveApiKey("other-api", "other-secret");
  await service.selectProvider("other-api");
  expect(await service.request({ prompt: "hello", instructions: "answer" })).toBe("local answer");
});

test("blank model and absent key fail before fetching", async () => {
  let requests = 0;
  const { service } = await fixture({ request: { fetch: async () => { requests++; return stream(completion()); } } });
  await service.selectProvider("chatgpt-api");
  await expect(service.request({ prompt: "hello", instructions: "answer" })).rejects.toThrow("Choose a Model");
  await service.setModel("chatgpt-api", "test-model");
  await expect(service.request({ prompt: "hello", instructions: "answer" })).rejects.toThrow("Paste an API key");
  expect(requests).toBe(0);
});

test("HTTP errors are sanitized and API authentication errors are never retried", async () => {
  let requests = 0;
  const { service } = await fixture({ request: { fetch: async () => { requests++; return new Response("server-secret api-secret", { status: 401 }); } } });
  await service.saveApiKey("chatgpt-api", "api-secret");
  await service.setModel("chatgpt-api", "test-model");
  await service.selectProvider("chatgpt-api");
  await expect(service.request({ prompt: "hello", instructions: "answer" })).rejects.toThrow("HTTP 401");
  expect(requests).toBe(1);
});

test("truncated, malformed, incomplete and tool completion responses cannot become executable text", async () => {
  const credential = { apiKey: "test-key", baseUrl: "https://example.test/v1" };
  for (const text of [data({ choices: [{ index: 0, delta: { content: "quit" }, finish_reason: null }] }), "data: invalid-json\n\n",
    data({ choices: [{ index: 0, delta: { content: "quit" }, finish_reason: "length" }] }) + "data: [DONE]\n\n",
    data({ choices: [{ index: 0, delta: { tool_calls: [] }, finish_reason: "tool_calls" }] })]) {
    await expect(requestChatCompletions(input(), credential, async () => stream(text))).rejects.toBeInstanceOf(LlmSettingsError);
  }
});

test("request timeout covers an open SSE body and cancels its reader", async () => {
  let cancelled = false;
  const { service } = await fixture({ request: { timeoutMs: 10, fetch: async () => new Response(new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } }), { headers: { "content-type": "text/event-stream" } }) } });
  await service.saveApiKey("chatgpt-api", "key"); await service.setModel("chatgpt-api", "model"); await service.selectProvider("chatgpt-api");
  await expect(service.request({ prompt: "hello", instructions: "answer" })).rejects.toThrow("timed out");
  expect(cancelled).toBe(true);
});

test("caller cancellation settles ignored-abort fetch without late deltas, and close cancels remaining requests", async () => {
  const started = Promise.withResolvers<void>(), late = Promise.withResolvers<Response>();
  let deltas = 0;
  const { service } = await fixture({ request: { fetch: async () => { started.resolve(); return await late.promise; } } });
  await service.saveApiKey("chatgpt-api", "key"); await service.setModel("chatgpt-api", "model"); await service.selectProvider("chatgpt-api");
  const controller = new AbortController(), pending = service.request({ prompt: "hello", instructions: "answer", signal: controller.signal, onText: () => { deltas++; } });
  await started.promise; controller.abort();
  await expect(pending).rejects.toThrow("cancelled");
  const second = service.request({ prompt: "hello", instructions: "answer" });
  const rejection = second.catch((error: unknown) => error);
  await service.close(); expect(await rejection).toBeInstanceOf(LlmSettingsError);
  late.resolve(stream(completion()));
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  expect(deltas).toBe(0);
});

test("concurrent subscription requests share one expiring-token refresh and preserve API credential", async () => {
  const refreshing = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  let refreshes = 0, requests = 0;
  const { service, directory } = await fixture({ auth: { fetch: async (_url, init) => {
    refreshes++; expect(init.method).toBe("POST"); refreshing.resolve(); await release.promise; return refreshed();
  } }, request: { fetch: async (_url, init) => { requests++; expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${subscriptionToken("new")}`); return codex(); } } });
  await seedSubscription(directory, Date.now() + 30_000); await service.setModel("chatgpt-subscription", "test-model");
  const first = service.request({ prompt: "first", instructions: "answer" }), second = service.request({ prompt: "second", instructions: "answer" });
  await refreshing.promise; release.resolve();
  expect(await Promise.all([first, second])).toEqual(["answer", "answer"]);
  expect(refreshes).toBe(1); expect(requests).toBe(2);
  const text = await readFile(join(directory, "chatgpt.key"), "utf8");
  expect(text).toContain("new-refresh"); expect(text).toContain("preserved-api");
  expect((await stat(join(directory, "chatgpt.key"))).mode & 0o777).toBe(0o600);
  expect(service.read().subscriptionAuth.status).toBe("idle");
});

for (const status of [401, 403]) test(`subscription retries HTTP ${status} only once after refresh`, async () => {
  let refreshes = 0, requests = 0;
  const { service, directory } = await fixture({ auth: { fetch: async () => { refreshes++; return refreshed(); } }, request: { fetch: async () => { requests++; return new Response("secret", { status }); } } });
  await seedSubscription(directory); await service.setModel("chatgpt-subscription", "test-model");
  await expect(service.request({ prompt: "hello", instructions: "answer" })).rejects.toThrow(`HTTP ${status}`);
  expect(refreshes).toBe(1); expect(requests).toBe(2);
});

test("cancelling one refresh waiter leaves the other request running", async () => {
  const started = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  let refreshes = 0;
  const { service, directory } = await fixture({ auth: { fetch: async () => { refreshes++; started.resolve(); await release.promise; return refreshed(); } }, request: { fetch: async () => codex() } });
  await seedSubscription(directory, 1); await service.setModel("chatgpt-subscription", "model");
  const controller = new AbortController();
  const first = service.request({ prompt: "first", instructions: "answer", signal: controller.signal });
  const second = service.request({ prompt: "second", instructions: "answer" });
  await started.promise;
  await new Promise<void>(resolve => setTimeout(resolve, 5));
  controller.abort(); await expect(first).rejects.toThrow("cancelled"); release.resolve();
  expect(await second).toBe("answer"); expect(refreshes).toBe(1);
});

test("service close aborts a refresh and prevents late credential persistence", async () => {
  const started = Promise.withResolvers<void>(), late = Promise.withResolvers<Response>();
  const { service, directory } = await fixture({ auth: { fetch: async () => { started.resolve(); return await late.promise; } }, request: { fetch: async () => codex() } });
  await seedSubscription(directory, 1); await service.setModel("chatgpt-subscription", "model");
  const pending = service.request({ prompt: "hello", instructions: "answer" });
  const rejection = pending.catch((error: unknown) => error);
  await started.promise; await service.close(); expect(await rejection).toBeInstanceOf(LlmSettingsError);
  late.resolve(refreshed()); await new Promise<void>(resolve => setTimeout(resolve, 0));
  expect(await readFile(join(directory, "chatgpt.key"), "utf8")).toContain("old-refresh");
});

test("subscription refresh and Responses stream run through real local HTTP endpoints", async () => {
  let tokenRequests = 0, responseRequests = 0;
  const endpoint = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/token") {
      tokenRequests++;
      expect(request.headers.get("content-type")).toBe("application/x-www-form-urlencoded");
      const form = new URLSearchParams(await request.text());
      expect(form.get("grant_type")).toBe("refresh_token");
      expect(form.get("refresh_token")).toBe("old-refresh");
      return refreshed();
    }
    expect(path).toBe("/responses"); responseRequests++;
    expect(request.headers.get("authorization")).toBe(`Bearer ${subscriptionToken("new")}`);
    expect(request.headers.get("chatgpt-account-id")).toBe("test-account");
    const body: unknown = await request.json();
    expect(body).toMatchObject({ model: "model", instructions: "live command documentation", store: false, stream: true });
    return codex();
  } });
  cleanup.push(async () => { await endpoint.stop(true); });
  const base = `http://127.0.0.1:${endpoint.port}`;
  const { service, directory } = await fixture({ auth: { tokenUrl: `${base}/token` }, request: { fetch: async (url, init) => {
    expect(url).toBe("https://chatgpt.com/backend-api/codex/responses");
    return await fetch(`${base}/responses`, init);
  } } });
  await seedSubscription(directory, 1); await service.setModel("chatgpt-subscription", "model");
  expect(await service.request({ prompt: "hello", instructions: "live command documentation" })).toBe("answer");
  expect(tokenRequests).toBe(1); expect(responseRequests).toBe(1);
});

test("API completion closes hanging streams and cancellation within a delta blocks further text", async () => {
  const credential = { apiKey: "test-key", baseUrl: "https://example.test/v1" };
  let cancelled = false;
  expect(await requestChatCompletions(input(), credential, async () => new Response(new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode(completion("finished"))); },
    cancel() { cancelled = true; },
  }), { headers: { "content-type": "text/event-stream" } }))).toBe("finished");
  expect(cancelled).toBe(true);
  const controller = new AbortController(), deltas: string[] = [];
  const body = data({ choices: [{ index: 0, delta: { content: "first" }, finish_reason: null }] }) + completion("late");
  await expect(requestChatCompletions({ ...input(), signal: controller.signal, onText: text => { deltas.push(text); controller.abort(); } }, credential,
    async () => new Response(body, { headers: { "content-type": "text/event-stream" } }))).rejects.toThrow("cancelled");
  expect(deltas).toEqual(["first"]);
});

test("API keeps the SSE media requirement and cancels rejected response bodies", async () => {
  let cancelled = false;
  await expect(requestChatCompletions(input(), { apiKey: "test-key", baseUrl: "https://example.test/v1" }, async () =>
    new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode(completion())); },
      cancel() { cancelled = true; },
    }), { headers: { "content-type": "application/json; secret=do-not-reflect" } })))
    .rejects.toThrow("LLM service did not return an event stream (HTTP 200, JSON).");
  expect(cancelled).toBe(true);
});

test("unsupported persisted effort fails before sending a paid request", async () => {
  let requests = 0;
  const { service, directory } = await fixture({ request: { fetch: async () => { requests++; return codex(); } } });
  await service.saveApiKey("chatgpt-api", "fixture-key"); await service.setModel("chatgpt-api", "gpt-5.5-pro"); await service.selectProvider("chatgpt-api");
  const preferences: unknown = JSON.parse(await readFile(join(directory, "llm.json"), "utf8"));
  if (typeof preferences !== "object" || preferences === null) throw new Error("Missing test preferences");
  await writeFile(join(directory, "llm.json"), JSON.stringify({ ...preferences, reasoningEfforts: { "chatgpt-api": "low", "chatgpt-subscription": null, "other-api": null } }));
  await expect(service.request({ prompt: "hello", instructions: "answer" })).rejects.toThrow("Model default");
  expect(requests).toBe(0);
});
