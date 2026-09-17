import { readResponses } from "./responses.ts";
import { record } from "./auth.ts";
import { LlmHttpError, LlmSettingsError } from "./errors.ts";
import { cancelResponseBody, fetchLlmResponse, type LlmFetch, type TransportRequest } from "./request.ts";
import { consumeSse } from "./sse.ts";

export async function requestChatCompletions(input: TransportRequest, credential: { readonly apiKey: string; readonly baseUrl: string }, fetcher: LlmFetch): Promise<string> {
  const response = await fetchLlmResponse(`${credential.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST", headers: { authorization: `Bearer ${credential.apiKey}`, "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify({ model: input.model, ...(input.reasoningEffort === undefined ? {} : { reasoning_effort: input.reasoningEffort }), messages: [{ role: "system", content: input.instructions }, { role: "user", content: input.prompt }], stream: true }),
  }, fetcher, input.signal);
  if (!response.ok) { cancelResponseBody(response); throw new LlmHttpError(response.status); }
  let text = "", finished = false, done = false;
  await consumeSse(response, input.signal, event => {
    if (event.data === "[DONE]") { done = true; return true; }
    let value: unknown;
    try { value = JSON.parse(event.data); } catch { throw new LlmSettingsError("LLM service returned invalid stream data."); }
    const chunk = record(value), choices = chunk["choices"];
    if (chunk["error"] !== undefined || event.event === "error") throw new LlmSettingsError("LLM service reported a response error.");
    if (!isArray(choices)) throw new LlmSettingsError("LLM service returned invalid completion data.");
    for (const item of choices) {
      const choice = record(item);
      if (choice["index"] !== 0) continue;
      const delta = record(choice["delta"]), content = delta["content"], finish = choice["finish_reason"];
      if (delta["tool_calls"] !== undefined || delta["function_call"] !== undefined) throw new LlmSettingsError("LLM service returned an unsupported tool call.");
      if (typeof delta["refusal"] === "string" && delta["refusal"] !== "") throw new LlmSettingsError("LLM service declined the request.");
      if (content !== undefined && content !== null) {
        if (typeof content !== "string" || finished) throw new LlmSettingsError("LLM service returned invalid completion content.");
        text += content;
        if (content !== "") input.onText?.(content);
      }
      if (finish !== undefined && finish !== null) {
        if (finish !== "stop") throw new LlmSettingsError("LLM response was incomplete or declined. Try a shorter request.");
        finished = true;
      }
    }
    return undefined;
  });
  if (!done || !finished) throw new LlmSettingsError("LLM response ended before completion. Try again.");
  if (text.trim() === "") throw new LlmSettingsError("LLM service returned an empty response.");
  return text;
}

function isArray(value: unknown): value is unknown[] { return Array.isArray(value); }

export async function requestOpenAiResponses(input: TransportRequest, apiKey: string, fetcher: LlmFetch): Promise<string> {
  const response = await fetchLlmResponse("https://api.openai.com/v1/responses", {
    method: "POST", headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify({ model: input.model, instructions: input.instructions, input: [{ role: "user", content: [{ type: "input_text", text: input.prompt }] }],
      store: false, stream: true, ...(input.reasoningEffort === undefined ? {} : { reasoning: { effort: input.reasoningEffort } }) }),
  }, fetcher, input.signal);
  if (!response.ok) { cancelResponseBody(response); throw new LlmHttpError(response.status); }
  return readResponses(input, response, "OpenAI API", true);
}
