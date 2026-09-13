import { LlmSettingsError } from "./errors.ts";
import { createHash, randomBytes } from "node:crypto";

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export interface SubscriptionCredential {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly tokenType: string;
  readonly expiresAt: number;
  readonly scopes: readonly string[];
}
export interface SubscriptionAuthOptions {
  readonly authorizeUrl?: string;
  readonly tokenUrl?: string;
  readonly callbackPort?: number;
  readonly callbackTimeoutMs?: number;
  readonly fetchTimeoutMs?: number;
  readonly openBrowser?: (url: string, signal: AbortSignal) => Promise<void>;
  readonly fetch?: (url: string, init: RequestInit) => Promise<Response>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new LlmSettingsError("Invalid LLM settings data.");
  return value;
}
function nonempty(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") throw new LlmSettingsError("Invalid subscription credential.");
  return value;
}
export function parseSubscription(value: unknown): SubscriptionCredential {
  const item = record(value), scopes = item["scopes"];
  if (typeof item["expiresAt"] !== "number" || !Number.isFinite(item["expiresAt"]) || !Array.isArray(scopes)) throw new LlmSettingsError("Invalid subscription credential.");
  return { accessToken: nonempty(item["accessToken"]), refreshToken: nonempty(item["refreshToken"]), tokenType: nonempty(item["tokenType"]), expiresAt: item["expiresAt"], scopes: scopes.map((scope: unknown) => nonempty(scope)) };
}
export function cancelled(): Error { return new LlmSettingsError("Subscription sign-in cancelled."); }
export function checkAbort(signal: AbortSignal): void { if (signal.aborted) throw cancelled(); }

async function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  let onAbort = (): void => {};
  const interrupted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(cancelled());
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
  try { return await Promise.race([operation, interrupted]); }
  finally { signal.removeEventListener("abort", onAbort); }
}

async function openBrowser(_url: string, signal: AbortSignal): Promise<void> {
  checkAbort(signal);
  throw new LlmSettingsError("Sign-in browser is unavailable.");
}

async function tokenRequest(options: SubscriptionAuthOptions, form: URLSearchParams, signal: AbortSignal, previous?: SubscriptionCredential): Promise<SubscriptionCredential> {
  const controller = new AbortController();
  const stop = (): void => controller.abort();
  signal.addEventListener("abort", stop, { once: true });
  if (signal.aborted) controller.abort();
  const timeout = setTimeout(stop, options.fetchTimeoutMs ?? 30_000);
  try {
    const response = await abortable((options.fetch ?? fetch)(options.tokenUrl ?? "https://auth.openai.com/oauth/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString(), signal: controller.signal,
    }), controller.signal);
    if (!response.ok) throw new LlmSettingsError("Subscription token request failed.");
    const value: unknown = await abortable(response.json(), controller.signal);
    const item = record(value), expires = item["expires_in"];
    if (typeof expires !== "number" || !Number.isFinite(expires) || expires <= 0) throw new LlmSettingsError("Invalid subscription token response.");
    const scope = item["scope"], expiresAt = Date.now() + expires * 1000;
    if (!Number.isFinite(expiresAt)) throw new LlmSettingsError("Invalid subscription token response.");
    return { accessToken: nonempty(item["access_token"]), refreshToken: nonempty(item["refresh_token"]),
      tokenType: nonempty(item["token_type"] ?? "Bearer"), expiresAt,
      scopes: typeof scope === "string" ? scope.split(/\s+/).filter(Boolean) : previous?.scopes ?? [] };
  } catch {
    if (signal.aborted) throw cancelled();
    throw new LlmSettingsError("Subscription token request failed. Try signing in again.");
  } finally { clearTimeout(timeout); signal.removeEventListener("abort", stop); }
}

export async function loginSubscription(options: SubscriptionAuthOptions, signal: AbortSignal): Promise<SubscriptionCredential> {
  checkAbort(signal);
  const state = randomBytes(32).toString("base64url"), verifier = randomBytes(32).toString("base64url");
  let resolveCode = (_code: string): void => {};
  let rejectCode = (_error: Error): void => {};
  const callback = new Promise<string>((resolve, reject) => { resolveCode = resolve; rejectCode = reject; });
  // Attach the rejection handler before browser startup, which can itself fail.
  const codeResult = callback.then(code => ({ code }), (error: unknown) => ({ error: error instanceof Error ? error : new LlmSettingsError("Sign-in failed.") }));
  const server = startListener({ hostname: "127.0.0.1", port: options.callbackPort ?? 1455,
    fetch(request) {
      const url = new URL(request.url);
      if (url.pathname !== "/auth/callback") return new Response("Not found", { status: 404 });
      if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
      if (url.searchParams.get("state") !== state) {
        rejectCode(new LlmSettingsError("Subscription sign-in state mismatch."));
        return new Response("Sign-in failed. State mismatch.", { status: 400 });
      }
      const code = url.searchParams.get("code");
      if (url.searchParams.has("error") || !code) {
        rejectCode(new LlmSettingsError("Subscription sign-in was not authorized."));
        return new Response("Sign-in was not authorized.", { status: 400 });
      }
      resolveCode(code);
      return new Response("Authorization received. You can return to the game.");
    },
  });
  const redirect = `http://localhost:${server.port}/auth/callback`;
  const controller = new AbortController();
  const stop = (): void => { controller.abort(); rejectCode(cancelled()); void server.stop(true); };
  signal.addEventListener("abort", stop, { once: true });
  if (signal.aborted) stop();
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); rejectCode(new LlmSettingsError("Subscription sign-in timed out.")); void server.stop(true); }, options.callbackTimeoutMs ?? 180_000);
  try {
    const url = new URL(options.authorizeUrl ?? "https://auth.openai.com/oauth/authorize");
    for (const [key, value] of Object.entries({ response_type: "code", client_id: CLIENT_ID, redirect_uri: redirect,
      scope: "openid profile email offline_access", state, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256",
      id_token_add_organizations: "true", codex_cli_simplified_flow: "true", originator: "pi" })) url.searchParams.set(key, value);
    const browser = (options.openBrowser ?? openBrowser)(url.toString(), controller.signal);
    await abortable(Promise.race([browser, codeResult.then(result => {
      if ("error" in result) throw result.error;
    })]), controller.signal);
    const result = await codeResult;
    if ("error" in result) throw result.error;
    clearTimeout(timeout);
    controller.abort();
    await server.stop(true);
    checkAbort(signal);
    return await tokenRequest(options, new URLSearchParams({ grant_type: "authorization_code", client_id: CLIENT_ID, redirect_uri: redirect, code: result.code, code_verifier: verifier }), signal);
  } catch (error) {
    if (signal.aborted) throw cancelled();
    if (timedOut) throw new LlmSettingsError("Subscription sign-in timed out. Try again.");
    if (error instanceof LlmSettingsError) throw error;
    throw new LlmSettingsError("Subscription sign-in failed. Try again.");
  } finally { clearTimeout(timeout); signal.removeEventListener("abort", stop); await server.stop(true); }
}

export function refreshSubscription(options: SubscriptionAuthOptions, credential: SubscriptionCredential, signal: AbortSignal): Promise<SubscriptionCredential> {
  return tokenRequest(options, new URLSearchParams({ grant_type: "refresh_token", client_id: CLIENT_ID, refresh_token: credential.refreshToken }), signal, credential);
}

function startListener(options: { hostname: string; port: number; fetch: (request: Request) => Response }): Bun.Server<undefined> {
  try { return Bun.serve(options); }
  catch { throw new LlmSettingsError("Could not open the local sign-in callback. Close other sign-in windows or applications using port 1455, then retry."); }
}
