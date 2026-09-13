import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LlmSettingsService, type LlmSettingsOptions } from "../../src/llm/settings.ts";
import { parseApiModels, parseCodexModels } from "../../src/llm/models.ts";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function fixture(options: Omit<LlmSettingsOptions, "baseDirectory"> = {}): Promise<{ service: LlmSettingsService; directory: string }> {
  const directory = await mkdtemp(join(tmpdir(), "quake-model-list-")); cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const service = await LlmSettingsService.open({ baseDirectory: directory, ...options }); cleanup.push(() => service.close());
  return { service, directory };
}
async function response(name: "api" | "codex"): Promise<Response> {
  return new Response(await readFile(new URL(`./fixtures/${name}-models.json`, import.meta.url), "utf8"), { headers: { "content-type": "application/json" } });
}
async function parsed(name: "api" | "codex"): Promise<unknown> { const value: unknown = await (await response(name)).json(); return value; }
async function subscription(directory: string): Promise<void> {
  const accessToken = `header.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "fake-account" } })).toString("base64url")}.signature`;
  await writeFile(join(directory, "chatgpt.key"), JSON.stringify({ version: 1, apiKey: "preserved-key", subscription: { accessToken, refreshToken: "fake-refresh", tokenType: "Bearer", expiresAt: Date.now() + 3600_000, scopes: [] } }));
}
function answer(codex: boolean): Response {
  return new Response(codex ? 'data: {"type":"response.output_text.delta","delta":"ok"}\n\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\n'
    : 'data: {"choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } });
}

test("Codex live fields determine names, visible order, default model and reasoning levels", async () => {
  const entries = parseCodexModels(await parsed("codex"));
  expect(entries.map(entry => entry.id)).toEqual(["test-default", "test-reasoner", "test-plain"]);
  expect(entries[0]).toMatchObject({ recommended: true, defaultReasoningEffort: "low", reasoningSource: "provider" });
  expect(entries[1]?.reasoningEfforts).toEqual(["low", "medium", "xhigh"]);
});

test("API model listing capability is reference metadata, while Other receives no guessed effort", async () => {
  const value = await parsed("api"), api = parseApiModels(value, true), other = parseApiModels(value, false);
  expect(api.map(entry => entry.id)).not.toContain("text-embedding-test");
  expect(api.find(entry => entry.id === "gpt-5")).toMatchObject({ reasoningSource: "reference", reasoningEfforts: ["low", "medium", "high"], recommended: false });
  expect(api.find(entry => entry.id === "unknown-chat")?.reasoningEfforts).toEqual([]);
  expect(other.every(entry => entry.reasoningSource === "unknown" && entry.reasoningEfforts.length === 0)).toBe(true);
});

test("subscription discovers with account auth, defaults to server priority, persists effort and sends Responses reasoning", async () => {
  const bodies: unknown[] = [];
  const { service, directory } = await fixture({ request: { fetch: async (url, init) => {
    expect(new Headers(init.headers).get("chatgpt-account-id")).toBe("fake-account");
    if (init.method === "GET") { expect(url).toBe("https://chatgpt.com/backend-api/codex/models?client_version=0.154.0"); return await response("codex"); }
    const body: unknown = init.body; if (typeof body !== "string") throw new Error("Expected body");
    const value: unknown = JSON.parse(body); bodies.push(value); return answer(true);
  } } });
  await subscription(directory);
  await service.refreshModels();
  expect(service.read().model).toBe("test-default"); expect(service.read().reasoningEffort).toBe("low");
  await service.setModel("chatgpt-subscription", "test-reasoner"); await service.setReasoningEffort("chatgpt-subscription", "xhigh");
  expect(await service.request({ prompt: "hello", instructions: "commands" })).toBe("ok");
  expect(bodies[0]).toMatchObject({ reasoning: { effort: "xhigh" } });
  const reopened = await LlmSettingsService.open({ baseDirectory: directory }); cleanup.push(() => reopened.close());
  expect(reopened.read().model).toBe("test-reasoner"); expect(reopened.read().reasoningEffort).toBe("xhigh");
  await service.setModel("chatgpt-subscription", "test-plain");
  expect(service.read().reasoningEffort).toBeNull();
  await service.request({ prompt: "hello", instructions: "commands" });
  expect(bodies[1]).not.toHaveProperty("reasoning");
  await expect(service.setModel("chatgpt-subscription", "made-up-model")).rejects.toThrow("loaded provider list");
});

test("API discovery uses v1/models and selected effort uses reasoning_effort only", async () => {
  const { service } = await fixture({ request: { fetch: async (url, init) => {
    expect(new Headers(init.headers).has("chatgpt-account-id")).toBe(false);
    if (init.method === "GET") { expect(url).toBe("https://api.openai.com/v1/models"); return await response("api"); }
    const body: unknown = init.body; if (typeof body !== "string") throw new Error("Expected body");
    const value: unknown = JSON.parse(body); expect(value).toHaveProperty("reasoning_effort", "high"); expect(value).not.toHaveProperty("reasoning"); return answer(false);
  } } });
  await service.saveApiKey("chatgpt-api", "fake-key"); await service.selectProvider("chatgpt-api"); await service.refreshModels();
  expect(service.read().model).toBe("");
  await service.setModel("chatgpt-api", "gpt-5"); await service.setReasoningEffort("chatgpt-api", "high");
  expect(await service.request({ prompt: "hello", instructions: "commands" })).toBe("ok");
  await service.setModel("chatgpt-api", "gpt-4.1"); expect(service.read().reasoningEffort).toBeNull();
  await expect(service.setReasoningEffort("chatgpt-api", "high")).rejects.toThrow("supported");
});

test("Other discovery preserves configured prefix over real loopback HTTP", async () => {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    expect(new URL(request.url).pathname).toBe("/custom/v1/models"); expect(request.method).toBe("GET");
    expect(request.headers.get("authorization")).toBe("Bearer fake-key"); return await response("api");
  } }); cleanup.push(async () => { await server.stop(true); });
  const { service } = await fixture();
  await service.saveOtherService({ baseUrl: `http://127.0.0.1:${server.port}/custom/v1`, model: "", transport: "openai-chat-completions" });
  await service.saveApiKey("other-api", "fake-key");
  expect((await service.refreshModels("other-api")).length).toBe(4);
  expect(service.read().catalogs["other-api"].status).toBe("ready");
});

test("model loading errors and timeouts settle without hiding saved model", async () => {
  const { service } = await fixture({ request: { timeoutMs: 10, fetch: async () => new Response(new ReadableStream<Uint8Array>()) } });
  await service.saveApiKey("chatgpt-api", "fake-key"); await service.setModel("chatgpt-api", "saved-model");
  await expect(service.refreshModels("chatgpt-api")).rejects.toThrow("timed out");
  expect(service.read().catalogs["chatgpt-api"].status).toBe("error"); expect(service.read().providers["chatgpt-api"].model).toBe("saved-model");
});

test("cancelled discovery cannot save a default model or overwrite newer credential catalog", async () => {
  const started = Promise.withResolvers<void>(), late = Promise.withResolvers<Response>();
  const { service, directory } = await fixture({ request: { fetch: async () => { started.resolve(); return await late.promise; } } });
  await subscription(directory);
  const controller = new AbortController(), pending = service.refreshModels("chatgpt-subscription", controller.signal);
  await started.promise; controller.abort(); await expect(pending).rejects.toThrow("cancelled");
  late.resolve(await response("codex")); await new Promise<void>(resolve => setTimeout(resolve, 0));
  expect(service.read().model).toBe(""); expect(service.read().catalogs["chatgpt-subscription"].status).toBe("idle");
});

test("saved subscription effort reloads live capabilities before the first request after restart", async () => {
  const { service, directory } = await fixture({ request: { fetch: async () => await response("codex") } });
  await subscription(directory); await service.refreshModels();
  await service.setModel("chatgpt-subscription", "test-reasoner"); await service.setReasoningEffort("chatgpt-subscription", "xhigh");
  const operations: string[] = [];
  const reopened = await LlmSettingsService.open({ baseDirectory: directory, request: { fetch: async (_url, init) => {
    operations.push(init.method ?? "");
    if (init.method === "GET") return await response("codex");
    const body: unknown = init.body; if (typeof body !== "string") throw new Error("Expected body");
    const value: unknown = JSON.parse(body); expect(value).toHaveProperty("reasoning.effort", "xhigh"); return answer(true);
  } } }); cleanup.push(() => reopened.close());
  expect(await reopened.request({ prompt: "hello", instructions: "commands" })).toBe("ok");
  expect(operations).toEqual(["GET", "POST"]);
});

test("saving a selected Other model retains its loaded catalog until the service URL changes", async () => {
  const { service, directory } = await fixture({ request: { fetch: async () => await response("api") } });
  const baseUrl = "http://127.0.0.1:11434/v1";
  await service.saveOtherService({ baseUrl, model: "", transport: "openai-chat-completions" });
  await service.saveApiKey("other-api", "fake-key");
  const models = await service.refreshModels("other-api");
  await service.saveOtherService({ baseUrl, model: "gpt-4.1", transport: "openai-chat-completions" });
  expect(service.read().catalogs["other-api"].status).toBe("ready");
  expect(service.read().catalogs["other-api"].models).toEqual(models);
  expect(service.read().reasoningEfforts["other-api"]).toBeNull();
  const reopened = await LlmSettingsService.open({ baseDirectory: directory }); cleanup.push(() => reopened.close());
  expect(reopened.read().providers["other-api"].model).toBe("gpt-4.1");
  await service.saveOtherService({ baseUrl: "http://127.0.0.1:11435/v1", model: "", transport: "openai-chat-completions" });
  expect(service.read().catalogs["other-api"]).toEqual({ status: "idle", models: [] });
});
