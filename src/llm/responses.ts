import { LlmSettingsError } from "./errors.ts";
import type { TransportRequest } from "./request.ts";
import { consumeSse } from "./sse.ts";

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function isArray(value: unknown): value is unknown[] { return Array.isArray(value); }
function object(value: unknown): Record<string, unknown> {
  if (!isObject(value)) throw new LlmSettingsError("Invalid LLM response.");
  return value;
}
function outputItem(value: unknown, label: string): string {
  let text = "";
  const item = object(value);
  if (item["type"] !== "message" && item["type"] !== "reasoning") throw new LlmSettingsError(`${label} returned an unsupported output item.`);
  if (item["type"] === "message" && item["content"] !== undefined) {
    const content: unknown = item["content"];
    if (!isArray(content)) throw new LlmSettingsError("Invalid LLM response.");
    for (const part of content) {
      const entry = object(part);
      if (entry["type"] === "refusal") throw new LlmSettingsError(`${label} declined the request.`);
      if (entry["type"] !== "output_text") throw new LlmSettingsError(`${label} returned unsupported content.`);
      if (typeof entry["text"] !== "string") throw new LlmSettingsError("Invalid LLM response.");
      text += entry["text"];
    }
  }
  return text;
}

export async function readResponses(input: TransportRequest, response: Response, label: string, requireContentType: boolean): Promise<string> {
  let text = "", completed = false;
  await consumeSse(response, input.signal, event => {
    if (event.data === "[DONE]") return;
    let value: unknown;
    try { value = JSON.parse(event.data); }
    catch { throw new LlmSettingsError("Invalid LLM response."); }
    const item = object(value), type = item["type"] ?? event.event;
    if (type === "response.failed" || type === "response.incomplete" || type === "error") throw new LlmSettingsError(`${label} response failed. Try again.`);
    if (typeof type === "string" && type.startsWith("response.refusal.")) throw new LlmSettingsError(`${label} declined the request.`);
    if (typeof type === "string" && type.startsWith("response.function_call_arguments.")) throw new LlmSettingsError(`${label} returned an unsupported tool call.`);
    if (type === "response.output_item.added" || type === "response.output_item.done") {
      outputItem(item["item"], label);
    }
    if (type === "response.content_part.added" || type === "response.content_part.done") {
      if (object(item["part"])["type"] === "refusal") throw new LlmSettingsError(`${label} declined the request.`);
    }
    if (type === "response.output_text.delta") {
      if (completed || typeof item["delta"] !== "string") throw new LlmSettingsError("Invalid LLM response.");
      text += item["delta"];
      input.onText?.(item["delta"]);
    } else if (type === "response.completed") {
      const result = object(item["response"]);
      if (result["status"] !== "completed") throw new LlmSettingsError(`${label} response did not complete. Try again.`);
      const output: unknown = result["output"];
      if (output !== undefined) {
        if (!isArray(output)) throw new LlmSettingsError("Invalid LLM response.");
        const finalText = output.map(entry => outputItem(entry, label)).join("");
        if (text !== "" && finalText !== text) throw new LlmSettingsError(`${label} returned inconsistent response text.`);
        if (text === "" && finalText !== "") { text = finalText; input.onText?.(finalText); }
      }
      completed = true;
      return true;
    }
    return undefined;
  }, { requireContentType });
  if (!completed) throw new LlmSettingsError(`${label} response ended before completion. Try again.`);
  if (text.trim() === "") throw new LlmSettingsError(`${label} returned no text. Try again.`);
  return text;
}
