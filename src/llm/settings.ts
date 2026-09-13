import { requestChatCompletions } from "./api.ts";
import { requestCodex } from "./codex.ts";
import { checkRequestAbort, withRequestAbort, type LlmRequestInput, type LlmRequestOptions, type TransportRequest } from "./request.ts";
import { LlmHttpError, LlmSettingsError } from "./errors.ts";
import { mkdir, open, readFile, rm } from "node:fs/promises";
import { renameSync } from "node:fs";
import { resolve } from "node:path";
import { checkAbort, loginSubscription, parseSubscription, record, refreshSubscription, type SubscriptionAuthOptions, type SubscriptionCredential } from "./auth.ts";

export type LlmProvider = "chatgpt-subscription" | "chatgpt-api" | "other-api";
export interface OtherService { readonly baseUrl: string; readonly model: string; readonly transport: "openai-chat-completions" }
export type SubscriptionAuthState = { readonly status: "idle" } | { readonly status: "pending" } | { readonly status: "error"; readonly message: string };
export interface LlmSettingsSnapshot {
  readonly provider: LlmProvider;
  readonly model: string;
  readonly providers: {
    readonly "chatgpt-subscription": { readonly configured: boolean; readonly model: string; readonly transport: "openai-codex-responses-sse"; readonly expiresAt: number | null };
    readonly "chatgpt-api": { readonly configured: boolean; readonly model: string; readonly transport: "openai-chat-completions" };
    readonly "other-api": OtherService & { readonly configured: boolean };
  };
  readonly subscriptionAuth: SubscriptionAuthState;
  readonly errors: readonly { readonly file: string; readonly message: string }[];
}
interface ChatgptCredentials { readonly version: 1; readonly apiKey: string | null; readonly subscription: SubscriptionCredential | null }
interface Preferences { readonly version: 1; readonly provider: LlmProvider; readonly models: Record<"chatgpt-subscription" | "chatgpt-api", string> }
export interface LlmSettingsOptions { readonly baseDirectory: string; readonly auth?: SubscriptionAuthOptions; readonly request?: LlmRequestOptions }

function provider(value: unknown): LlmProvider {
  if (value === "chatgpt-subscription" || value === "chatgpt-api" || value === "other-api") return value;
  throw new LlmSettingsError("Invalid LLM provider setting.");
}
function model(value: unknown): string {
  if (typeof value !== "string" || value.length > 256 || /[\x00-\x1f\x7f]/.test(value)) throw new LlmSettingsError("Invalid model name.");
  return value.trim();
}
function apiKey(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 16_384 || /\s/.test(value.trim())) throw new LlmSettingsError("Paste a nonempty API key without whitespace.");
  return value.trim();
}
function otherService(value: unknown): OtherService {
  const item = record(value);
  if (item["transport"] !== "openai-chat-completions" || typeof item["baseUrl"] !== "string") throw new LlmSettingsError("Other API requires an OpenAI Chat Completions compatible service.");
  let url: URL;
  try { url = new URL(item["baseUrl"]); } catch { throw new LlmSettingsError("Enter a valid Other API base URL."); }
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback) || url.username || url.password || url.search || url.hash) throw new LlmSettingsError("Use HTTPS or loopback HTTP, without URL credentials, query, or fragment.");
  return { baseUrl: url.toString().replace(/\/$/, ""), model: model(item["model"]), transport: "openai-chat-completions" };
}
function parseJson(text: string): unknown {
  try { const value: unknown = JSON.parse(text); return value; }
  catch { throw new LlmSettingsError("Invalid LLM settings file. Check its format before saving."); }
}
function parseChatgpt(text: string | null): ChatgptCredentials {
  if (text === null) return { version: 1, apiKey: null, subscription: null };
  if (!text.trimStart().startsWith("{")) return { version: 1, apiKey: apiKey(text), subscription: null };
  const value = record(parseJson(text));
  if (value["version"] !== 1) throw new LlmSettingsError("Unsupported chatgpt.key format.");
  return { version: 1, apiKey: value["apiKey"] === null || value["apiKey"] === undefined ? null : apiKey(value["apiKey"]),
    subscription: value["subscription"] === null || value["subscription"] === undefined ? null : parseSubscription(value["subscription"]) };
}
function parsePreferences(text: string | null): Preferences {
  if (text === null) return { version: 1, provider: "chatgpt-subscription", models: { "chatgpt-subscription": "", "chatgpt-api": "" } };
  const value = record(parseJson(text)), models = record(value["models"]);
  if (value["version"] !== 1) throw new LlmSettingsError("Unsupported llm.json format.");
  return { version: 1, provider: provider(value["provider"]), models: { "chatgpt-subscription": model(models["chatgpt-subscription"]), "chatgpt-api": model(models["chatgpt-api"]) } };
}

export class LlmSettingsService {
  private readonly baseDirectory: string;
  private readonly auth: SubscriptionAuthOptions;
  private readonly requestOptions: LlmRequestOptions;
  private readonly requests = new Map<AbortController, Promise<unknown>>();
  private refreshing: { readonly controller: AbortController; readonly promise: Promise<SubscriptionCredential>; users: number } | null = null;
  private preferences: Preferences = parsePreferences(null);
  private chatgpt: ChatgptCredentials = parseChatgpt(null);
  private otherKey: string | null = null;
  private other: OtherService = { baseUrl: "", model: "", transport: "openai-chat-completions" };
  private authState: SubscriptionAuthState = { status: "idle" };
  private active: { controller: AbortController; promise: Promise<void> } | null = null;
  private queue: Promise<void> = Promise.resolve();
  private closed = false;
  private readonly errors = new Map<string, string>();

  private constructor(options: LlmSettingsOptions) { this.baseDirectory = resolve(options.baseDirectory); this.auth = options.auth ?? {}; this.requestOptions = options.request ?? {}; }
  static async open(options: LlmSettingsOptions): Promise<LlmSettingsService> {
    const service = new LlmSettingsService(options);
    for (const file of ["llm.json", "chatgpt.key", "other.key", "other.service"]) {
      try {
        const text = await service.load(file);
        switch (file) {
          case "llm.json": service.preferences = parsePreferences(text); break;
          case "chatgpt.key": service.chatgpt = parseChatgpt(text); break;
          case "other.key": service.otherKey = text === null ? null : apiKey(text); break;
          case "other.service": if (text !== null) service.other = otherService(parseJson(text)); break;
        }
      } catch { service.errors.set(file, `Could not load ${file}. Check its format and permissions.`); }
    }
    return service;
  }
  read(): LlmSettingsSnapshot {
    const providers: LlmSettingsSnapshot["providers"] = {
      "chatgpt-subscription": { configured: this.chatgpt.subscription !== null, model: this.preferences.models["chatgpt-subscription"], transport: "openai-codex-responses-sse", expiresAt: this.chatgpt.subscription?.expiresAt ?? null },
      "chatgpt-api": { configured: this.chatgpt.apiKey !== null, model: this.preferences.models["chatgpt-api"], transport: "openai-chat-completions" },
      "other-api": { ...this.other, configured: this.otherKey !== null },
    };
    return { provider: this.preferences.provider, model: providers[this.preferences.provider].model, providers, subscriptionAuth: { ...this.authState }, errors: Array.from(this.errors, ([file, message]) => ({ file, message })) };
  }
  private async load(name: string): Promise<string | null> {
    try { return await readFile(resolve(this.baseDirectory, name), "utf8"); }
    catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
      throw new LlmSettingsError(`Could not read ${name}.`);
    }
  }
  private async write(name: string, text: string, signal?: AbortSignal): Promise<void> {
    const target = resolve(this.baseDirectory, name), temporary = `${target}.${crypto.randomUUID()}.tmp`;
    try {
      await mkdir(this.baseDirectory, { recursive: true });
      const file = await open(temporary, "wx", 0o600);
      try { await file.writeFile(text); } finally { await file.close(); }
      if (signal !== undefined) checkAbort(signal);
      // Check cancellation and commit in one turn so late token results cannot save.
      renameSync(temporary, target);
      this.errors.delete(name);
    } catch { throw new LlmSettingsError(`Could not save ${name}.`); }
    finally { await rm(temporary, { force: true }).catch(() => {}); }
  }
  private mutate<T>(action: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new LlmSettingsError("LLM settings are closed."));
    const result = this.queue.then(action);
    this.queue = result.then(() => {}, () => {});
    return result;
  }
  selectProvider(selected: LlmProvider): Promise<void> {
    if (selected !== "chatgpt-subscription") this.cancelSignIn();
    return this.mutate(async () => {
      const current = parsePreferences(await this.load("llm.json"));
      const next = { ...current, provider: provider(selected) };
      await this.write("llm.json", JSON.stringify(next) + "\n"); this.preferences = next;
    });
  }
  setModel(selected: LlmProvider, value: string): Promise<void> {
    return this.mutate(async () => {
      const name = model(value);
      if (selected === "other-api") {
        const text = await this.load("other.service");
        const current = text === null ? this.other : otherService(parseJson(text));
        const next = otherService({ ...current, model: name });
        await this.write("other.service", JSON.stringify(next) + "\n"); this.other = next;
      } else {
        const current = parsePreferences(await this.load("llm.json"));
        const next = { ...current, models: { ...current.models, [selected]: name } };
        await this.write("llm.json", JSON.stringify(next) + "\n"); this.preferences = next;
      }
    });
  }
  saveOtherService(value: OtherService): Promise<void> {
    return this.mutate(async () => { const next = otherService(value); await this.write("other.service", JSON.stringify(next) + "\n"); this.other = next; });
  }
  saveApiKey(selected: "chatgpt-api" | "other-api", value: string): Promise<void> {
    return this.mutate(async () => {
      const key = apiKey(value);
      if (selected === "other-api") { await this.write("other.key", key + "\n"); this.otherKey = key; }
      else {
        const current = parseChatgpt(await this.load("chatgpt.key")), next = { ...current, apiKey: key };
        await this.write("chatgpt.key", JSON.stringify(next) + "\n"); this.chatgpt = next;
      }
    });
  }
  removeCredential(selected: LlmProvider): Promise<void> {
    if (selected === "chatgpt-subscription") this.cancelSignIn();
    return this.mutate(async () => {
      if (selected === "other-api") {
        try { await rm(resolve(this.baseDirectory, "other.key"), { force: true }); } catch { throw new LlmSettingsError("Could not remove other.key."); }
        this.otherKey = null;
        this.errors.delete("other.key");
      } else {
        const current = parseChatgpt(await this.load("chatgpt.key"));
        const next: ChatgptCredentials = selected === "chatgpt-api" ? { ...current, apiKey: null } : { ...current, subscription: null };
        await this.write("chatgpt.key", JSON.stringify(next) + "\n"); this.chatgpt = next;
      }
    });
  }
  private authenticate(run: (signal: AbortSignal) => Promise<SubscriptionCredential>): Promise<void> {
    if (this.closed) return Promise.reject(new LlmSettingsError("LLM settings are closed."));
    const previous = this.active;
    if (previous !== null && !previous.controller.signal.aborted) return previous.promise;
    const controller = new AbortController();
    this.authState = { status: "pending" };
    const promise = (async () => {
      try {
        if (previous !== null) await previous.promise;
        checkAbort(controller.signal);
        const credential = await run(controller.signal);
        checkAbort(controller.signal);
        await this.mutate(async () => {
          checkAbort(controller.signal);
          const current = parseChatgpt(await this.load("chatgpt.key")), next = { ...current, subscription: credential };
          await this.write("chatgpt.key", JSON.stringify(next) + "\n", controller.signal); this.chatgpt = next;
        });
        if (this.active?.controller === controller) this.authState = { status: "idle" };
      } catch (error) {
        if (!controller.signal.aborted) {
          const message = error instanceof LlmSettingsError ? error.message : "Subscription sign-in failed. Try again.";
          this.authState = { status: "error", message };
          throw new LlmSettingsError(message);
        }
      } finally { if (this.active?.controller === controller) this.active = null; }
    })();
    this.active = { controller, promise };
    return promise;
  }
  signInSubscription(): Promise<void> { return this.authenticate(signal => loginSubscription(this.auth, signal)); }
  refreshSubscription(): Promise<void> {
    return this.runRequest(async signal => {
      const current = await this.loadSubscription();
      await this.freshSubscription(signal, current.accessToken);
    });
  }
  private async loadSubscription(): Promise<SubscriptionCredential> {
    const credential = parseChatgpt(await this.load("chatgpt.key")).subscription;
    if (credential === null) throw new LlmSettingsError("Sign in to ChatGPT Subscription in LLM options first.");
    return credential;
  }
  private async freshSubscription(signal: AbortSignal, rejectedAccessToken?: string): Promise<SubscriptionCredential> {
    checkRequestAbort(signal);
    const credential = await this.loadSubscription();
    if (rejectedAccessToken !== undefined && credential.accessToken !== rejectedAccessToken
      || rejectedAccessToken === undefined && credential.expiresAt > Date.now() + 60_000) return credential;
    let shared = this.refreshing;
    if (shared !== null && shared.controller.signal.aborted) {
      await withRequestAbort(shared.promise.catch(() => undefined), signal);
      return await this.freshSubscription(signal, rejectedAccessToken);
    }
    if (shared === null) {
      const controller = new AbortController();
      const promise = (async () => {
        const before = await this.loadSubscription();
        checkRequestAbort(controller.signal);
        if (rejectedAccessToken !== undefined && before.accessToken !== rejectedAccessToken
          || rejectedAccessToken === undefined && before.expiresAt > Date.now() + 60_000) return before;
        const refreshed = await refreshSubscription(this.auth, before, controller.signal);
        checkRequestAbort(controller.signal);
        return await this.mutate(async () => {
          const latest = parseChatgpt(await this.load("chatgpt.key"));
          if (latest.subscription === null) throw new LlmSettingsError("Subscription credential was removed. Sign in again.");
          if (latest.subscription.refreshToken !== before.refreshToken || latest.subscription.accessToken !== before.accessToken) return latest.subscription;
          const next = { ...latest, subscription: refreshed };
          await this.write("chatgpt.key", JSON.stringify(next) + "\n", controller.signal);
          this.chatgpt = next;
          return refreshed;
        });
      })().finally(() => { if (this.refreshing?.controller === controller) this.refreshing = null; });
      shared = { controller, promise, users: 0 };
      this.refreshing = shared;
    }
    shared.users++;
    try { return await withRequestAbort(shared.promise, signal); }
    finally { shared.users--; if (shared.users === 0) shared.controller.abort(); }
  }
  private runRequest<T>(run: (signal: AbortSignal) => Promise<T>, caller?: AbortSignal): Promise<T> {
    if (caller?.aborted) return Promise.reject(new LlmSettingsError("LLM request cancelled."));
    if (this.closed) return Promise.reject(new LlmSettingsError("LLM settings are closed."));
    const controller = new AbortController();
    const stop = (): void => controller.abort();
    caller?.addEventListener("abort", stop, { once: true });
    if (caller?.aborted) controller.abort();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.requestOptions.timeoutMs ?? 120_000);
    const promise = (async () => {
      try {
        checkRequestAbort(controller.signal);
        await withRequestAbort(this.queue, controller.signal);
        checkRequestAbort(controller.signal);
        return await withRequestAbort(run(controller.signal), controller.signal);
      } catch (error) {
        if (timedOut) throw new LlmSettingsError("LLM request timed out. Try a shorter request or check the service.");
        checkRequestAbort(controller.signal);
        if (error instanceof LlmSettingsError) throw error;
        throw new LlmSettingsError("LLM request failed. Check the selected service and try again.");
      } finally { clearTimeout(timer); caller?.removeEventListener("abort", stop); this.requests.delete(controller); }
    })();
    this.requests.set(controller, promise);
    return promise;
  }
  request(input: LlmRequestInput): Promise<string> {
    return this.runRequest(async signal => {
      const preferences = parsePreferences(await this.load("llm.json"));
      if (input.prompt.trim() === "") throw new LlmSettingsError("Enter a question or command request.");
      const fetcher = this.requestOptions.fetch ?? fetch;
      const selected = preferences.provider;
      const other = selected === "other-api" ? otherService(parseJson(await this.load("other.service") ?? "{}")) : null;
      const selectedModel = selected === "other-api" ? other?.model ?? "" : preferences.models[selected];
      if (selectedModel === "") throw new LlmSettingsError("Choose a Model in LLM options before sending a request.");
      const request: TransportRequest = { prompt: input.prompt, instructions: input.instructions, model: selectedModel, signal,
        ...(input.onText === undefined ? {} : { onText: input.onText }) };
      if (selected === "chatgpt-subscription") {
        const credential = await this.freshSubscription(signal);
        try { return await requestCodex(request, credential, fetcher); }
        catch (error) {
          if (!(error instanceof LlmHttpError) || error.status !== 401 && error.status !== 403) throw error;
          const refreshed = await this.freshSubscription(signal, credential.accessToken);
          return await requestCodex(request, refreshed, fetcher);
        }
      }
      const key = selected === "chatgpt-api" ? parseChatgpt(await this.load("chatgpt.key")).apiKey : await this.load("other.key");
      if (key === null) throw new LlmSettingsError("Paste an API key for the selected provider in LLM options first.");
      return await requestChatCompletions(request, { apiKey: apiKey(key), baseUrl: other?.baseUrl ?? "https://api.openai.com/v1" }, fetcher);
    }, input.signal);
  }
  cancelSignIn(): void { this.active?.controller.abort(); this.authState = { status: "idle" }; }
  async close(): Promise<void> {
    this.closed = true; this.cancelSignIn();
    for (const controller of this.requests.keys()) controller.abort();
    this.refreshing?.controller.abort();
    await Promise.allSettled([...this.requests.values(), this.active?.promise, this.refreshing?.promise]);
    await this.queue;
  }
}

export { LlmSettingsError } from "./errors.ts";
