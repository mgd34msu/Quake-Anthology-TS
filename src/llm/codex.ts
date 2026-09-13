import { arch, platform, release } from "node:os";
import type { SubscriptionCredential } from "./auth.ts";
import { LlmHttpError, LlmSettingsError } from "./errors.ts";
import type { LlmFetch, TransportRequest } from "./request.ts";
import { cancelResponseBody, fetchLlmResponse } from "./request.ts";
import { consumeSse } from "./sse.ts";

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function object(value: unknown): Record<string, unknown> {
  if (!isObject(value)) throw new LlmSettingsError("Invalid subscription response.");
  return value;
}

function accountId(token: string): string {
  try {
    const payload = token.split(".")[1];
    if (payload === undefined || !/^[A-Za-z0-9_-]+$/.test(payload)) throw new Error();
    const parsed: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const auth = object(object(parsed)["https://api.openai.com/auth"]);
    const id = auth["chatgpt_account_id"];
    if (typeof id !== "string" || id.trim() === "" || /[\x00-\x20\x7f]/.test(id)) throw new Error();
    return id;
  } catch { throw new LlmSettingsError("Subscription credential has no valid ChatGPT account ID. Sign in again."); }
}

export async function requestCodex(input: TransportRequest, credential: SubscriptionCredential, fetcher: LlmFetch): Promise<string> {
  const id = accountId(credential.accessToken), session = crypto.randomUUID();
  const response = await fetchLlmResponse("https://chatgpt.com/backend-api/codex/responses", {
    method: "POST", signal: input.signal,
    headers: {
      authorization: `Bearer ${credential.accessToken}`, "chatgpt-account-id": id,
      originator: "pi", "OpenAI-Beta": "responses=experimental", accept: "text/event-stream",
      "content-type": "application/json", "User-Agent": `pi (${platform()} ${release()}; ${arch()})`, session_id: session,
    },
    body: JSON.stringify({
      model: input.model.replace(/^openai[:/]/, ""), store: false, stream: true,
      instructions: input.instructions.trim() || "You are a helpful assistant.",
      input: [{ role: "user", content: [{ type: "input_text", text: input.prompt }] }],
      text: { verbosity: "medium" }, include: ["reasoning.encrypted_content"], prompt_cache_key: session,
    }),
  }, fetcher, input.signal);
  if (!response.ok) {
    cancelResponseBody(response);
    throw new LlmHttpError(response.status);
  }
  let text = "", completed = false;
  await consumeSse(response, input.signal, event => {
    if (event.data === "[DONE]") return;
    let value: unknown;
    try { value = JSON.parse(event.data); }
    catch { throw new LlmSettingsError("Invalid subscription response."); }
    const item = object(value), type = item["type"] ?? event.event;
    if (type === "response.failed" || type === "response.incomplete" || type === "error") throw new LlmSettingsError("Subscription response failed. Try again.");
    if (type === "response.output_text.delta") {
      if (completed || typeof item["delta"] !== "string") throw new LlmSettingsError("Invalid subscription response.");
      text += item["delta"];
      input.onText?.(item["delta"]);
    } else if (type === "response.completed") {
      const result = object(item["response"]);
      if (result["status"] !== "completed") throw new LlmSettingsError("Subscription response did not complete. Try again.");
      completed = true;
      return true;
    }
    return undefined;
  });
  if (!completed) throw new LlmSettingsError("Subscription response ended before completion. Try again.");
  if (text.trim() === "") throw new LlmSettingsError("Subscription returned no text. Try again.");
  return text;
}
