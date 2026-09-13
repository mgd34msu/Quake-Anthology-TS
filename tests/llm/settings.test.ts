import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { LlmSettingsError, LlmSettingsService } from "../../src/llm/settings.ts";
import { refreshSubscription, type SubscriptionAuthOptions } from "../../src/llm/auth.ts";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const finish of cleanup.splice(0).reverse()) await finish(); });
async function fixture(auth: SubscriptionAuthOptions = {}): Promise<{ service: LlmSettingsService; directory: string }> {
  const directory = await mkdtemp(join(tmpdir(), "quake-llm-test-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const service = await LlmSettingsService.open({ baseDirectory: directory, auth });
  cleanup.push(() => service.close());
  return { service, directory };
}
function callbackUrl(authorization: string, stateOverride?: string): URL {
  const auth = new URL(authorization), redirect = auth.searchParams.get("redirect_uri");
  if (redirect === null) throw new Error("Missing callback URL");
  const url = new URL(redirect);
  url.hostname = "127.0.0.1";
  url.searchParams.set("state", stateOverride ?? auth.searchParams.get("state") ?? "");
  url.searchParams.set("code", "test-code");
  return url;
}
function tokens(): Response { return Response.json({ access_token: "test-access", refresh_token: "test-refresh", token_type: "Bearer", expires_in: 3600, scope: "openid profile", id_token: "must-not-save" }); }

describe("LLM settings", () => {
  test("stores independent credentials, models and explicit Other API service in the base directory", async () => {
    const { service, directory } = await fixture();
    await service.saveApiKey("chatgpt-api", " api-test ");
    await service.saveApiKey("other-api", "other-test");
    await service.saveOtherService({ transport: "openai-chat-completions", baseUrl: "http://127.0.0.1:11434/v1/", model: "local-model" });
    await service.setModel("chatgpt-api", "my-model");
    await service.selectProvider("other-api");
    const reopened = await LlmSettingsService.open({ baseDirectory: directory });
    cleanup.push(() => reopened.close());
    expect(reopened.read().model).toBe("local-model");
    expect(reopened.read().providers["chatgpt-api"].configured).toBe(true);
    expect(reopened.read().providers["other-api"].baseUrl).toBe("http://127.0.0.1:11434/v1");
    expect(JSON.stringify(reopened.read())).not.toContain("api-test");
    for (const file of ["chatgpt.key", "other.key", "other.service", "llm.json"]) expect((await stat(join(directory, file))).mode & 0o777).toBe(0o600);
    await service.removeCredential("chatgpt-api");
    expect(service.read().providers["other-api"].configured).toBe(true);
    await expect(service.saveOtherService({ transport: "openai-chat-completions", baseUrl: "https://key:secret@example.test/v1", model: "" })).rejects.toBeInstanceOf(LlmSettingsError);
  });

  test("preserves malformed files at startup and on unrelated changes", async () => {
    const { service, directory } = await fixture();
    await writeFile(join(directory, "chatgpt.key"), '{"version":1,"secret":');
    const reopened = await LlmSettingsService.open({ baseDirectory: directory });
    cleanup.push(() => reopened.close());
    expect(reopened.read().errors.map(error => error.file)).toEqual(["chatgpt.key"]);
    await reopened.selectProvider("other-api");
    expect(await readFile(join(directory, "chatgpt.key"), "utf8")).toBe('{"version":1,"secret":');
    await expect(service.saveApiKey("chatgpt-api", "replacement")).rejects.toBeInstanceOf(LlmSettingsError);
  });

  test("imports plain pasted keys and rereads user edits before shared credential writes", async () => {
    const { service, directory } = await fixture();
    await writeFile(join(directory, "chatgpt.key"), "pasted-key\n");
    await service.saveApiKey("chatgpt-api", "replacement-key");
    expect(await readFile(join(directory, "chatgpt.key"), "utf8")).toContain("replacement-key");
  });
});

describe("subscription OAuth", () => {
  test("real loopback callback verifies PKCE and stores tokens without erasing API key", async () => {
    let challenge = "", requests = 0;
    const endpoint = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
      requests++;
      const form = new URLSearchParams(await request.text());
      expect(form.get("client_id")).toBe("app_EMoamEEZ73f0CkXaXp7hrann");
      expect(form.get("grant_type")).toBe("authorization_code");
      expect(createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url")).toBe(challenge);
      return tokens();
    } });
    cleanup.push(async () => { await endpoint.stop(true); });
    const { service, directory } = await fixture({ callbackPort: 0, tokenUrl: `http://127.0.0.1:${endpoint.port}/token`, openBrowser: async url => {
      const auth = new URL(url);
      challenge = auth.searchParams.get("code_challenge") ?? "";
      expect(auth.searchParams.get("scope")).toBe("openid profile email offline_access");
      expect(auth.searchParams.get("code_challenge_method")).toBe("S256");
      expect((await fetch(callbackUrl(url))).status).toBe(200);
    } });
    await service.saveApiKey("chatgpt-api", "api-preserved");
    await service.signInSubscription();
    expect(requests).toBe(1);
    expect(service.read().providers["chatgpt-subscription"].configured).toBe(true);
    expect(service.read().providers["chatgpt-api"].configured).toBe(true);
    const text = await readFile(join(directory, "chatgpt.key"), "utf8");
    expect(text).toContain("api-preserved");
    expect(text).not.toContain("must-not-save");
    expect(JSON.stringify(service.read())).not.toContain("test-access");
    await service.removeCredential("chatgpt-subscription");
    expect(service.read().providers["chatgpt-api"].configured).toBe(true);
  });

  test("rejects state mismatch without requesting tokens or reflecting provider text", async () => {
    let requests = 0;
    const { service, directory } = await fixture({ callbackPort: 0, fetch: async () => { requests++; return tokens(); }, openBrowser: async url => {
      const target = callbackUrl(url, "wrong-state-secret");
      target.searchParams.set("error", "provider-secret");
      const response = await fetch(target);
      expect(response.status).toBe(400);
      expect(await response.text()).not.toContain("secret");
    } });
    await expect(service.signInSubscription()).rejects.toBeInstanceOf(LlmSettingsError);
    expect(requests).toBe(0);
    expect(JSON.stringify(service.read())).not.toContain("secret");
    expect(await Bun.file(join(directory, "chatgpt.key")).exists()).toBe(false);
  });

  test("cancel settles stalled browser, stops callback and prevents late saves", async () => {
    let callback = "";
    const started = Promise.withResolvers<void>();
    const { service, directory } = await fixture({ callbackPort: 0, openBrowser: async url => {
      callback = callbackUrl(url).toString(); started.resolve();
      await new Promise<void>(() => {});
    } });
    const pending = service.signInSubscription();
    await started.promise;
    service.cancelSignIn();
    await pending;
    expect(service.read().subscriptionAuth.status).toBe("idle");
    await expect(fetch(callback)).rejects.toThrow();
    expect(await Bun.file(join(directory, "chatgpt.key")).exists()).toBe(false);
  });

  test("close aborts token exchange even when injected fetch ignores abort", async () => {
    const started = Promise.withResolvers<void>(), late = Promise.withResolvers<Response>();
    let fetchSignal: AbortSignal | null = null;
    const { service, directory } = await fixture({ callbackPort: 0, openBrowser: async url => { await fetch(callbackUrl(url)); }, fetch: async (_url, init) => {
      fetchSignal = init.signal ?? null; started.resolve(); return await late.promise;
    } });
    const pending = service.signInSubscription();
    await started.promise;
    await service.close();
    await pending;
    function aborted(signal: AbortSignal | null): boolean { return signal?.aborted ?? false; }
    expect(aborted(fetchSignal)).toBe(true);
    late.resolve(tokens());
    await new Promise<void>(resolve => setTimeout(resolve, 10));
    expect(await Bun.file(join(directory, "chatgpt.key")).exists()).toBe(false);
  });

  test("token body timeout settles", async () => {
    const { service } = await fixture({ callbackPort: 0, fetchTimeoutMs: 10, openBrowser: async url => { await fetch(callbackUrl(url)); }, fetch: async () => new Response(new ReadableStream<Uint8Array>({ start() {} })) });
    await expect(service.signInSubscription()).rejects.toThrow("token request failed");
    expect(service.read().subscriptionAuth.status).toBe("error");
  });
  test("refresh uses the rotating token form and rejects a missing replacement", async () => {
    const credential = { accessToken: "old-access", refreshToken: "old-refresh", tokenType: "Bearer", expiresAt: 1, scopes: ["openid"] };
    const refreshed = await refreshSubscription({ fetch: async (_url, init) => {
      const body: unknown = init.body;
      if (typeof body !== "string") throw new Error("Expected form body");
      expect(body).toBe("grant_type=refresh_token&client_id=app_EMoamEEZ73f0CkXaXp7hrann&refresh_token=old-refresh");
      return tokens();
    } }, credential, new AbortController().signal);
    expect(refreshed.refreshToken).toBe("test-refresh");
    await expect(refreshSubscription({ fetch: async () => Response.json({ access_token: "new", expires_in: 3600 }) }, credential, new AbortController().signal)).rejects.toBeInstanceOf(LlmSettingsError);
  });

  test("callback succeeds even when browser launcher stays running", async () => {
    const { service } = await fixture({ callbackPort: 0, fetch: async () => tokens(), openBrowser: async url => {
      await fetch(callbackUrl(url));
      await new Promise<void>(() => {});
    } });
    await service.signInSubscription();
    expect(service.read().providers["chatgpt-subscription"].configured).toBe(true);
  });

  test("callback timeout and occupied callback port settle with safe errors", async () => {
    const { service } = await fixture({ callbackPort: 0, callbackTimeoutMs: 10, openBrowser: async () => { await new Promise<void>(() => {}); } });
    await expect(service.signInSubscription()).rejects.toThrow("timed out");
    const listener = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("test") });
    cleanup.push(async () => { await listener.stop(true); });
    const port = listener.port;
    if (port === undefined) throw new Error("Missing listener port");
    const occupied = await fixture({ callbackPort: port, openBrowser: async () => { throw new Error("must not run"); } });
    await expect(occupied.service.signInSubscription()).rejects.toThrow("local sign-in callback");
  });

  test("sign-in restarts immediately after cancellation", async () => {
    const firstStarted = Promise.withResolvers<void>();
    let browsers = 0;
    const { service } = await fixture({ callbackPort: 0, fetch: async () => tokens(), openBrowser: async url => {
      browsers++;
      if (browsers === 1) { firstStarted.resolve(); await new Promise<void>(() => {}); }
      else await fetch(callbackUrl(url));
    } });
    const first = service.signInSubscription();
    await firstStarted.promise;
    service.cancelSignIn();
    const second = service.signInSubscription();
    await Promise.all([first, second]);
    expect(browsers).toBe(2);
    expect(service.read().providers["chatgpt-subscription"].configured).toBe(true);
  });

});
