import { arch, platform, release } from "node:os";
import type { SubscriptionCredential } from "./auth.ts";
import { LlmHttpError, LlmSettingsError } from "./errors.ts";
import type { LlmFetch, TransportRequest } from "./request.ts";
import { cancelResponseBody, fetchLlmResponse } from "./request.ts";
import { readResponses } from "./responses.ts";
import { record } from "./auth.ts";

export function subscriptionAccountId(token: string): string {
  try {
    const payload = token.split(".")[1];
    if (payload === undefined || !/^[A-Za-z0-9_-]+$/.test(payload)) throw new Error();
    const parsed: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const auth = record(record(parsed)["https://api.openai.com/auth"]);
    const id = auth["chatgpt_account_id"];
    if (typeof id !== "string" || id.trim() === "" || /[\x00-\x20\x7f]/.test(id)) throw new Error();
    return id;
  } catch { throw new LlmSettingsError("Subscription credential has no valid ChatGPT account ID. Sign in again."); }
}

export async function requestCodex(input: TransportRequest, credential: SubscriptionCredential, fetcher: LlmFetch): Promise<string> {
  const id = subscriptionAccountId(credential.accessToken), session = crypto.randomUUID();
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
      ...(input.reasoningEffort === undefined ? {} : { reasoning: { effort: input.reasoningEffort } }),
      text: { verbosity: "medium" }, include: ["reasoning.encrypted_content"], prompt_cache_key: session,
    }),
  }, fetcher, input.signal);
  if (!response.ok) {
    cancelResponseBody(response);
    throw new LlmHttpError(response.status);
  }
  return readResponses(input, response, "Subscription", false);
}
