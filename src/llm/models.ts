import { record, type SubscriptionCredential } from "./auth.ts";
import { subscriptionAccountId } from "./codex.ts";
import { LlmHttpError, LlmSettingsError } from "./errors.ts";
import { cancelResponseBody, checkRequestAbort, fetchLlmResponse, responseBody, withRequestAbort, type LlmFetch } from "./request.ts";

export interface LlmModel {
  readonly id: string;
  readonly name: string;
  readonly reasoningEfforts: readonly string[];
  readonly defaultReasoningEffort: string | null;
  readonly reasoningSource: "provider" | "reference" | "unknown";
  readonly recommended: boolean;
}
export type LlmModelCatalog = { readonly status: "idle" | "loading" | "ready"; readonly models: readonly LlmModel[] }
  | { readonly status: "error"; readonly models: readonly LlmModel[]; readonly message: string };

function isArray(value: unknown): value is unknown[] { return Array.isArray(value); }
function string(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > 256 || /[\x00-\x1f\x7f]/.test(value)) throw new LlmSettingsError("The service returned invalid model metadata.");
  return value.trim();
}
export function parseReasoningEffort(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const effort = string(value);
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(effort)) throw new LlmSettingsError("Invalid reasoning effort.");
  return effort;
}

// Official model pages verified 2026-09-16. Unknown model IDs keep Model default.
const apiReasoning: Readonly<Record<string, readonly string[]>> = {
  "gpt-5": ["minimal", "low", "medium", "high"],
  "gpt-5-pro": ["high"],
  "gpt-5.2-pro": ["medium", "high", "xhigh"],
  "gpt-5.4": ["none", "low", "medium", "high", "xhigh"],
  "gpt-5.4-pro": ["medium", "high", "xhigh"],
  "gpt-5.4-mini": ["none", "low", "medium", "high", "xhigh"],
  "gpt-5.4-nano": ["none", "low", "medium", "high", "xhigh"],
  "gpt-5.6-sol": ["none", "low", "medium", "high", "xhigh", "max"],
  "gpt-5.1": ["none", "low", "medium", "high"],
  "gpt-5.2": ["none", "low", "medium", "high", "xhigh"],
  "gpt-5.5": ["none", "low", "medium", "high", "xhigh"],
  "gpt-5.5-pro": ["medium", "high", "xhigh"],
  "gpt-6-astra": ["low", "medium", "high", "xhigh", "max"],
  "gpt-5.6-terra": ["none", "low", "medium", "high", "xhigh", "max"],
  "gpt-5.6-luna": ["none", "low", "medium", "high", "xhigh", "max"],
};
export function apiModel(id: string): LlmModel {
  const efforts = apiReasoning[id.replace(/-\d{4}-\d{2}-\d{2}$/, "")];
  return { id, name: id, reasoningEfforts: efforts ?? [], defaultReasoningEffort: null,
    reasoningSource: efforts === undefined ? "unknown" : "reference", recommended: false };
}
const NON_CHAT = /embedding|whisper|tts|dall-e|davinci|babbage|^ada|moderation|text-search|similarity|transcribe|speech|realtime|image/i;
export function parseApiModels(value: unknown, openai: boolean): readonly LlmModel[] {
  const data = record(value)["data"];
  if (!isArray(data)) throw new LlmSettingsError("The service returned an invalid model list.");
  const models = new Map<string, LlmModel>();
  for (const value of data) {
    const id = string(record(value)["id"]);
    if (openai && NON_CHAT.test(id)) continue;
    // Other services cannot inherit OpenAI capability claims just by reusing a model ID.
    models.set(id, openai ? apiModel(id) : { id, name: id, reasoningEfforts: [], defaultReasoningEffort: null, reasoningSource: "unknown", recommended: false });
  }
  return [...models.values()].sort((a, b) => a.name.localeCompare(b.name));
}
export function parseCodexModels(value: unknown): readonly LlmModel[] {
  const list = record(value)["models"];
  if (!isArray(list)) throw new LlmSettingsError("The subscription service returned an invalid model list.");
  const models: { model: LlmModel; priority: number }[] = [];
  for (const value of list) {
    const item = record(value);
    if (item["visibility"] !== "list") continue;
    const id = string(item["slug"]), levels = item["supported_reasoning_levels"];
    if (!isArray(levels)) throw new LlmSettingsError("The subscription service returned invalid reasoning choices.");
    const efforts: string[] = [];
    for (const value of levels) {
      const effort = parseReasoningEffort(record(value)["effort"]);
      if (effort === null) throw new LlmSettingsError("The subscription service returned invalid reasoning choices.");
      if (!efforts.includes(effort)) efforts.push(effort);
    }
    const defaultEffort = parseReasoningEffort(item["default_reasoning_level"]);
    const priority = item["priority"];
    if (typeof priority !== "number" || !Number.isFinite(priority)) throw new LlmSettingsError("The subscription service returned invalid model priority metadata.");
    models.push({ priority,
      model: { id, name: string(item["display_name"] ?? id), reasoningEfforts: efforts,
        defaultReasoningEffort: defaultEffort !== null && efforts.includes(defaultEffort) ? defaultEffort : null,
        reasoningSource: "provider", recommended: item["is_default"] === true } });
  }
  models.sort((a, b) => a.priority - b.priority);
  // Codex ModelsManager sorts server priority, then marks the first visible model as default.
  const ordered = [...new Map(models.map(({ model }) => [model.id, model])).values()];
  return ordered.map((model, index) => ({ ...model, recommended: index === 0 }));
}
async function modelJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.ok) { cancelResponseBody(response); throw new LlmHttpError(response.status); }
  const body = responseBody(response);
  if (body === null) throw new LlmSettingsError("The service returned an empty model list response.");
  const reader = body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "", size = 0;
  const stop = (): void => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", stop, { once: true });
  try {
    while (true) {
      checkRequestAbort(signal);
      const chunk = await withRequestAbort(reader.read(), signal);
      if (chunk.done) break;
      if (!(chunk.value instanceof Uint8Array)) throw new LlmSettingsError("The service returned invalid model list bytes.");
      size += chunk.value.byteLength;
      if (size > 4_194_304) throw new LlmSettingsError("The service model list exceeded the size limit.");
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    const value: unknown = JSON.parse(text);
    return value;
  } catch (error) {
    checkRequestAbort(signal);
    if (error instanceof LlmSettingsError) throw error;
    throw new LlmSettingsError("The service returned an invalid model list response.");
  } finally { signal.removeEventListener("abort", stop); stop(); reader.releaseLock(); }
}
export async function discoverApiModels(baseUrl: string, apiKey: string, openai: boolean, fetcher: LlmFetch, signal: AbortSignal): Promise<readonly LlmModel[]> {
  const response = await fetchLlmResponse(`${baseUrl.replace(/\/+$/, "")}/models`, { method: "GET", headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" } }, fetcher, signal);
  return parseApiModels(await modelJson(response, signal), openai);
}
export async function discoverCodexModels(credential: SubscriptionCredential, fetcher: LlmFetch, signal: AbortSignal): Promise<readonly LlmModel[]> {
  // Compatibility version matches installed released Codex 0.154.0. Upstream ModelsManager sends its built package semver.
  const response = await fetchLlmResponse("https://chatgpt.com/backend-api/codex/models?client_version=0.154.0", { method: "GET", headers: {
    authorization: `Bearer ${credential.accessToken}`, "chatgpt-account-id": subscriptionAccountId(credential.accessToken), originator: "pi", accept: "application/json",
  } }, fetcher, signal);
  return parseCodexModels(await modelJson(response, signal));
}
